//! The other job types: product search, KEV import, status recompute, rescan, Trivy DB,
//! plus the lanes, the scheduler's start-up work and the heartbeat.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use std::sync::Arc;
use std::time::Duration;

use common::{
    context, fixture, install_trivy_db, nvd_with_fixtures, MockServer, Reply, Setup, TestDb,
};
use tokio::sync::watch;
use worker::contract::JobType;
use worker::queue;
use worker::runner::{self, Lane, Wakeups};
use worker::{heartbeat, scheduler};

const XBOX: &str = "cpe:2.3:o:microsoft:xbox_one_firmware";

async fn queue_job(db: &TestDb, job_type: &str, payload: &str) -> String {
    sqlx::query_scalar(&format!(
        "INSERT INTO job (type, payload) VALUES ('{job_type}', '{payload}'::jsonb) RETURNING id"
    ))
    .fetch_one(&db.pool)
    .await
    .unwrap()
}

async fn run_one(ctx: &worker::context::Context, types: &[JobType]) {
    let job = queue::claim(&ctx.pool, types, &ctx.instance_id)
        .await
        .unwrap()
        .unwrap();
    runner::process(ctx, job, None).await;
}

async fn job_status(db: &TestDb, id: &str) -> String {
    sqlx::query_scalar("SELECT status::text FROM job WHERE id = $1")
        .bind(id)
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

// ---------- SEARCH_PRODUCTS ----------

#[tokio::test]
async fn a_search_fills_the_product_cache_in_nvd_order() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    sqlx::query("INSERT INTO product_search (query, status) VALUES ('xbox', 'PENDING')")
        .execute(&db.pool)
        .await
        .unwrap();
    let job = queue_job(&db, "SEARCH_PRODUCTS", r#"{"query":"xbox"}"#).await;

    run_one(&ctx, &[JobType::SearchProducts]).await;

    assert_eq!(job_status(&db, &job).await, "DONE");
    let (status, cpes): (String, Vec<String>) =
        sqlx::query_as("SELECT status::text, cpes FROM product_search WHERE query = 'xbox'")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(status, "READY");
    assert_eq!(cpes[0], XBOX);
    assert_eq!(cpes.len(), 4);
    let (title, latest): (String, Option<String>) =
        sqlx::query_as("SELECT title, latest_version FROM cpe_product WHERE cpe = $1")
            .bind(XBOX)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(title, "Microsoft Xbox One Firmware");
    assert_eq!(latest.as_deref(), Some("10.0.19041.1500"));
    db.drop_database().await;
}

#[tokio::test]
async fn a_search_does_not_forget_the_cve_list_of_a_known_product() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    sqlx::query(
        "INSERT INTO cpe_product (cpe, part, vendor, product, title, fetched_at, cves_fetched_at)
         VALUES ($1, 'o', 'microsoft', 'xbox_one_firmware', 'old', now(), now())",
    )
    .bind(XBOX)
    .execute(&db.pool)
    .await
    .unwrap();
    queue_job(&db, "SEARCH_PRODUCTS", r#"{"query":"xbox"}"#).await;

    run_one(&ctx, &[JobType::SearchProducts]).await;

    let fetched: bool = db.scalar("SELECT cves_fetched_at IS NOT NULL FROM cpe_product WHERE product = 'xbox_one_firmware'").await;
    assert!(fetched);
    db.drop_database().await;
}

#[tokio::test]
async fn a_search_that_nvd_cannot_answer_marks_the_search_failed() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = MockServer::start(|_| Reply::status(503)).await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    let job = queue_job(&db, "SEARCH_PRODUCTS", r#"{"query":"xbox"}"#).await;
    sqlx::query("UPDATE job SET max_attempts = 1")
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO product_search (query, status, job_id) VALUES ('xbox', 'PENDING', $1)",
    )
    .bind(&job)
    .execute(&db.pool)
    .await
    .unwrap();

    run_one(&ctx, &[JobType::SearchProducts]).await;

    assert_eq!(job_status(&db, &job).await, "FAILED");
    let status: String = db.scalar("SELECT status::text FROM product_search").await;
    assert_eq!(status, "FAILED");
    db.drop_database().await;
}

// ---------- IMPORT_KEV ----------

