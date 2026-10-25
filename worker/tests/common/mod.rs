//! Helpers shared by the integration tests: a throwaway migrated database, a tiny HTTP
//! server that plays NVD / CISA, and a ready-made worker `Context`.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

pub mod smtp_sink;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{Connection, PgConnection, PgPool};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use worker::config::Config;
use worker::context::Context;
use worker::nvd::{NvdClient, NvdSettings};
use worker::trivy::Trivy;

static COUNTER: AtomicU32 = AtomicU32::new(0);

pub fn fixture_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(relative)
}

pub fn fixture(relative: &str) -> String {
    std::fs::read_to_string(fixture_path(relative)).expect("fixture file")
}

/// A database of its own, created from the Prisma migrations. Needs `TEST_DATABASE_URL`
/// to point at any database on a server where the user may create databases.
pub struct TestDb {
    pub pool: PgPool,
    name: String,
    admin_url: String,
}

impl TestDb {
    /// `None` (with a printed note) when no database is configured, unless `REQUIRE_DB_TESTS=1`.
    pub async fn new() -> Option<Self> {
        let Ok(admin_url) = std::env::var("TEST_DATABASE_URL") else {
            if std::env::var("REQUIRE_DB_TESTS").is_ok_and(|v| v == "1") {
                panic!("REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is not set");
            }
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            return None;
        };
        let name = format!(
            "hg_test_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        let admin_options = PgConnectOptions::from_str(&admin_url).expect("TEST_DATABASE_URL");
        let mut admin = PgConnection::connect_with(&admin_options)
            .await
            .expect("connect");
        sqlx::query(&format!("CREATE DATABASE {name}"))
            .execute(&mut admin)
            .await
            .expect("create test database");
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .connect_with(admin_options.database(&name).options([("TimeZone", "UTC")]))
            .await
            .expect("connect to test database");
        apply_migrations(&pool).await;
        Some(Self {
            pool,
            name,
            admin_url,
        })
    }

    pub async fn drop_database(self) {
        self.pool.close().await;
        let options = PgConnectOptions::from_str(&self.admin_url).expect("TEST_DATABASE_URL");
        let mut admin = PgConnection::connect_with(&options).await.expect("connect");
        let _ = sqlx::query(&format!(
            "DROP DATABASE IF EXISTS {} WITH (FORCE)",
            self.name
        ))
        .execute(&mut admin)
        .await;
    }

    pub async fn user(&self, id: &str) {
        sqlx::query("INSERT INTO app_user (id, name, email, updated_at) VALUES ($1, $1, $1 || '@example.com', now())")
            .bind(id)
            .execute(&self.pool)
            .await
            .unwrap();
    }

    /// A device with one manual component. Returns (device id, component id).
    pub async fn device(
        &self,
        user: &str,
        cpe: Option<&str>,
        version: Option<&str>,
    ) -> (String, String) {
        let device: String = sqlx::query_scalar(
            "INSERT INTO device (user_id, name, type, updated_at) VALUES ($1, 'Test device', 'CONSOLE', now()) RETURNING id",
        )
        .bind(user)
        .fetch_one(&self.pool)
        .await
        .unwrap();
        let component: String = sqlx::query_scalar(
            "INSERT INTO component (device_id, source, name, version, cpe)
             VALUES ($1, 'MANUAL', 'Xbox', $2, $3) RETURNING id",
        )
        .bind(&device)
        .bind(version)
        .bind(cpe)
        .fetch_one(&self.pool)
        .await
        .unwrap();
        (device, component)
    }

    /// Queues CHECK_DEVICE the way web's `enqueueCheck` does.
    pub async fn queue_check(&self, device: &str, user: &str) -> String {
        let job: String = sqlx::query_scalar(
            "INSERT INTO job (type, payload, priority, user_id, device_id)
             VALUES ('CHECK_DEVICE', jsonb_build_object('deviceId', $1::text), 10, $2, $1) RETURNING id",
        )
        .bind(device)
        .bind(user)
        .fetch_one(&self.pool)
        .await
        .unwrap();
        sqlx::query("UPDATE device SET check_state = 'CHECKING', check_job_id = $2 WHERE id = $1")
            .bind(device)
            .bind(&job)
            .execute(&self.pool)
            .await
            .unwrap();
        job
    }

    pub async fn scalar<T>(&self, sql: &str) -> T
    where
        T: for<'r> sqlx::Decode<'r, sqlx::Postgres> + sqlx::Type<sqlx::Postgres> + Send + Unpin,
    {
        sqlx::query_scalar(sql).fetch_one(&self.pool).await.unwrap()
    }
}

async fn apply_migrations(pool: &PgPool) {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/prisma/migrations");
    let mut folders: Vec<PathBuf> = std::fs::read_dir(&dir)
        .expect("migrations folder")
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    folders.sort();
    for folder in folders {
        let sql = std::fs::read_to_string(folder.join("migration.sql")).expect("migration.sql");
        sqlx::raw_sql(&sql)
            .execute(pool)
            .await
            .expect("apply migration");
    }
}

// ---------- A tiny HTTP server ----------

#[derive(Debug, Clone)]
pub struct Request {
    pub target: String,
    pub headers: HashMap<String, String>,
}

impl Request {
    pub fn path(&self) -> &str {
        self.target.split('?').next().unwrap_or("")
    }
}

pub struct Reply {
    pub status: u16,
    pub body: String,
}

impl Reply {
    pub fn ok(body: impl Into<String>) -> Self {
        Self {
            status: 200,
            body: body.into(),
        }
    }

