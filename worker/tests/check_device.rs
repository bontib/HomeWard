//! CHECK_DEVICE end to end: real Postgres, a mock NVD server and a fake trivy script.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use std::time::Duration;

use common::{
    context, fixture, install_trivy_db, nvd_with_fixtures, MockServer, Reply, Setup, TestDb,
};
use worker::contract::JobType;
use worker::queue;
use worker::runner;

const XBOX: &str = "cpe:2.3:o:microsoft:xbox_one_firmware";
const USER: &str = "u1";

/// Claims the next CHECK_DEVICE and runs it like the lane would.
async fn run_next_check(ctx: &worker::context::Context) -> Option<String> {
    let job = queue::claim(&ctx.pool, &[JobType::CheckDevice], &ctx.instance_id)
        .await
        .unwrap()?;
    let id = job.id.clone();
    runner::process(ctx, job, None).await;
    Some(id)
}

async fn device_row(db: &TestDb, device: &str) -> (String, i32, i32, i32, Option<String>, String) {
    sqlx::query_as(
        "SELECT status::text, open_finding_count, component_count, unchecked_count, target_version, check_state::text
         FROM device WHERE id = $1",
    )
    .bind(device)
    .fetch_one(&db.pool)
    .await
    .unwrap()
}

async fn finding_ids(db: &TestDb, device: &str) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT vulnerability_id FROM finding WHERE device_id = $1 ORDER BY vulnerability_id",
    )
    .bind(device)
    .fetch_all(&db.pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn an_old_version_gets_findings_a_status_and_a_target_version() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, component) = db.device(USER, Some(XBOX), Some("10.0.19041.1000")).await;
    db.queue_check(&device, USER).await;

    run_next_check(&ctx).await.unwrap();

    assert_eq!(finding_ids(&db, &device).await, ["CVE-2024-1111"]);
    let (status, open, components, unchecked, target, state) = device_row(&db, &device).await;
    assert_eq!(status, "CRITICAL");
    assert_eq!((open, components, unchecked), (1, 1, 0));
    assert_eq!(target.as_deref(), Some("10.0.19041.1500"));
    assert_eq!(state, "IDLE");
    let check: String = sqlx::query_scalar(r#"SELECT "check"::text FROM component WHERE id = $1"#)
        .bind(&component)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(check, "CHECKED");
    let last_checked: bool = db
        .scalar("SELECT last_checked_at IS NOT NULL FROM device")
        .await;
    assert!(last_checked);
    db.drop_database().await;
}

#[tokio::test]
async fn a_fixed_version_has_no_known_vulnerabilities() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, Some(XBOX), Some("10.0.19041.1500")).await;
    db.queue_check(&device, USER).await;

    run_next_check(&ctx).await.unwrap();

    assert!(finding_ids(&db, &device).await.is_empty());
    assert_eq!(device_row(&db, &device).await.0, "NO_KNOWN_VULNS");
    db.drop_database().await;
}

#[tokio::test]
async fn each_cve_is_matched_by_its_own_version_range() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, Some(XBOX), Some("9.5")).await;
    db.queue_check(&device, USER).await;

    run_next_check(&ctx).await.unwrap();

    // 9.5 is below the fix of CVE-2024-1111 and inside 9.0..=9.9 of CVE-2024-3333.
    assert_eq!(
        finding_ids(&db, &device).await,
        ["CVE-2024-1111", "CVE-2024-3333"]
    );
    let unscored: String =
        sqlx::query_scalar("SELECT severity::text FROM vulnerability WHERE id = 'CVE-2024-3333'")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(unscored, "UNKNOWN");
    db.drop_database().await;
}