async fn kev_server() -> MockServer {
    MockServer::start(|_| Reply::ok(fixture("kev/kev.json"))).await
}

#[tokio::test]
async fn kev_import_marks_cves_exploited_and_queues_a_recompute_for_affected_devices() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let kev = kev_server().await;
    let cache = tempfile::tempdir().unwrap();
    let mut setup = Setup::new(&nvd.url, cache.path());
    setup.kev_url = format!("{}/kev.json", kev.url);
    let ctx = context(&db, &setup);
    db.user("u1").await;
    let (device, _) = db.device("u1", Some(XBOX), Some("10.0.19041.1000")).await;
    // CVE-2024-1111 is critical (9.8) already; make it low so the KEV mark is what changes the level.
    db.queue_check(&device, "u1").await;
    run_one(&ctx, &[JobType::CheckDevice]).await;
    sqlx::query("UPDATE vulnerability SET cvss_score = 3.0, severity = 'LOW'")
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE device SET status = 'UPDATE_AVAILABLE'")
        .execute(&db.pool)
        .await
        .unwrap();
    queue_job(&db, "IMPORT_KEV", "{}").await;

    run_one(&ctx, &[JobType::ImportKev]).await;

    let exploited: bool = db
        .scalar("SELECT exploited FROM vulnerability WHERE id = 'CVE-2024-1111'")
        .await;
    assert!(exploited);
    assert_eq!(db.scalar::<i64>("SELECT count(*) FROM kev_entry").await, 2);
    let recompute: i64 = db
        .scalar("SELECT count(*) FROM job WHERE type = 'RECOMPUTE_STATUS' AND status = 'QUEUED' AND device_id IS NOT NULL")
        .await;
    assert_eq!(recompute, 1);

    run_one(&ctx, &[JobType::RecomputeStatus]).await;
    let status: String = db.scalar("SELECT status::text FROM device").await;
    assert_eq!(
        status, "CRITICAL",
        "an exploited CVE is critical whatever its score"
    );
    let source: (Option<chrono::NaiveDateTime>, String) =
        sqlx::query_as("SELECT data_updated_at, id::text FROM data_source WHERE id = 'KEV'")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert!(source.0.is_some());
    db.drop_database().await;
}

#[tokio::test]
async fn kev_marks_stay_correct_for_cves_fetched_after_the_import() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let kev = kev_server().await;
    let cache = tempfile::tempdir().unwrap();
    let mut setup = Setup::new(&nvd.url, cache.path());
    setup.kev_url = format!("{}/kev.json", kev.url);
    let ctx = context(&db, &setup);
    queue_job(&db, "IMPORT_KEV", "{}").await;
    run_one(&ctx, &[JobType::ImportKev]).await;

    db.user("u1").await;
    let (device, _) = db.device("u1", Some(XBOX), Some("10.0.19041.1000")).await;
    db.queue_check(&device, "u1").await;
    run_one(&ctx, &[JobType::CheckDevice]).await;

    let exploited: bool = db
        .scalar("SELECT exploited FROM vulnerability WHERE id = 'CVE-2024-1111'")
        .await;
    assert!(exploited);
    db.drop_database().await;
}

#[tokio::test]
async fn a_broken_kev_download_keeps_the_old_list() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let kev = MockServer::start(|_| Reply::ok("<html>oops</html>")).await;
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let mut setup = Setup::new(&nvd.url, cache.path());
    setup.kev_url = format!("{}/kev.json", kev.url);
    let ctx = context(&db, &setup);
    sqlx::query("INSERT INTO kev_entry (cve_id, date_added, imported_at) VALUES ('CVE-2020-0001', '2020-01-01', now())")
        .execute(&db.pool)
        .await
        .unwrap();
    let job = queue_job(&db, "IMPORT_KEV", "{}").await;
    sqlx::query("UPDATE job SET max_attempts = 1")
        .execute(&db.pool)
        .await
        .unwrap();

    run_one(&ctx, &[JobType::ImportKev]).await;

    assert_eq!(job_status(&db, &job).await, "FAILED");
    assert_eq!(db.scalar::<i64>("SELECT count(*) FROM kev_entry").await, 1);
    let code: String = db
        .scalar("SELECT last_error_code::text FROM data_source WHERE id = 'KEV'")
        .await;
    assert_eq!(code, "KEV_UNAVAILABLE");
    db.drop_database().await;
}

