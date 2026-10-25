//! The NVD API 2.0 client: one shared rate limiter, retries, paging.
//! Only the worker talks to NVD (ADR 0002). The API key goes in the `apiKey` header
//! and is never logged.

use std::time::Duration;

use reqwest::StatusCode;
use serde_json::Value;
use thiserror::Error;
use tracing::{debug, warn};

use crate::error::JobError;
use crate::http_limits;
use crate::limiter::RateLimiter;
use crate::nvd_parse::{self, NvdProduct, NvdVuln, ParseError};

const WINDOW: Duration = Duration::from_secs(30);
const REQUESTS_WITHOUT_KEY: usize = 5;
const REQUESTS_WITH_KEY: usize = 50;
const CVES_PER_PAGE: u64 = 2000;
const CPES_PER_PAGE: u64 = 200;
/// A stop for runaway paging (100 000 CVEs for one product would be a bug).
const MAX_CVE_PAGES: u64 = 50;
const MAX_PRODUCTS_IN_RESULT: usize = 8;
/// A page of 2000 CVEs is a few MB; this only stops a runaway answer.
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Error)]
pub enum NvdError {
    #[error("NVD did not answer after {attempts} tries: {last}")]
    Unavailable { attempts: usize, last: String },
    #[error("NVD refused the request ({0})")]
    Rejected(StatusCode),
    #[error("NVD answer was not understood: {0}")]
    Parse(#[from] ParseError),
    #[error("could not set up the HTTP client: {0}")]
    Client(#[from] reqwest::Error),
}

impl From<NvdError> for JobError {
    fn from(err: NvdError) -> Self {
        match err {
            NvdError::Unavailable { .. } => Self::NvdUnavailable(err.to_string()),
            other => Self::Internal(other.to_string()),
        }
    }
}

pub struct NvdSettings {
    pub base_url: String,
    pub api_key: Option<String>,
    /// Waits between tries. Three tries in total with two delays: 6 s, then 30 s.
    pub retry_delays: Vec<Duration>,
}

impl NvdSettings {
    pub fn standard(base_url: String, api_key: Option<String>) -> Self {
        Self {
            base_url,
            api_key,
            retry_delays: vec![Duration::from_secs(6), Duration::from_secs(30)],
        }
    }
}

pub struct NvdClient {
    http: reqwest::Client,
    base_url: String,
    api_key: Option<String>,
    limiter: RateLimiter,
    retry_delays: Vec<Duration>,
}

impl NvdClient {
    pub fn new(settings: NvdSettings) -> Result<Self, NvdError> {
        crate::install_crypto_provider();
        let http = reqwest::Client::builder()
            .user_agent(concat!("homeward-worker/", env!("CARGO_PKG_VERSION")))
            .timeout(REQUEST_TIMEOUT)
            .redirect(http_limits::same_host_redirects())
            .build()?;
        let max = if settings.api_key.is_some() {
            REQUESTS_WITH_KEY
        } else {
            REQUESTS_WITHOUT_KEY
        };
        Ok(Self {
            http,
            base_url: settings.base_url.trim_end_matches('/').to_string(),
            api_key: settings.api_key,
            limiter: RateLimiter::new(max, WINDOW),
            retry_delays: settings.retry_delays,
        })
    }

    /// Products that match a search text, grouped without versions, in NVD order.
    pub async fn search_products(&self, text: &str) -> Result<Vec<NvdProduct>, NvdError> {
        let query = [
            ("keywordSearch", text.to_string()),
            ("resultsPerPage", CPES_PER_PAGE.to_string()),
        ];
        let body = self.get("/rest/json/cpes/2.0", &query).await?;
        Ok(nvd_parse::parse_cpe_page(&body, MAX_PRODUCTS_IN_RESULT)?)
    }

    /// Every CVE that lists the product (any version). `base_cpe` has no version.
    pub async fn cves_for_product(&self, base_cpe: &str) -> Result<Vec<NvdVuln>, NvdError> {
        let mut found = Vec::new();
        let mut start = 0;
        for _ in 0..MAX_CVE_PAGES {
            let query = [
                ("virtualMatchString", base_cpe.to_string()),
                ("resultsPerPage", CVES_PER_PAGE.to_string()),
                ("startIndex", start.to_string()),
            ];
            let body = self.get("/rest/json/cves/2.0", &query).await?;
            let page = nvd_parse::parse_cve_page(&body)?;
            start += page.received;
            found.extend(page.vulnerabilities);
            if page.received == 0 || start >= page.total_results {
                break;
            }
        }
        Ok(found)
    }

    async fn get(&self, path: &str, query: &[(&str, String)]) -> Result<Value, NvdError> {
        let attempts = self.retry_delays.len() + 1;
        let mut last = String::new();
        for attempt in 0..attempts {
            self.limiter.acquire().await;
            match self.try_once(path, query).await {
                Attempt::Done(value) => return Ok(value),
                Attempt::Fatal(err) => return Err(err),
                Attempt::Retry(reason) => last = reason,
            }
            if let Some(delay) = self.retry_delays.get(attempt) {
                warn!(attempt = attempt + 1, reason = %last, ?delay, "NVD request failed, will retry");
                tokio::time::sleep(*delay).await;
            }
        }
        Err(NvdError::Unavailable { attempts, last })
    }

    async fn try_once(&self, path: &str, query: &[(&str, String)]) -> Attempt {
        let mut request = self
            .http
            .get(format!("{}{path}", self.base_url))
            .query(query);
        if let Some(key) = &self.api_key {
            request = request.header("apiKey", key);
        }
        debug!(path, "calling NVD");
        let response = match request.send().await {
            Ok(response) => response,
            // reqwest errors can carry the URL; they never contain the header value.
            Err(err) => return Attempt::Retry(format!("network error: {err}")),
        };
        let status = response.status();
        if status.is_success() {
            let body = match http_limits::read_capped(response, MAX_RESPONSE_BYTES).await {
                Ok(body) => body,
                Err(err) => return Attempt::Retry(format!("unreadable answer: {err}")),
            };
            return match serde_json::from_slice::<Value>(&body) {
                Ok(value) => Attempt::Done(value),
                Err(err) => Attempt::Retry(format!("unreadable answer: {err}")),
            };
        }
        if is_temporary(status) {
            return Attempt::Retry(format!("status {status}"));
        }
        Attempt::Fatal(NvdError::Rejected(status))
    }
}

enum Attempt {
    Done(Value),
    Retry(String),
    Fatal(NvdError),
}

/// NVD answers 403 when the rate limit is hit, so it is worth a retry like 429 and 5xx.
fn is_temporary(status: StatusCode) -> bool {
    status == StatusCode::FORBIDDEN
        || status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limit_and_server_errors_are_temporary() {
        for code in [403, 429, 500, 502, 503, 504] {
            assert!(is_temporary(StatusCode::from_u16(code).unwrap()), "{code}");
        }
    }

    #[test]
    fn a_bad_request_is_not_retried() {
        assert!(!is_temporary(StatusCode::BAD_REQUEST));
        assert!(!is_temporary(StatusCode::NOT_FOUND));
    }

    #[test]
    fn unavailable_maps_to_the_nvd_job_error() {
        let err = NvdError::Unavailable {
            attempts: 3,
            last: "status 503".into(),
        };
        assert_eq!(
            JobError::from(err).code(),
            crate::contract::JobErrorCode::NvdUnavailable
        );
    }
}