#[tokio::test]
async fn running_the_check_twice_gives_the_same_rows() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, Some(XBOX), Some("10.0.19041.1000")).await;
    db.queue_check(&device, USER).await;
    run_next_check(&ctx).await.unwrap();
    let first: (String, chrono::DateTime<chrono::Utc>) =
        sqlx::query_as("SELECT id, first_seen_at::timestamptz FROM finding")
            .fetch_one(&db.pool)
            .await
            .unwrap();

    db.queue_check(&device, USER).await;
    run_next_check(&ctx).await.unwrap();

    let again: (String, chrono::DateTime<chrono::Utc>) =
        sqlx::query_as("SELECT id, first_seen_at::timestamptz FROM finding")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(first, again, "same finding row, first_seen_at untouched");
    assert_eq!(db.scalar::<i64>("SELECT count(*) FROM finding").await, 1);
    db.drop_database().await;
}

#[tokio::test]
async fn the_cve_list_is_fetched_once_while_it_is_fresh() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, Some(XBOX), Some("10.0.19041.1000")).await;
    for _ in 0..3 {
        db.queue_check(&device, USER).await;
        run_next_check(&ctx).await.unwrap();
    }
    assert_eq!(nvd.count(), 1);
    db.drop_database().await;
}

#[tokio::test]
async fn an_ignored_finding_stays_ignored_after_a_new_check() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, Some(XBOX), Some("10.0.19041.1000")).await;
    db.queue_check(&device, USER).await;
    run_next_check(&ctx).await.unwrap();
    sqlx::query(
        "UPDATE finding SET state = 'IGNORED', ignored_reason = 'Not exposed', ignored_at = now()",
    )
    .execute(&db.pool)
    .await
    .unwrap();

    db.queue_check(&device, USER).await;
    run_next_check(&ctx).await.unwrap();

    let (state, reason): (String, String) =
        sqlx::query_as("SELECT state::text, ignored_reason FROM finding")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        (state.as_str(), reason.as_str()),
        ("IGNORED", "Not exposed")
    );
    let (status, open, ..) = device_row(&db, &device).await;
    assert_eq!((status.as_str(), open), ("NO_KNOWN_VULNS", 0));
    db.drop_database().await;
}

#[tokio::test]
async fn a_finding_that_no_longer_applies_is_removed() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, component) = db.device(USER, Some(XBOX), Some("10.0.19041.1000")).await;
    db.queue_check(&device, USER).await;
    run_next_check(&ctx).await.unwrap();

    sqlx::query("UPDATE component SET version = '10.0.19041.1500' WHERE id = $1")
        .bind(&component)
        .execute(&db.pool)
        .await
        .unwrap();
    db.queue_check(&device, USER).await;
    run_next_check(&ctx).await.unwrap();

    assert!(finding_ids(&db, &device).await.is_empty());
    db.drop_database().await;
}

#[tokio::test]
async fn products_without_an_identifier_are_not_tracked() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, component) = db.device(USER, None, Some("1.0")).await;
    db.queue_check(&device, USER).await;

    run_next_check(&ctx).await.unwrap();

    let (status, _, _, unchecked, ..) = device_row(&db, &device).await;
    assert_eq!((status.as_str(), unchecked), ("NOT_TRACKED", 1));
    let check: String = sqlx::query_scalar(r#"SELECT "check"::text FROM component WHERE id = $1"#)
        .bind(&component)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(check, "NO_IDENTIFIER");
    assert_eq!(nvd.count(), 0, "no NVD call without a CPE");
    db.drop_database().await;
}

#[tokio::test]
async fn a_missing_or_unreadable_version_is_not_checked() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    for (version, expected) in [
        (None, "NO_VERSION"),
        (Some("beta build xyz"), "BAD_VERSION"),
    ] {
        let (device, component) = db.device(USER, Some(XBOX), version).await;
        db.queue_check(&device, USER).await;
        run_next_check(&ctx).await.unwrap();
        let check: String =
            sqlx::query_scalar(r#"SELECT "check"::text FROM component WHERE id = $1"#)
                .bind(&component)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(check, expected);
        assert_eq!(device_row(&db, &device).await.0, "NOT_TRACKED");
    }
    db.drop_database().await;
}