// ---------- RECOMPUTE_STATUS ----------

#[tokio::test]
async fn ignoring_a_finding_and_recomputing_lowers_the_status() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user("u1").await;
    let (device, _) = db.device("u1", Some(XBOX), Some("10.0.19041.1000")).await;
    db.queue_check(&device, "u1").await;
    run_one(&ctx, &[JobType::CheckDevice]).await;
    sqlx::query("UPDATE finding SET state = 'IGNORED', ignored_reason = 'x'")
        .execute(&db.pool)
        .await
        .unwrap();
    queue_job(
        &db,
        "RECOMPUTE_STATUS",
        &format!(r#"{{"deviceId":"{device}"}}"#),
    )
    .await;

    run_one(&ctx, &[JobType::RecomputeStatus]).await;

    let (status, open, target): (String, i32, Option<String>) =
        sqlx::query_as("SELECT status::text, open_finding_count, target_version FROM device")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!((status.as_str(), open, target), ("NO_KNOWN_VULNS", 0, None));
    db.drop_database().await;
}

#[tokio::test]
async fn recompute_for_a_deleted_device_is_done() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    let job = queue_job(&db, "RECOMPUTE_STATUS", r#"{"deviceId":"gone"}"#).await;
    run_one(&ctx, &[JobType::RecomputeStatus]).await;
    assert_eq!(job_status(&db, &job).await, "DONE");
    db.drop_database().await;
}

#[tokio::test]
async fn a_bad_payload_fails_at_once_without_a_retry() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    let job = queue_job(&db, "RECOMPUTE_STATUS", r#"{"wrong":1}"#).await;
    run_one(&ctx, &[JobType::RecomputeStatus]).await;
    let (status, code, attempts): (String, String, i32) =
        sqlx::query_as("SELECT status::text, error_code::text, attempts FROM job WHERE id = $1")
            .bind(&job)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        (status.as_str(), code.as_str(), attempts),
        ("FAILED", "BAD_PAYLOAD", 1)
    );
    db.drop_database().await;
}

// ---------- RESCAN_ALL ----------

#[tokio::test]
async fn rescan_queues_one_low_priority_check_per_device_without_one_waiting() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let kev = kev_server().await;
    let cache = tempfile::tempdir().unwrap();
    let mut setup = Setup::new(&nvd.url, cache.path());
    setup.kev_url = format!("{}/kev.json", kev.url);
    let ctx = context(&db, &setup);
    db.user("u1").await;
    db.user("u2").await;
    let (waiting, _) = db.device("u1", None, None).await;
    let (second, _) = db.device("u1", None, None).await;
    let (other_user, _) = db.device("u2", None, None).await;
    let existing = db.queue_check(&waiting, "u1").await;
    queue_job(&db, "RESCAN_ALL", r#"{"userId":null}"#).await;

    run_one(&ctx, &[JobType::RescanAll]).await;

    let checks: i64 = db
        .scalar("SELECT count(*) FROM job WHERE type = 'CHECK_DEVICE' AND status = 'QUEUED'")
        .await;
    assert_eq!(checks, 3);
    let low: i64 = db
        .scalar("SELECT count(*) FROM job WHERE type = 'CHECK_DEVICE' AND priority = 0")
        .await;
    assert_eq!(
        low, 2,
        "the check that was already waiting keeps its own priority"
    );
    for device in [&second, &other_user] {
        let state: String =
            sqlx::query_scalar("SELECT check_state::text FROM device WHERE id = $1")
                .bind(device)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(state, "CHECKING");
    }
    let still: String = sqlx::query_scalar("SELECT check_job_id FROM device WHERE id = $1")
        .bind(&waiting)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(still, existing);
    db.drop_database().await;
}

