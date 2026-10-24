//! Guards for answers from the internet: no redirects to other hosts, and a size cap that
//! holds even when the server lies about (or leaves out) Content-Length.

use reqwest::redirect::Policy;
use reqwest::Response;
use thiserror::Error;

const MAX_REDIRECTS: usize = 3;

/// Follows a few redirects, but only within the same host.
pub fn same_host_redirects() -> Policy {
    Policy::custom(|attempt| {
        let same_host = attempt
            .previous()
            .last()
            .is_some_and(|prev| prev.host_str() == attempt.url().host_str());
        if attempt.previous().len() >= MAX_REDIRECTS || !same_host {
            attempt.stop()
        } else {
            attempt.follow()
        }
    })
}

#[derive(Debug, Error)]
pub enum BodyError {
    #[error("the answer is larger than {0} bytes")]
    TooLarge(usize),
    #[error("{0}")]
    Read(#[from] reqwest::Error),
}

/// Reads the body chunk by chunk and stops as soon as it is over `max_bytes`.
pub async fn read_capped(mut response: Response, max_bytes: usize) -> Result<Vec<u8>, BodyError> {
    let declared = response.content_length().unwrap_or(0);
    if declared > max_bytes as u64 {
        return Err(BodyError::TooLarge(max_bytes));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > max_bytes {
            return Err(BodyError::TooLarge(max_bytes));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}