#[tokio::test]
async fn a_device_deleted_before_the_check_finishes_the_job_quietly() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, Some(XBOX), Some("1.0")).await;
    let job = db.queue_check(&device, USER).await;
    sqlx::query("DELETE FROM device WHERE id = $1")
        .bind(&device)
        .execute(&db.pool)
        .await
        .unwrap();

    run_next_check(&ctx).await.unwrap();

    let status: String = sqlx::query_scalar("SELECT status::text FROM job WHERE id = $1")
        .bind(&job)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(status, "DONE");
    db.drop_database().await;
}

#[tokio::test]
async fn nvd_down_with_no_cache_retries_later_and_keeps_the_device_checking() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = MockServer::start(|_| Reply::status(503)).await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, Some(XBOX), Some("1.0")).await;
    let job = db.queue_check(&device, USER).await;

    run_next_check(&ctx).await.unwrap();

    let (status, code, attempts): (String, String, i32) =
        sqlx::query_as("SELECT status::text, error_code::text, attempts FROM job WHERE id = $1")
            .bind(&job)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        (status.as_str(), code.as_str(), attempts),
        ("QUEUED", "NVD_UNAVAILABLE", 1)
    );
    assert_eq!(nvd.count(), 3, "three tries inside one attempt");
    assert_eq!(device_row(&db, &device).await.5, "CHECKING");
    let source: (String, Option<chrono::DateTime<chrono::Utc>>) = sqlx::query_as(
        "SELECT last_error_code::text, last_success_at FROM data_source WHERE id = 'NVD'",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(source.0, "NVD_UNAVAILABLE");
    db.drop_database().await;
}

#[tokio::test]
async fn nvd_down_after_the_third_attempt_marks_the_device_check_failed() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = MockServer::start(|_| Reply::status(429)).await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, Some(XBOX), Some("1.0")).await;
    db.queue_check(&device, USER).await;
    sqlx::query("UPDATE device SET status = 'CRITICAL'")
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE job SET attempts = 2")
        .execute(&db.pool)
        .await
        .unwrap();

    run_next_check(&ctx).await.unwrap();

    let (status, _, _, _, _, state) = device_row(&db, &device).await;
    assert_eq!(state, "FAILED");
    assert_eq!(
        status, "CRITICAL",
        "a failed check does not hide a known problem"
    );
    let code: String = db.scalar("SELECT check_error_code::text FROM device").await;
    assert_eq!(code, "NVD_UNAVAILABLE");
    db.drop_database().await;
}

#[tokio::test]
async fn nvd_down_with_an_old_cache_still_checks_against_the_cache() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, Some(XBOX), Some("10.0.19041.1000")).await;
    db.queue_check(&device, USER).await;
    run_next_check(&ctx).await.unwrap();
    // The list is now two days old and NVD is gone.
    sqlx::query("UPDATE cpe_product SET cves_fetched_at = now() - interval '2 days'")
        .execute(&db.pool)
        .await
        .unwrap();
    let down = MockServer::start(|_| Reply::status(503)).await;
    let ctx = context(&db, &Setup::new(&down.url, cache.path()));

    db.queue_check(&device, USER).await;
    run_next_check(&ctx).await.unwrap();

    assert_eq!(finding_ids(&db, &device).await, ["CVE-2024-1111"]);
    assert_eq!(device_row(&db, &device).await.5, "IDLE");
    let code: String = db
        .scalar("SELECT last_error_code::text FROM data_source WHERE id = 'NVD'")
        .await;
    assert_eq!(
        code, "NVD_UNAVAILABLE",
        "Settings still shows that NVD could not be reached"
    );
    db.drop_database().await;
}

#[tokio::test]
async fn a_newer_queued_check_keeps_the_device_checking() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, Some(XBOX), Some("1.0")).await;
    db.queue_check(&device, USER).await;
    let job = queue::claim(&ctx.pool, &[JobType::CheckDevice], "test-instance")
        .await
        .unwrap()
        .unwrap();
    // While it runs, the user edits the device and web queues another check.
    let newer = db.queue_check(&device, USER).await;

    runner::process(&ctx, job, None).await;

    let (_, _, _, _, _, state) = device_row(&db, &device).await;
    assert_eq!(state, "CHECKING");
    let waiting: String = db.scalar("SELECT check_job_id FROM device").await;
    assert_eq!(waiting, newer);
    db.drop_database().await;
}