#[tokio::test]
async fn a_rescan_for_one_user_only_touches_that_users_devices() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let kev = kev_server().await;
    let cache = tempfile::tempdir().unwrap();
    let mut setup = Setup::new(&nvd.url, cache.path());
    setup.kev_url = format!("{}/kev.json", kev.url);
    let ctx = context(&db, &setup);
    db.user("u1").await;
    db.user("u2").await;
    db.device("u1", None, None).await;
    db.device("u2", None, None).await;
    queue_job(&db, "RESCAN_ALL", r#"{"userId":"u1"}"#).await;

    run_one(&ctx, &[JobType::RescanAll]).await;

    let users: Vec<String> =
        sqlx::query_scalar("SELECT user_id FROM job WHERE type = 'CHECK_DEVICE'")
            .fetch_all(&db.pool)
            .await
            .unwrap();
    assert_eq!(users, ["u1"]);
    db.drop_database().await;
}

#[tokio::test]
async fn rescan_refreshes_old_outside_data_but_goes_on_when_that_fails() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let kev = MockServer::start(|_| Reply::status(500)).await;
    let cache = tempfile::tempdir().unwrap();
    let mut setup = Setup::new(&nvd.url, cache.path());
    setup.kev_url = format!("{}/kev.json", kev.url);
    let ctx = context(&db, &setup);
    db.user("u1").await;
    db.device("u1", None, None).await;
    let job = queue_job(&db, "RESCAN_ALL", r#"{"userId":null}"#).await;

    run_one(&ctx, &[JobType::RescanAll]).await;

    assert_eq!(job_status(&db, &job).await, "DONE");
    assert!(
        cache.path().join("db/trivy.db").is_file(),
        "Trivy DB was downloaded"
    );
    let kev_error: String = db
        .scalar("SELECT last_error_code::text FROM data_source WHERE id = 'KEV'")
        .await;
    assert_eq!(kev_error, "KEV_UNAVAILABLE");
    assert_eq!(
        db.scalar::<i64>("SELECT count(*) FROM job WHERE type = 'CHECK_DEVICE'")
            .await,
        1
    );
    db.drop_database().await;
}

#[tokio::test]
async fn rescan_skips_data_that_is_fresh_and_cleans_up_old_rows() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let kev = kev_server().await;
    let cache = tempfile::tempdir().unwrap();
    let mut setup = Setup::new(&nvd.url, cache.path());
    setup.kev_url = format!("{}/kev.json", kev.url);
    let ctx = context(&db, &setup);
    sqlx::query(
        "INSERT INTO data_source (id, last_success_at) VALUES ('TRIVY_DB', now()), ('KEV', now())",
    )
    .execute(&db.pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO job (type, payload, status, finished_at) VALUES ('DEV_NOOP', '{}', 'DONE', now() - interval '40 days')")
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO product_search (query, status, requested_at) VALUES ('old', 'READY', now() - interval '40 days')")
        .execute(&db.pool)
        .await
        .unwrap();
    queue_job(&db, "RESCAN_ALL", r#"{"userId":null}"#).await;

    run_one(&ctx, &[JobType::RescanAll]).await;

    assert_eq!(kev.count(), 0);
    assert!(!cache.path().join("db").exists());
    assert_eq!(
        db.scalar::<i64>("SELECT count(*) FROM job WHERE type = 'DEV_NOOP'")
            .await,
        0
    );
    assert_eq!(
        db.scalar::<i64>("SELECT count(*) FROM product_search")
            .await,
        0
    );
    db.drop_database().await;
}

// ---------- UPDATE_TRIVY_DB ----------

#[tokio::test]
async fn the_trivy_database_update_records_when_the_data_was_published() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    queue_job(&db, "UPDATE_TRIVY_DB", "{}").await;

    run_one(&ctx, &[JobType::UpdateTrivyDb]).await;

    let updated: String = db
        .scalar(
            "SELECT to_char(data_updated_at, 'YYYY-MM-DD') FROM data_source WHERE id = 'TRIVY_DB'",
        )
        .await;
    assert_eq!(updated, "2026-10-24");
    db.drop_database().await;
}

