//! Connecting to Postgres and checking that web has already created the schema.
//! The worker never creates or changes tables.

use std::time::Duration;

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use thiserror::Error;
use tracing::warn;

/// Tables the worker reads or writes. If one is missing, web has not run its migrations yet.
const REQUIRED_TABLES: &[&str] = &[
    "job",
    "device",
    "component",
    "finding",
    "vulnerability",
    "sbom",
    "cpe_product",
    "cpe_product_cve",
    "product_search",
    "kev_entry",
    "data_source",
    "worker_status",
];

#[derive(Debug, Error)]
pub enum DbError {
    #[error("could not connect to the database after {attempts} attempts: {source}")]
    Connect {
        attempts: u32,
        #[source]
        source: sqlx::Error,
    },
    #[error("the database has no table(s): {}. Start the web app first so it can run the migrations.", .0.join(", "))]
    SchemaMissing(Vec<String>),
    #[error("database query failed: {0}")]
    Query(#[from] sqlx::Error),
}

pub struct ConnectPolicy {
    pub pool_size: u32,
    pub max_attempts: u32,
    /// Wait before the second attempt; it doubles each time, up to 10 s.
    pub first_delay: Duration,
    /// How long one attempt may take (sqlx keeps trying a refused connection until this ends).
    pub attempt_timeout: Duration,
}

/// Retries because the database container may still be starting.
pub async fn connect_with_retry(url: &str, policy: &ConnectPolicy) -> Result<PgPool, DbError> {
    let max_attempts = policy.max_attempts;
    let mut delay = policy.first_delay;
    let mut attempt = 1;
    loop {
        let result = PgPoolOptions::new()
            .max_connections(policy.pool_size)
            .acquire_timeout(policy.attempt_timeout)
            .connect(url)
            .await;
        match result {
            Ok(pool) => return Ok(pool),
            Err(source) if attempt >= max_attempts => {
                return Err(DbError::Connect {
                    attempts: attempt,
                    source,
                })
            }
            Err(source) => {
                warn!(attempt, error = %source, "database not reachable yet, retrying");
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(Duration::from_secs(10));
                attempt += 1;
            }
        }
    }
}

pub async fn check_schema(pool: &PgPool) -> Result<(), DbError> {
    let found: Vec<String> = sqlx::query_scalar(
        "SELECT table_name::text FROM information_schema.tables \
         WHERE table_schema = 'public' AND table_name = ANY($1)",
    )
    .bind(REQUIRED_TABLES)
    .fetch_all(pool)
    .await?;
    let missing = missing_tables(&found);
    if missing.is_empty() {
        Ok(())
    } else {
        Err(DbError::SchemaMissing(missing))
    }
}

fn missing_tables(found: &[String]) -> Vec<String> {
    REQUIRED_TABLES
        .iter()
        .filter(|table| !found.iter().any(|f| f == *table))
        .map(|table| table.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_tables_lists_only_the_absent_ones() {
        let found: Vec<String> = REQUIRED_TABLES
            .iter()
            .filter(|t| **t != "sbom")
            .map(|t| t.to_string())
            .collect();
        assert_eq!(missing_tables(&found), vec!["sbom".to_string()]);
    }

    #[test]
    fn missing_tables_is_empty_when_all_exist() {
        let found: Vec<String> = REQUIRED_TABLES.iter().map(|t| t.to_string()).collect();
        assert!(missing_tables(&found).is_empty());
    }

    #[tokio::test]
    async fn connect_gives_up_after_the_last_attempt() {
        let policy = ConnectPolicy {
            pool_size: 1,
            max_attempts: 2,
            first_delay: Duration::from_millis(1),
            attempt_timeout: Duration::from_millis(200),
        };
        let result = connect_with_retry("postgres://u:p@127.0.0.1:1/db", &policy).await;
        assert!(matches!(result, Err(DbError::Connect { attempts: 2, .. })));
    }
}
