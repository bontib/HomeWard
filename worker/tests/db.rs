//! Tests that need a migrated Postgres. Set `TEST_DATABASE_URL` (CI sets it and also
//! `REQUIRE_DB_TESTS=1`). Without it these tests print a note and pass.
#![allow(clippy::expect_used)]

use sqlx::PgPool;
use worker::db;

async fn test_pool() -> Option<PgPool> {
    match std::env::var("TEST_DATABASE_URL") {
        Ok(url) => Some(
            PgPool::connect(&url)
                .await
                .expect("connect to TEST_DATABASE_URL"),
        ),
        Err(_) if std::env::var("REQUIRE_DB_TESTS").is_ok_and(|v| v == "1") => {
            panic!("REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is not set")
        }
        Err(_) => {
            eprintln!("skipping: TEST_DATABASE_URL is not set");
            None
        }
    }
}

#[tokio::test]
async fn check_schema_passes_on_a_migrated_database() {
    let Some(pool) = test_pool().await else {
        return;
    };
    db::check_schema(&pool).await.expect("schema is complete");
}

#[tokio::test]
async fn worker_enums_can_be_read_from_postgres() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let status: worker::contract::DeviceStatus =
        sqlx::query_scalar("SELECT 'NO_KNOWN_VULNS'::device_status")
            .fetch_one(&pool)
            .await
            .expect("decode device_status");
    assert_eq!(status, worker::contract::DeviceStatus::NoKnownVulns);
}
