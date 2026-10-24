//! The Postgres job queue: claim, finish, retry and reap (architecture sections 4.3 and 4.4).
//! Web inserts jobs; the worker only changes their status columns.

use serde_json::Value;
use sqlx::PgPool;

use crate::contract::{JobStatus, JobType};
use crate::error::JobError;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ClaimedJob {
    pub id: String,
    #[sqlx(rename = "type")]
    pub job_type: JobType,
    pub payload: Value,
    pub attempts: i32,
    pub max_attempts: i32,
    pub user_id: Option<String>,
    pub device_id: Option<String>,
}

/// Takes the best due job of the given types. `SKIP LOCKED` keeps two claimers apart.
/// `attempts` counts here, so a job that kills the worker still runs out of attempts.
pub async fn claim(
    pool: &PgPool,
    types: &[JobType],
    instance_id: &str,
) -> Result<Option<ClaimedJob>, sqlx::Error> {
    sqlx::query_as::<_, ClaimedJob>(
        "UPDATE job
         SET status = 'RUNNING', attempts = attempts + 1, started_at = now(), locked_by = $2
         WHERE id = (
           SELECT id FROM job
           WHERE status = 'QUEUED' AND run_after <= now() AND type = ANY($1::job_type[])
           ORDER BY priority DESC, run_after, created_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING id, type, payload, attempts, max_attempts, user_id, device_id",
    )
    .bind(types)
    .bind(instance_id)
    .fetch_optional(pool)
    .await
}

/// Seconds to wait before attempt `attempts + 1`: 1 minute after the first try, 5 after that (D18).
pub fn backoff_seconds(attempts_so_far: i32) -> i64 {
    if attempts_so_far <= 1 {
        60
    } else {
        300
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Finished {
    Done,
    WillRetry,
    Failed,
    /// The row was not ours any more (reaped). The result is dropped.
    Lost,
}

pub async fn mark_done(
    pool: &PgPool,
    job_id: &str,
    instance_id: &str,
) -> Result<Finished, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE job SET status = 'DONE', finished_at = now(), error_code = NULL, error = NULL
         WHERE id = $1 AND status = 'RUNNING' AND locked_by = $2",
    )
    .bind(job_id)
    .bind(instance_id)
    .execute(pool)
    .await?;
    Ok(if result.rows_affected() == 1 {
        Finished::Done
    } else {
        Finished::Lost
    })
}

/// Records a failed attempt: back to the queue with a delay, or `FAILED` when it is the
/// last attempt or retrying cannot help.
pub async fn mark_failed(
    pool: &PgPool,
    job: &ClaimedJob,
    instance_id: &str,
    error: &JobError,
) -> Result<Finished, sqlx::Error> {
    let code = error.code();
    let retry = code.is_retryable() && job.attempts < job.max_attempts;
    let detail = truncate(&error.to_string(), 2000);
    let rows = if retry {
        sqlx::query(
            "UPDATE job SET status = 'QUEUED', run_after = now() + make_interval(secs => $3),
               error_code = $4, error = $5, locked_by = NULL
             WHERE id = $1 AND status = 'RUNNING' AND locked_by = $2",
        )
        .bind(&job.id)
        .bind(instance_id)
        .bind(backoff_seconds(job.attempts) as f64)
        .bind(code)
        .bind(detail)
        .execute(pool)
        .await?
        .rows_affected()
    } else {
        sqlx::query(
            "UPDATE job SET status = 'FAILED', finished_at = now(), error_code = $3, error = $4
             WHERE id = $1 AND status = 'RUNNING' AND locked_by = $2",
        )
        .bind(&job.id)
        .bind(instance_id)
        .bind(code)
        .bind(detail)
        .execute(pool)
        .await?
        .rows_affected()
    };
    Ok(match (rows, retry) {
        (0, _) => Finished::Lost,
        (_, true) => Finished::WillRetry,
        (_, false) => Finished::Failed,
    })
}

fn truncate(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Reaped {
    pub id: String,
    #[sqlx(rename = "type")]
    pub job_type: JobType,
    pub status: JobStatus,
    pub device_id: Option<String>,
}

/// Finds `RUNNING` jobs whose worker is gone and puts them back in the queue (or fails them).
/// At start (`startup = true`) every job locked by another instance counts; later only jobs
/// running longer than 15 minutes do (the longest timeout is 10).
pub async fn reap(
    pool: &PgPool,
    instance_id: &str,
    startup: bool,
) -> Result<Vec<Reaped>, sqlx::Error> {
    sqlx::query_as::<_, Reaped>(
        "UPDATE job
         SET status = CASE WHEN attempts >= max_attempts THEN 'FAILED'::job_status ELSE 'QUEUED'::job_status END,
             run_after = now() + interval '1 minute',
             finished_at = CASE WHEN attempts >= max_attempts THEN now() END,
             error_code = 'WORKER_LOST', locked_by = NULL
         WHERE status = 'RUNNING'
           AND (($2 AND locked_by IS DISTINCT FROM $1) OR started_at < now() - interval '15 minutes')
         RETURNING id, type, status, device_id",
    )
    .bind(instance_id)
    .bind(startup)
    .fetch_all(pool)
    .await
}

/// Inserts a system job unless one of the same type (and user) is already waiting or running.
/// Returns the new id, or `None` when one already exists.
pub async fn enqueue_unless_active(
    pool: &PgPool,
    job_type: JobType,
    payload: Value,
    priority: i32,
    user_id: Option<&str>,
) -> Result<Option<String>, sqlx::Error> {
    let id: Option<String> = sqlx::query_scalar(
        "INSERT INTO job (type, payload, priority, user_id)
         SELECT $1, $2, $3, $4
         WHERE NOT EXISTS (
           SELECT 1 FROM job
           WHERE type = $1 AND status IN ('QUEUED', 'RUNNING') AND user_id IS NOT DISTINCT FROM $4
         )
         RETURNING id",
    )
    .bind(job_type)
    .bind(payload)
    .bind(priority)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    if let Some(id) = &id {
        notify(pool, id).await?;
    }
    Ok(id)
}

pub async fn notify(pool: &PgPool, payload: &str) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_notify('jobs', $1)")
        .bind(payload)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_is_one_minute_then_five() {
        assert_eq!(backoff_seconds(1), 60);
        assert_eq!(backoff_seconds(2), 300);
        assert_eq!(backoff_seconds(3), 300);
    }

    #[test]
    fn truncate_cuts_long_text() {
        assert_eq!(truncate("abcdef", 3), "abc");
    }
}
