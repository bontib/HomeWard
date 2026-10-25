//! A tiny SMTP server on 127.0.0.1 for tests. It keeps the mails it accepts in memory.
//! No TLS, no AUTH: the worker connects with `SMTP_TLS=off`. Written by hand so the tests
//! need no new dependency.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use std::sync::{Arc, Mutex};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

#[derive(Debug, Clone, Copy)]
pub enum Behaviour {
    /// Takes every mail.
    Accept,
    /// Answers the end of the DATA with this reply, for example `550` or `451`.
    RejectWith(u16),
    /// Accepts the connection and then says nothing at all, not even a greeting.
    Silent,
}

pub struct SmtpSink {
    pub port: u16,
    mails: Arc<Mutex<Vec<String>>>,
}

impl SmtpSink {
    pub async fn start(behaviour: Behaviour) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let mails = Arc::new(Mutex::new(Vec::new()));
        let kept = mails.clone();
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    return;
                };
                let kept = kept.clone();
                tokio::spawn(async move { talk(stream, behaviour, kept).await });
            }
        });
        Self { port, mails }
    }

    /// Every accepted mail as raw text (headers and body).
    pub fn mails(&self) -> Vec<String> {
        self.mails.lock().unwrap().clone()
    }
}

async fn talk(stream: TcpStream, behaviour: Behaviour, mails: Arc<Mutex<Vec<String>>>) {
    if let Behaviour::Silent = behaviour {
        // Hold the connection open until the client gives up.
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        return;
    }
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    if write.write_all(b"220 sink ready\r\n").await.is_err() {
        return;
    }
    let mut in_data = false;
    let mut data = String::new();
    while let Ok(Some(line)) = lines.next_line().await {
        if in_data {
            if line == "." {
                in_data = false;
                let reply = match behaviour {
                    Behaviour::RejectWith(code) => format!("{code} not today\r\n"),
                    _ => {
                        mails.lock().unwrap().push(std::mem::take(&mut data));
                        "250 queued\r\n".to_string()
                    }
                };
                data.clear();
                if write.write_all(reply.as_bytes()).await.is_err() {
                    return;
                }
            } else {
                data.push_str(&line);
                data.push('\n');
            }
            continue;
        }
        let upper = line.to_ascii_uppercase();
        let reply: &[u8] = if upper.starts_with("EHLO") || upper.starts_with("HELO") {
            b"250 sink\r\n"
        } else if upper.starts_with("DATA") {
            in_data = true;
            b"354 go ahead\r\n"
        } else if upper.starts_with("QUIT") {
            let _ = write.write_all(b"221 bye\r\n").await;
            return;
        } else {
            b"250 ok\r\n"
        };
        if write.write_all(reply).await.is_err() {
            return;
        }
    }
}
