//! CISA's Known Exploited Vulnerabilities list.

use std::time::Duration;

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use thiserror::Error;

use crate::error::JobError;

/// The real list is about 1 MB. Anything near this size is not the list.
const MAX_BYTES: usize = 20 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Error)]
pub enum KevError {
    #[error("download failed: {0}")]
    Download(String),
    #[error("the list is not in the expected format: {0}")]
    Format(String),
}

impl From<KevError> for JobError {
    fn from(err: KevError) -> Self {
        Self::KevUnavailable(err.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KevEntry {
    pub cve_id: String,
    pub date_added: NaiveDate,
}

#[derive(Debug)]
pub struct KevList {
    pub entries: Vec<KevEntry>,
    pub released_at: Option<DateTime<Utc>>,
}

pub async fn fetch(http: &reqwest::Client, url: &str) -> Result<KevList, KevError> {
    let response = http
        .get(url)
        .timeout(TIMEOUT)
        .send()
        .await
        .map_err(|e| KevError::Download(e.to_string()))?;
    if !response.status().is_success() {
        return Err(KevError::Download(format!("status {}", response.status())));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| KevError::Download(e.to_string()))?;
    if bytes.len() > MAX_BYTES {
        return Err(KevError::Format("the file is too large".into()));
    }
    parse(&bytes)
}

pub fn parse(bytes: &[u8]) -> Result<KevList, KevError> {
    let root: Value = serde_json::from_slice(bytes).map_err(|e| KevError::Format(e.to_string()))?;
    let list = root
        .get("vulnerabilities")
        .and_then(Value::as_array)
        .ok_or_else(|| KevError::Format("no `vulnerabilities` list".into()))?;
    let entries: Vec<KevEntry> = list.iter().filter_map(read_entry).collect();
    // An empty list would clear every "exploited" mark; treat it as a broken download.
    if entries.is_empty() {
        return Err(KevError::Format("the list has no usable entries".into()));
    }
    let released_at = root
        .get("dateReleased")
        .and_then(Value::as_str)
        .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
        .map(|t| t.with_timezone(&Utc));
    Ok(KevList {
        entries,
        released_at,
    })
}

fn read_entry(item: &Value) -> Option<KevEntry> {
    let cve_id = item.get("cveID")?.as_str()?.trim().to_ascii_uppercase();
    if !is_cve_id(&cve_id) {
        return None;
    }
    let date_added =
        NaiveDate::parse_from_str(item.get("dateAdded")?.as_str()?, "%Y-%m-%d").ok()?;
    Some(KevEntry { cve_id, date_added })
}

fn is_cve_id(id: &str) -> bool {
    let mut parts = id.split('-');
    parts.next() == Some("CVE")
        && parts
            .next()
            .is_some_and(|y| y.len() == 4 && y.chars().all(|c| c.is_ascii_digit()))
        && parts
            .next()
            .is_some_and(|n| n.len() >= 4 && n.chars().all(|c| c.is_ascii_digit()))
        && parts.next().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEV: &str = include_str!("../tests/fixtures/kev/kev.json");

    #[test]
    fn valid_entries_are_read_and_bad_ones_skipped() {
        let list = parse(KEV.as_bytes()).unwrap();
        let ids: Vec<_> = list.entries.iter().map(|e| e.cve_id.as_str()).collect();
        assert_eq!(ids, ["CVE-2024-1111", "CVE-2021-44228"]);
    }

    #[test]
    fn the_release_time_is_read() {
        let list = parse(KEV.as_bytes()).unwrap();
        assert_eq!(
            list.released_at.map(|t| t.to_rfc3339()),
            Some("2026-10-20T14:30:12.400+00:00".to_string())
        );
    }

    #[test]
    fn an_empty_list_is_an_error_not_a_reset() {
        assert!(parse(br#"{"vulnerabilities": []}"#).is_err());
    }

    #[test]
    fn something_that_is_not_the_list_is_an_error() {
        assert!(parse(b"<html>").is_err());
        assert!(parse(br#"{"foo": 1}"#).is_err());
    }
}