#[tokio::test]
async fn a_failing_trivy_database_update_is_noted_in_data_source() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let mut setup = Setup::new(&nvd.url, cache.path());
    setup.trivy = common::fixture_path("fake-trivy-broken.sh");
    let ctx = context(&db, &setup);
    let job = queue_job(&db, "UPDATE_TRIVY_DB", "{}").await;
    sqlx::query("UPDATE job SET max_attempts = 1")
        .execute(&db.pool)
        .await
        .unwrap();

    run_one(&ctx, &[JobType::UpdateTrivyDb]).await;

    assert_eq!(job_status(&db, &job).await, "FAILED");
    let code: String = db
        .scalar("SELECT last_error_code::text FROM data_source WHERE id = 'TRIVY_DB'")
        .await;
    assert_eq!(code, "TRIVY_FAILED");
    db.drop_database().await;
}

// ---------- DEV_NOOP and the lanes ----------

#[tokio::test]
async fn a_noop_job_that_sleeps_past_its_limit_times_out() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    let job = queue_job(&db, "DEV_NOOP", r#"{"sleepMs":2000}"#).await;
    let claimed = queue::claim(&ctx.pool, &[JobType::DevNoop], "test-instance")
        .await
        .unwrap()
        .unwrap();
    runner::process(&ctx, claimed, Some(Duration::from_millis(30))).await;
    let code: String = sqlx::query_scalar("SELECT error_code::text FROM job WHERE id = $1")
        .bind(&job)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(code, "TIMEOUT");
    db.drop_database().await;
}

async fn wait_for_status(db: &TestDb, id: &str, wanted: &str) -> bool {
    for _ in 0..100 {
        if job_status(db, id).await == wanted {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}

#[tokio::test]
async fn a_notification_wakes_the_lane_without_waiting_for_the_poll() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = Arc::new(context(&db, &Setup::new(&nvd.url, cache.path())));
    let wakeups = Arc::new(Wakeups::default());
    let (stop, shutdown) = watch::channel(false);
    let listener = tokio::spawn(runner::listen(
        db.pool.clone(),
        wakeups.clone(),
        shutdown.clone(),
    ));
    let lane = tokio::spawn(runner::run_lane(
        ctx.clone(),
        Lane::Fast,
        wakeups.clone(),
        shutdown.clone(),
    ));
    tokio::time::sleep(Duration::from_millis(300)).await; // lane idle, listener ready

    let job = queue_job(&db, "DEV_NOOP", "{}").await;
    queue::notify(&db.pool, &job).await.unwrap();

    assert!(
        wait_for_status(&db, &job, "DONE").await,
        "the job ran well before the 30 s poll"
    );
    stop.send(true).unwrap();
    lane.await.unwrap();
    listener.await.unwrap();
    db.drop_database().await;
}

#[tokio::test]
async fn the_fast_lane_ignores_checks_and_the_slow_lane_ignores_searches() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = Arc::new(context(&db, &Setup::new(&nvd.url, cache.path())));
    let wakeups = Arc::new(Wakeups::default());
    let (stop, shutdown) = watch::channel(false);
    let lane = tokio::spawn(runner::run_lane(
        ctx.clone(),
        Lane::Fast,
        wakeups.clone(),
        shutdown.clone(),
    ));
    let kev = queue_job(&db, "IMPORT_KEV", "{}").await;
    let noop = queue_job(&db, "DEV_NOOP", "{}").await;
    wakeups.fast.notify_one();

    assert!(wait_for_status(&db, &noop, "DONE").await);
    assert_eq!(job_status(&db, &kev).await, "QUEUED");
    stop.send(true).unwrap();
    lane.await.unwrap();
    db.drop_database().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_long_slow_lane_job_does_not_block_the_fast_lane() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    // NVD answers slowly, so the check keeps the slow lane busy.
    let nvd = MockServer::start(|req| {
        std::thread::sleep(Duration::from_millis(1500));
        Reply::ok(fixture(if req.path().contains("cpes") {
            "nvd/cpes_xbox.json"
        } else {
            "nvd/cves_xbox.json"
        }))
    })
    .await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = Arc::new(context(&db, &Setup::new(&nvd.url, cache.path())));
    let wakeups = Arc::new(Wakeups::default());
    let (stop, shutdown) = watch::channel(false);
    let slow = tokio::spawn(runner::run_lane(
        ctx.clone(),
        Lane::Slow,
        wakeups.clone(),
        shutdown.clone(),
    ));
    let fast = tokio::spawn(runner::run_lane(
        ctx.clone(),
        Lane::Fast,
        wakeups.clone(),
        shutdown.clone(),
    ));
    db.user("u1").await;
    let (device, _) = db.device("u1", Some(XBOX), Some("1.0")).await;
    let check = db.queue_check(&device, "u1").await;
    wakeups.slow.notify_one();
    assert!(wait_for_status(&db, &check, "RUNNING").await);

    let noop = queue_job(&db, "DEV_NOOP", "{}").await;
    wakeups.fast.notify_one();

    assert!(wait_for_status(&db, &noop, "DONE").await);
    assert_eq!(
        job_status(&db, &check).await,
        "RUNNING",
        "the check is still going"
    );
    stop.send(true).unwrap();
    slow.await.unwrap();
    fast.await.unwrap();
    db.drop_database().await;
}

