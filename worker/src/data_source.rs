//! Freshness of the outside data sources (NVD, Trivy DB, KEV), shown in Settings > Checks.

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use tracing::warn;

use crate::contract::{DataSourceId, JobErrorCode};
use crate::error::JobError;

pub async fn record_success(
    pool: &PgPool,
    id: DataSourceId,
    data_updated_at: Option<DateTime<Utc>>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO data_source (id, last_attempt_at, last_success_at, data_updated_at, last_error_code)
         VALUES ($1, now(), now(), $2, NULL)
         ON CONFLICT (id) DO UPDATE SET
           last_attempt_at = now(), last_success_at = now(),
           data_updated_at = COALESCE($2, data_source.data_updated_at), last_error_code = NULL",
    )
    .bind(id)
    .bind(data_updated_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn record_failure(
    pool: &PgPool,
    id: DataSourceId,
    code: JobErrorCode,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO data_source (id, last_attempt_at, last_error_code) VALUES ($1, now(), $2)
         ON CONFLICT (id) DO UPDATE SET last_attempt_at = now(), last_error_code = $2",
    )
    .bind(id)
    .bind(code)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn last_success(
    pool: &PgPool,
    id: DataSourceId,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    let found: Option<Option<DateTime<Utc>>> =
        sqlx::query_scalar("SELECT last_success_at::timestamptz FROM data_source WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    Ok(found.flatten())
}

/// Notes the outcome of an outside call in `data_source`, then hands the result back.
/// A failure to write the note is logged and never hides the real result.
pub async fn track<T>(
    pool: &PgPool,
    id: DataSourceId,
    result: Result<T, JobError>,
) -> Result<T, JobError> {
    let noted = match &result {
        Ok(_) => record_success(pool, id, None).await,
        Err(err) => record_failure(pool, id, err.code()).await,
    };
    if let Err(err) = noted {
        warn!(source = ?id, error = %err, "could not update data_source");
    }
    result
}