// ---------- SBOM ----------

async fn add_sbom(db: &TestDb, device: &str, file: &str, format: &str) {
    sqlx::query(
        "INSERT INTO sbom (device_id, format, file_name, size_bytes, sha256, content)
         VALUES ($1, $2::sbom_format, 'sbom.json', 10, repeat('a', 64), $3)
         ON CONFLICT (device_id) DO UPDATE SET content = EXCLUDED.content, parsed_at = NULL",
    )
    .bind(device)
    .bind(format)
    .bind(fixture(file).into_bytes())
    .execute(&db.pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn an_sbom_is_parsed_scanned_and_only_understood_packages_count_as_checked() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    install_trivy_db(cache.path());
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, None, None).await;
    add_sbom(&db, &device, "sbom/cyclonedx.json", "CYCLONEDX").await;
    db.queue_check(&device, USER).await;

    run_next_check(&ctx).await.unwrap();

    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT name, "check"::text FROM component WHERE source = 'SBOM' ORDER BY name"#,
    )
    .fetch_all(&db.pool)
    .await
    .unwrap();
    let rows: Vec<(&str, &str)> = rows.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    assert_eq!(
        rows,
        [
            ("left-pad", "UNSUPPORTED"),
            ("log4j-core", "CHECKED"),
            ("mystery-lib", "NO_IDENTIFIER"),
            ("openssl", "UNSUPPORTED"),
            ("radio-fw", "UNSUPPORTED"),
            ("zlib", "CHECKED"),
        ]
    );
    assert_eq!(
        finding_ids(&db, &device).await,
        ["CVE-2021-44228", "GHSA-8489-44mv-ggj8"]
    );
    let (status, open, components, unchecked, ..) = device_row(&db, &device).await;
    assert_eq!(status, "CRITICAL");
    assert_eq!((open, components, unchecked), (2, 7, 5));
    let parsed: bool = db.scalar("SELECT parsed_at IS NOT NULL FROM sbom").await;
    assert!(parsed);
    let source: String = db
        .scalar("SELECT details_source::text FROM vulnerability WHERE id = 'CVE-2021-44228'")
        .await;
    assert_eq!(source, "TRIVY");
    db.drop_database().await;
}

#[tokio::test]
async fn a_new_upload_keeps_the_rows_and_ignored_findings_of_unchanged_components() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    install_trivy_db(cache.path());
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, None, None).await;
    add_sbom(&db, &device, "sbom/cyclonedx.json", "CYCLONEDX").await;
    db.queue_check(&device, USER).await;
    run_next_check(&ctx).await.unwrap();
    sqlx::query("UPDATE finding SET state = 'IGNORED', ignored_reason = 'ok' WHERE vulnerability_id = 'CVE-2021-44228'")
        .execute(&db.pool)
        .await
        .unwrap();
    let before: Vec<String> =
        sqlx::query_scalar("SELECT id FROM component WHERE source = 'SBOM' ORDER BY id")
            .fetch_all(&db.pool)
            .await
            .unwrap();

    add_sbom(&db, &device, "sbom/cyclonedx.json", "CYCLONEDX").await;
    db.queue_check(&device, USER).await;
    run_next_check(&ctx).await.unwrap();

    let after: Vec<String> =
        sqlx::query_scalar("SELECT id FROM component WHERE source = 'SBOM' ORDER BY id")
            .fetch_all(&db.pool)
            .await
            .unwrap();
    assert_eq!(before, after);
    let state: String = db
        .scalar("SELECT state::text FROM finding WHERE vulnerability_id = 'CVE-2021-44228'")
        .await;
    assert_eq!(state, "IGNORED");
    db.drop_database().await;
}

