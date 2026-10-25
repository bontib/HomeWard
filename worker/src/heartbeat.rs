//! Proof of life and housekeeping: every 30 s write `worker_status` and reap stuck jobs
//! (architecture section 4.4). The web app reads `heartbeat_at` for "the scanner is on".

use std::time::Duration;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use tokio::sync::watch;
use tracing::{error, warn};

use crate::config::Config;
use crate::contract::JobStatus;
use crate::hooks;
use crate::queue;

pub const INTERVAL: Duration = Duration::from_secs(30);

pub async fn beat(
    pool: &PgPool,
    config: &Config,
    started_at: DateTime<Utc>,
    smtp_on: bool,
) -> Result<(), sqlx::Error> {
    // next_rescan_at belongs to the scheduler; this upsert leaves it alone.
    sqlx::query(
        "INSERT INTO worker_status
           (id, started_at, heartbeat_at, version, rescan_cron, nvd_api_key_set, smtp_configured, time_zone)
         VALUES (1, $1, now(), $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           started_at = EXCLUDED.started_at, heartbeat_at = now(), version = EXCLUDED.version,
           rescan_cron = EXCLUDED.rescan_cron, nvd_api_key_set = EXCLUDED.nvd_api_key_set,
           smtp_configured = EXCLUDED.smtp_configured, time_zone = EXCLUDED.time_zone",
    )
    .bind(started_at)
    .bind(env!("CARGO_PKG_VERSION"))
    .bind(&config.rescan_cron)
    .bind(config.nvd_api_key.is_some())
    .bind(smtp_on)
    .bind(&config.time_zone)
    .execute(pool)
    .await?;
    Ok(())
}

/// Puts stuck jobs back in the queue. Jobs that ran out of attempts get their failed-job cleanup.
pub async fn reap(pool: &PgPool, instance_id: &str, startup: bool) -> Result<usize, sqlx::Error> {
    let reaped = queue::reap(pool, instance_id, startup).await?;
    for job in reaped.iter().filter(|j| j.status == JobStatus::Failed) {
        hooks::on_failed(
            pool,
            &job.id,
            job.job_type,
            job.device_id.as_deref(),
            crate::contract::JobErrorCode::WorkerLost,
        )
        .await?;
    }
    if !reaped.is_empty() {
        warn!(
            count = reaped.len(),
            "recovered jobs left over from a stopped worker"
        );
    }
    Ok(reaped.len())
}

pub async fn run(
    pool: PgPool,
    config: Config,
    smtp_on: bool,
    instance_id: String,
    started_at: DateTime<Utc>,
    mut shutdown: watch::Receiver<bool>,
) {
    loop {
        if let Err(err) = beat(&pool, &config, started_at, smtp_on).await {
            error!(error = %err, "heartbeat failed");
        }
        if let Err(err) = reap(&pool, &instance_id, false).await {
            error!(error = %err, "reaping stuck jobs failed");
        }
        tokio::select! {
            _ = shutdown.changed() => return,
            () = tokio::time::sleep(INTERVAL) => {}
        }
    }
}

/// For the `healthcheck` subcommand: the worker is healthy when its heartbeat is recent.
pub async fn is_alive(pool: &PgPool, max_age_seconds: i32) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM worker_status
                        WHERE id = 1 AND heartbeat_at > now() - make_interval(secs => $1))",
    )
    .bind(f64::from(max_age_seconds))
    .fetch_one(pool)
    .await
}