// ---------- start-up work, heartbeat ----------

#[tokio::test]
async fn bootstrap_queues_missing_data_and_a_missed_rescan() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    db.user("u1").await;
    db.device("u1", None, None).await;

    scheduler::bootstrap(&db.pool, false).await.unwrap();
    scheduler::bootstrap(&db.pool, false).await.unwrap(); // second start: nothing doubles

    let types: Vec<String> = sqlx::query_scalar("SELECT type::text FROM job ORDER BY type::text")
        .fetch_all(&db.pool)
        .await
        .unwrap();
    assert_eq!(types, ["IMPORT_KEV", "RESCAN_ALL", "UPDATE_TRIVY_DB"]);
    db.drop_database().await;
}

#[tokio::test]
async fn bootstrap_with_data_in_place_and_no_devices_queues_nothing() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    sqlx::query("INSERT INTO kev_entry (cve_id, date_added, imported_at) VALUES ('CVE-2020-0001', '2020-01-01', now())")
        .execute(&db.pool)
        .await
        .unwrap();
    scheduler::bootstrap(&db.pool, true).await.unwrap();
    assert_eq!(db.scalar::<i64>("SELECT count(*) FROM job").await, 0);
    db.drop_database().await;
}

#[tokio::test]
async fn bootstrap_skips_the_catch_up_after_a_recent_rescan() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    db.user("u1").await;
    db.device("u1", None, None).await;
    sqlx::query("INSERT INTO kev_entry (cve_id, date_added, imported_at) VALUES ('CVE-2020-0001', '2020-01-01', now())")
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO job (type, payload, status, finished_at) VALUES ('RESCAN_ALL', '{\"userId\":null}', 'DONE', now())")
        .execute(&db.pool)
        .await
        .unwrap();
    scheduler::bootstrap(&db.pool, true).await.unwrap();
    assert_eq!(
        db.scalar::<i64>("SELECT count(*) FROM job WHERE status = 'QUEUED'")
            .await,
        0
    );
    db.drop_database().await;
}

#[tokio::test]
async fn the_heartbeat_makes_the_worker_look_alive_and_keeps_the_next_rescan_time() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    assert!(!heartbeat::is_alive(&db.pool, 90).await.unwrap());

    heartbeat::beat(&db.pool, &ctx.config, chrono::Utc::now())
        .await
        .unwrap();
    sqlx::query("UPDATE worker_status SET next_rescan_at = now() + interval '5 hours'")
        .execute(&db.pool)
        .await
        .unwrap();
    heartbeat::beat(&db.pool, &ctx.config, chrono::Utc::now())
        .await
        .unwrap();

    assert!(heartbeat::is_alive(&db.pool, 90).await.unwrap());
    let kept: bool = db
        .scalar("SELECT next_rescan_at IS NOT NULL FROM worker_status")
        .await;
    assert!(kept);
    sqlx::query("UPDATE worker_status SET heartbeat_at = now() - interval '5 minutes'")
        .execute(&db.pool)
        .await
        .unwrap();
    assert!(!heartbeat::is_alive(&db.pool, 90).await.unwrap());
    db.drop_database().await;
}

#[tokio::test]
async fn install_trivy_db_helper_makes_the_cache_look_ready() {
    let cache = tempfile::tempdir().unwrap();
    install_trivy_db(cache.path());
    let trivy = worker::trivy::Trivy::new("trivy".into(), cache.path().to_path_buf());
    assert!(trivy.has_db());
}