    pub fn status(status: u16) -> Self {
        Self {
            status,
            body: "{}".into(),
        }
    }
}

type Handler = dyn Fn(&Request) -> Reply + Send + Sync;

pub struct MockServer {
    pub url: String,
    requests: Arc<Mutex<Vec<Request>>>,
}

impl MockServer {
    pub async fn start(handler: impl Fn(&Request) -> Reply + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let url = format!("http://{}", listener.local_addr().expect("addr"));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let handler: Arc<Handler> = Arc::new(handler);
        let seen = requests.clone();
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    return;
                };
                let handler = handler.clone();
                let seen = seen.clone();
                tokio::spawn(async move { serve(stream, handler, seen).await });
            }
        });
        Self { url, requests }
    }

    pub fn requests(&self) -> Vec<Request> {
        self.requests.lock().unwrap().clone()
    }

    pub fn count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }
}

async fn serve(
    mut stream: tokio::net::TcpStream,
    handler: Arc<Handler>,
    seen: Arc<Mutex<Vec<Request>>>,
) {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 1024];
    while !buffer.windows(4).any(|w| w == b"\r\n\r\n") {
        match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => return,
            Ok(n) => buffer.extend_from_slice(&chunk[..n]),
        }
    }
    let text = String::from_utf8_lossy(&buffer).into_owned();
    let mut lines = text.lines();
    let target = lines
        .next()
        .unwrap_or("")
        .split(' ')
        .nth(1)
        .unwrap_or("")
        .to_string();
    let headers = lines
        .take_while(|l| !l.is_empty())
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    let request = Request { target, headers };
    seen.lock().unwrap().push(request.clone());
    let reply = handler(&request);
    let response = format!(
        "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        reply.status,
        reply.body.len(),
        reply.body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// Plays NVD with the Xbox fixtures: one CVE page, one CPE page.
pub async fn nvd_with_fixtures() -> MockServer {
    MockServer::start(|req| match req.path() {
        "/rest/json/cves/2.0" => Reply::ok(fixture("nvd/cves_xbox.json")),
        "/rest/json/cpes/2.0" => Reply::ok(fixture("nvd/cpes_xbox.json")),
        _ => Reply::status(404),
    })
    .await
}

// ---------- A ready-made Context ----------

pub struct Setup {
    pub nvd_url: String,
    pub kev_url: String,
    pub trivy: PathBuf,
    pub cache_dir: PathBuf,
    pub api_key: Option<String>,
}

impl Setup {
    pub fn new(nvd_url: &str, cache_dir: &Path) -> Self {
        Self {
            nvd_url: nvd_url.to_string(),
            kev_url: "http://127.0.0.1:1/kev.json".to_string(),
            trivy: fixture_path("fake-trivy.sh"),
            cache_dir: cache_dir.to_path_buf(),
            api_key: None,
        }
    }
}

pub fn context(db: &TestDb, setup: &Setup) -> Context {
    let lookup = |name: &str| match name {
        "DATABASE_URL" => Some("postgres://unused".to_string()),
        "NVD_BASE_URL" => Some(setup.nvd_url.clone()),
        "KEV_URL" => Some(setup.kev_url.clone()),
        "TRIVY_PATH" => Some(setup.trivy.display().to_string()),
        "TRIVY_CACHE_DIR" => Some(setup.cache_dir.display().to_string()),
        "NVD_API_KEY" => setup.api_key.clone(),
        _ => None,
    };
    worker::install_crypto_provider();
    let config = Config::from_lookup_for_tests(lookup).expect("config");
    let nvd = NvdClient::new(NvdSettings {
        base_url: config.nvd_base_url.clone(),
        api_key: config.nvd_api_key.clone(),
        retry_delays: vec![Duration::from_millis(5), Duration::from_millis(5)],
    })
    .expect("nvd client");
    Context {
        pool: db.pool.clone(),
        trivy: Trivy::new(config.trivy_path.clone(), config.trivy_cache_dir.clone()),
        config,
        nvd,
        http: reqwest::Client::new(),
        mailer: None,
        instance_id: "test-instance".to_string(),
    }
}

/// Puts a (fake) Trivy database in place so SBOM scans can run.
pub fn install_trivy_db(cache_dir: &Path) {
    std::fs::create_dir_all(cache_dir.join("db")).unwrap();
    std::fs::write(cache_dir.join("db/trivy.db"), "fake").unwrap();
}
