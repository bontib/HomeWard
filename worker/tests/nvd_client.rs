//! The NVD client against a mock server: retries, errors, paging, the API key header.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use common::{fixture, MockServer, Reply};
use worker::nvd::{NvdClient, NvdError, NvdSettings};

fn client(url: &str, key: Option<&str>) -> NvdClient {
    NvdClient::new(NvdSettings {
        base_url: url.to_string(),
        api_key: key.map(str::to_string),
        retry_delays: vec![Duration::from_millis(5), Duration::from_millis(5)],
    })
    .unwrap()
}

#[tokio::test]
async fn a_busy_server_is_retried_until_it_answers() {
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let server = MockServer::start(move |_| {
        if seen.fetch_add(1, Ordering::SeqCst) < 2 {
            Reply::status(503)
        } else {
            Reply::ok(fixture("nvd/cpes_xbox.json"))
        }
    })
    .await;
    let products = client(&server.url, None)
        .search_products("xbox")
        .await
        .unwrap();
    assert!(!products.is_empty());
    assert_eq!(server.count(), 3);
}

#[tokio::test]
async fn three_failures_in_a_row_give_up() {
    let server = MockServer::start(|_| Reply::status(403)).await;
    let err = client(&server.url, None)
        .search_products("xbox")
        .await
        .unwrap_err();
    assert!(matches!(err, NvdError::Unavailable { attempts: 3, .. }));
    assert_eq!(server.count(), 3);
}

#[tokio::test]
async fn a_bad_request_is_not_retried() {
    let server = MockServer::start(|_| Reply::status(404)).await;
    let err = client(&server.url, None)
        .search_products("xbox")
        .await
        .unwrap_err();
    assert!(matches!(err, NvdError::Rejected(_)));
    assert_eq!(server.count(), 1);
}

#[tokio::test]
async fn an_unreachable_server_is_unavailable() {
    let err = client("http://127.0.0.1:1", None)
        .search_products("xbox")
        .await
        .unwrap_err();
    assert!(matches!(err, NvdError::Unavailable { .. }));
}

#[tokio::test]
async fn the_api_key_is_sent_as_a_header_and_never_in_the_url() {
    let server = nvd_server().await;
    client(&server.url, Some("secret-key-123"))
        .search_products("xbox")
        .await
        .unwrap();
    let request = &server.requests()[0];
    assert_eq!(
        request.headers.get("apikey").map(String::as_str),
        Some("secret-key-123")
    );
    assert!(!request.target.contains("secret-key-123"));
}

#[tokio::test]
async fn no_key_means_no_header() {
    let server = nvd_server().await;
    client(&server.url, None)
        .search_products("xbox")
        .await
        .unwrap();
    assert!(!server.requests()[0].headers.contains_key("apikey"));
}

async fn nvd_server() -> MockServer {
    MockServer::start(|_| Reply::ok(fixture("nvd/cpes_xbox.json"))).await
}

#[tokio::test]
async fn the_search_text_is_sent_as_a_keyword() {
    let server = nvd_server().await;
    client(&server.url, None)
        .search_products("xbox one")
        .await
        .unwrap();
    let target = &server.requests()[0].target;
    assert!(target.starts_with("/rest/json/cpes/2.0?"));
    assert!(target.contains("keywordSearch=xbox") && target.contains("one"));
}

#[tokio::test]
async fn cve_pages_are_followed_until_all_results_are_read() {
    let server = MockServer::start(|req| {
        const TOTAL: usize = 5;
        let start: usize = req
            .target
            .split("startIndex=")
            .nth(1)
            .and_then(|rest| rest.split('&').next())
            .and_then(|n| n.parse().ok())
            .unwrap_or(0);
        let vulns: Vec<String> = (start..(start + 2).min(TOTAL))
            .map(|i| {
                format!(
                    r#"{{"cve": {{"id": "CVE-2024-{i:04}", "descriptions": [{{"lang": "en", "value": "x"}}]}}}}"#
                )
            })
            .collect();
        Reply::ok(format!(
            r#"{{"totalResults": {TOTAL}, "vulnerabilities": [{}]}}"#,
            vulns.join(",")
        ))
    })
    .await;
    let found = client(&server.url, None)
        .cves_for_product("cpe:2.3:o:a:b")
        .await
        .unwrap();
    assert_eq!(found.len(), 5);
    assert_eq!(server.count(), 3);
}

#[tokio::test]
async fn cves_are_requested_by_the_product_without_a_version() {
    let server = MockServer::start(|_| Reply::ok(fixture("nvd/cves_xbox.json"))).await;
    client(&server.url, None)
        .cves_for_product("cpe:2.3:o:microsoft:xbox_one_firmware")
        .await
        .unwrap();
    let target = &server.requests()[0].target;
    assert!(target.contains("virtualMatchString=cpe%3A2.3%3Ao%3Amicrosoft%3Axbox_one_firmware"));
}

#[tokio::test]
async fn an_answer_that_is_not_nvd_json_is_an_error_not_a_panic() {
    let server = MockServer::start(|_| Reply::ok(r#"{"unexpected": true}"#)).await;
    let err = client(&server.url, None)
        .cves_for_product("cpe:2.3:o:a:b")
        .await
        .unwrap_err();
    assert!(matches!(err, NvdError::Parse(_)));
}
