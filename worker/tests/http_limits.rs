//! Redirect and body-size guards for answers from the internet.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use worker::http_limits::{read_capped, same_host_redirects, BodyError};

/// Answers every request with the given raw response and returns the port.
async fn serve_raw(response: String) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let response = response.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf).await;
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    port
}

fn client() -> reqwest::Client {
    worker::install_crypto_provider();
    reqwest::Client::builder()
        .redirect(same_host_redirects())
        .build()
        .unwrap()
}

#[tokio::test]
async fn a_redirect_to_another_host_is_not_followed() {
    let target = serve_raw("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok".into()).await;
    let redirect = format!(
        "HTTP/1.1 302 Found\r\nLocation: http://localhost:{target}/\r\nContent-Length: 0\r\n\r\n"
    );
    let port = serve_raw(redirect).await;
    let response = client()
        .get(format!("http://127.0.0.1:{port}/"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 302);
}

#[tokio::test]
async fn a_redirect_on_the_same_host_is_followed() {
    let target = serve_raw("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok".into()).await;
    let redirect = format!(
        "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{target}/\r\nContent-Length: 0\r\n\r\n"
    );
    let port = serve_raw(redirect).await;
    let response = client()
        .get(format!("http://127.0.0.1:{port}/"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 200);
}

#[tokio::test]
async fn a_body_over_the_cap_is_refused() {
    let body = "x".repeat(100);
    let port = serve_raw(format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    ))
    .await;
    let response = client()
        .get(format!("http://127.0.0.1:{port}/"))
        .send()
        .await
        .unwrap();
    let err = read_capped(response, 50).await.unwrap_err();
    assert!(matches!(err, BodyError::TooLarge(50)));
}

#[tokio::test]
async fn a_body_without_content_length_is_still_capped() {
    let body = "x".repeat(100);
    let port = serve_raw(format!(
        "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n{body}"
    ))
    .await;
    let response = client()
        .get(format!("http://127.0.0.1:{port}/"))
        .send()
        .await
        .unwrap();
    let err = read_capped(response, 50).await.unwrap_err();
    assert!(matches!(err, BodyError::TooLarge(50)));
}

#[tokio::test]
async fn a_small_body_is_returned() {
    let port = serve_raw("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok".into()).await;
    let response = client()
        .get(format!("http://127.0.0.1:{port}/"))
        .send()
        .await
        .unwrap();
    assert_eq!(read_capped(response, 50).await.unwrap(), b"ok");
}