#[tokio::test]
async fn an_invalid_sbom_fails_the_check_at_once() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    install_trivy_db(cache.path());
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, None, None).await;
    sqlx::query(
        "INSERT INTO sbom (device_id, format, file_name, size_bytes, sha256, content)
         VALUES ($1, 'CYCLONEDX', 'x.json', 5, repeat('b', 64), 'not json')",
    )
    .bind(&device)
    .execute(&db.pool)
    .await
    .unwrap();
    let job = db.queue_check(&device, USER).await;

    run_next_check(&ctx).await.unwrap();

    let (status, attempts): (String, i32) =
        sqlx::query_as("SELECT status::text, attempts FROM job WHERE id = $1")
            .bind(&job)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!((status.as_str(), attempts), ("FAILED", 1));
    let (state, code): (String, String) =
        sqlx::query_as("SELECT check_state::text, check_error_code::text FROM device")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!((state.as_str(), code.as_str()), ("FAILED", "SBOM_INVALID"));
    db.drop_database().await;
}

#[tokio::test]
async fn a_missing_trivy_database_fails_the_attempt_and_queues_a_download() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap(); // no db inside
    let ctx = context(&db, &Setup::new(&nvd.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, None, None).await;
    add_sbom(&db, &device, "sbom/cyclonedx.json", "CYCLONEDX").await;
    let job = db.queue_check(&device, USER).await;

    run_next_check(&ctx).await.unwrap();

    let code: String = sqlx::query_scalar("SELECT error_code::text FROM job WHERE id = $1")
        .bind(&job)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(code, "TRIVY_DB_MISSING");
    let queued: i64 = db
        .scalar("SELECT count(*) FROM job WHERE type = 'UPDATE_TRIVY_DB' AND status = 'QUEUED'")
        .await;
    assert_eq!(queued, 1);
    db.drop_database().await;
}

#[tokio::test]
async fn a_crashing_trivy_is_reported_as_trivy_failed() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let nvd = nvd_with_fixtures().await;
    let cache = tempfile::tempdir().unwrap();
    install_trivy_db(cache.path());
    let mut setup = Setup::new(&nvd.url, cache.path());
    setup.trivy = common::fixture_path("fake-trivy-broken.sh");
    let ctx = context(&db, &setup);
    db.user(USER).await;
    let (device, _) = db.device(USER, None, None).await;
    add_sbom(&db, &device, "sbom/cyclonedx.json", "CYCLONEDX").await;
    let job = db.queue_check(&device, USER).await;

    run_next_check(&ctx).await.unwrap();

    let (code, detail): (String, String) =
        sqlx::query_as("SELECT error_code::text, error FROM job WHERE id = $1")
            .bind(&job)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(code, "TRIVY_FAILED");
    assert!(detail.contains("something went wrong"));
    db.drop_database().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_check_that_takes_too_long_is_stopped_and_retried() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    // NVD answers slowly: the answer comes after the job's time limit.
    let slow = MockServer::start(|_| {
        std::thread::sleep(Duration::from_millis(400));
        Reply::ok(fixture("nvd/cves_xbox.json"))
    })
    .await;
    let cache = tempfile::tempdir().unwrap();
    let ctx = context(&db, &Setup::new(&slow.url, cache.path()));
    db.user(USER).await;
    let (device, _) = db.device(USER, Some(XBOX), Some("1.0")).await;
    let job = db.queue_check(&device, USER).await;
    let claimed = queue::claim(&ctx.pool, &[JobType::CheckDevice], "test-instance")
        .await
        .unwrap()
        .unwrap();

    runner::process(&ctx, claimed, Some(Duration::from_millis(50))).await;

    let (status, code): (String, String) =
        sqlx::query_as("SELECT status::text, error_code::text FROM job WHERE id = $1")
            .bind(&job)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!((status.as_str(), code.as_str()), ("QUEUED", "TIMEOUT"));
    db.drop_database().await;
}
