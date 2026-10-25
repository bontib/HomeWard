//! What to clean up when a job has failed for good (architecture section 4.3, `on_failed`).
//! Status and findings of a device are never touched here: a failed re-check must not
//! hide a known problem.

use sqlx::PgPool;

use crate::contract::{DataSourceId, JobErrorCode, JobType};
use crate::data_source;

pub async fn on_failed(
    pool: &PgPool,
    job_id: &str,
    job_type: JobType,
    device_id: Option<&str>,
    code: JobErrorCode,
) -> Result<(), sqlx::Error> {
    match job_type {
        JobType::CheckDevice => {
            if let Some(device_id) = device_id {
                sqlx::query(
                    "UPDATE device SET check_state = 'FAILED', check_error_code = $3
                     WHERE id = $1 AND check_job_id = $2",
                )
                .bind(device_id)
                .bind(job_id)
                .bind(code)
                .execute(pool)
                .await?;
            }
        }
        JobType::SearchProducts => {
            sqlx::query("UPDATE product_search SET status = 'FAILED' WHERE job_id = $1")
                .bind(job_id)
                .execute(pool)
                .await?;
        }
        JobType::ImportKev => data_source::record_failure(pool, DataSourceId::Kev, code).await?,
        JobType::UpdateTrivyDb => {
            data_source::record_failure(pool, DataSourceId::TrivyDb, code).await?;
        }
        JobType::SendEmail => release_findings_of_failed_mail(pool, job_id, code).await?,
        // Rerunning a failed digest is safe, so it needs no cleanup.
        JobType::RecomputeStatus | JobType::RescanAll | JobType::DevNoop | JobType::SendDigest => {}
    }
    Ok(())
}

/// A mail that failed for good no longer counts as "told": its findings become new again,
/// so the next daily summary picks them up (N-D12). Running it twice changes nothing.
async fn release_findings_of_failed_mail(
    pool: &PgPool,
    job_id: &str,
    code: JobErrorCode,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "WITH n AS (
           UPDATE notification SET status = 'FAILED', error_code = $2, link_token = NULL
           WHERE id = (SELECT payload->>'notificationId' FROM job WHERE id = $1)
             AND status = 'QUEUED'
           RETURNING id)
         UPDATE finding SET notified_at = NULL, notification_id = NULL
         WHERE notification_id IN (SELECT id FROM n)",
    )
    .bind(job_id)
    .bind(code)
    .execute(pool)
    .await?;
    Ok(())
}
