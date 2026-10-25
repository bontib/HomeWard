//! The daily rescan schedule, catch-up after downtime, and the jobs queued at start.
//! Times are in the container's local time zone (`TZ`).

use std::time::Duration;

use std::str::FromStr;

use chrono::{DateTime, Local, Timelike, Utc};
use croner::Cron;
use serde_json::json;
use sqlx::PgPool;
use tokio::sync::watch;
use tracing::{error, info};

use crate::contract::{JobType, DIGEST_HOUR};
use crate::queue;

/// The longest single sleep, so a clock change or suspend is noticed within a minute.
const MAX_SLEEP: Duration = Duration::from_secs(60);
const CATCH_UP_AFTER_HOURS: i64 = 25;
const KEV_MAX_AGE_HOURS: i64 = 24;
const SCHEDULED_PRIORITY: i32 = 5;

pub fn next_run(cron: &Cron, after: DateTime<Local>) -> Option<DateTime<Local>> {
    cron.find_next_occurrence(&after, false).ok()
}

/// True when the NAS was off at the scheduled time: the last all-users rescan is older than
/// 25 hours (or never ran) and there is something to check.
pub fn catch_up_due(
    last_rescan: Option<DateTime<Utc>>,
    has_devices: bool,
    now: DateTime<Utc>,
) -> bool {
    has_devices
        && last_rescan.is_none_or(|t| now - t > chrono::Duration::hours(CATCH_UP_AFTER_HOURS))
}

fn kev_needs_import(newest_import: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
    newest_import.is_none_or(|t| now - t > chrono::Duration::hours(KEV_MAX_AGE_HOURS))
}

async fn queue_rescan(pool: &PgPool) -> Result<Option<String>, sqlx::Error> {
    queue::enqueue_unless_active(
        pool,
        JobType::RescanAll,
        json!({ "userId": null }),
        SCHEDULED_PRIORITY,
        None,
    )
    .await
}

/// Jobs the worker queues for itself at start: missing data, and a missed nightly rescan.
pub async fn bootstrap(pool: &PgPool, trivy_db_present: bool) -> Result<(), sqlx::Error> {
    if !trivy_db_present {
        queue::enqueue_unless_active(
            pool,
            JobType::UpdateTrivyDb,
            json!({}),
            SCHEDULED_PRIORITY,
            None,
        )
        .await?;
    }
    let newest_kev: Option<DateTime<Utc>> =
        sqlx::query_scalar("SELECT max(imported_at)::timestamptz FROM kev_entry")
            .fetch_one(pool)
            .await?;
    if kev_needs_import(newest_kev, Utc::now()) {
        queue::enqueue_unless_active(
            pool,
            JobType::ImportKev,
            json!({}),
            SCHEDULED_PRIORITY,
            None,
        )
        .await?;
    }

    let last_rescan: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT max(created_at)::timestamptz FROM job WHERE type = 'RESCAN_ALL' AND user_id IS NULL",
    )
    .fetch_one(pool)
    .await?;
    let has_devices: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM device)")
        .fetch_one(pool)
        .await?;
    if catch_up_due(last_rescan, has_devices, Utc::now()) {
        info!("the last rescan is more than 25 hours ago, queueing one now");
        queue_rescan(pool).await?;
    }
    Ok(())
}

/// Sleeps in steps of at most a minute until `next`. Returns false when shutdown came first.
async fn wait_until(next: DateTime<Local>, shutdown: &mut watch::Receiver<bool>) -> bool {
    loop {
        let remaining = (next - Local::now()).to_std().unwrap_or(Duration::ZERO);
        if remaining.is_zero() {
            return true;
        }
        tokio::select! {
            _ = shutdown.changed() => return false,
            () = tokio::time::sleep(remaining.min(MAX_SLEEP)) => {}
        }
    }
}

pub async fn run(pool: PgPool, cron: Cron, mut shutdown: watch::Receiver<bool>) {
    loop {
        let Some(next) = next_run(&cron, Local::now()) else {
            error!("the rescan schedule has no next time, scheduler stopped");
            return;
        };
        if let Err(err) = save_next_run(&pool, next.with_timezone(&Utc)).await {
            error!(error = %err, "could not save the next rescan time");
        }
        info!(next = %next, "next rescan");
        if !wait_until(next, &mut shutdown).await {
            return;
        }
        match queue_rescan(&pool).await {
            Ok(Some(id)) => info!(job_id = %id, "nightly rescan queued"),
            Ok(None) => info!("a rescan is already waiting or running"),
            Err(err) => error!(error = %err, "could not queue the nightly rescan"),
        }
    }
}

/// Every day at `DIGEST_HOUR` in the container's time zone.
pub fn digest_cron() -> Option<Cron> {
    Cron::from_str(&format!("0 {DIGEST_HOUR} * * *")).ok()
}

/// True when the worker starts after the summary hour. The per-person `last_digest_at` check
/// makes a second summary the same day impossible, so no "last run" is stored.
pub fn digest_catch_up_due(now: DateTime<Local>) -> bool {
    now.hour() >= DIGEST_HOUR
}

async fn queue_digest(pool: &PgPool) -> Result<Option<String>, sqlx::Error> {
    queue::enqueue_unless_active(pool, JobType::SendDigest, json!({}), 0, None).await
}

/// Only started while e-mail is on.
pub async fn run_digest(pool: PgPool, mut shutdown: watch::Receiver<bool>) {
    let Some(cron) = digest_cron() else {
        error!("the daily summary schedule is invalid, it will not run");
        return;
    };
    if digest_catch_up_due(Local::now()) {
        match queue_digest(&pool).await {
            Ok(_) => info!("daily summary checked at start"),
            Err(err) => error!(error = %err, "could not queue the daily summary"),
        }
    }
    loop {
        let Some(next) = next_run(&cron, Local::now()) else {
            error!("the daily summary has no next time, it stopped");
            return;
        };
        info!(next = %next, "next daily summary");
        if !wait_until(next, &mut shutdown).await {
            return;
        }
        match queue_digest(&pool).await {
            Ok(Some(id)) => info!(job_id = %id, "daily summary queued"),
            Ok(None) => info!("a daily summary is already waiting or running"),
            Err(err) => error!(error = %err, "could not queue the daily summary"),
        }
    }
}

async fn save_next_run(pool: &PgPool, next: DateTime<Utc>) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE worker_status SET next_rescan_at = $1 WHERE id = 1")
        .bind(next)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;
    use crate::config::check_cron;

    fn utc(h: u32, m: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 24, h, m, 0).unwrap()
    }

    #[test]
    fn the_next_run_is_the_coming_3am() {
        let cron = check_cron("0 3 * * *").unwrap();
        let after = utc(10, 0);
        let next = cron.find_next_occurrence(&after, false).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 10, 25, 3, 0, 0).unwrap());
    }

    #[test]
    fn a_run_exactly_at_the_time_moves_to_the_next_day() {
        let cron = check_cron("0 3 * * *").unwrap();
        let next = cron.find_next_occurrence(&utc(3, 0), false).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 10, 25, 3, 0, 0).unwrap());
    }

    #[test]
    fn local_next_run_is_in_the_future() {
        let cron = check_cron("*/5 * * * *").unwrap();
        let now = Local::now();
        assert!(next_run(&cron, now).is_some_and(|n| n > now));
    }

    #[test]
    fn catch_up_runs_when_the_last_rescan_is_over_25_hours_old() {
        let now = utc(12, 0);
        assert!(catch_up_due(
            Some(now - chrono::Duration::hours(26)),
            true,
            now
        ));
    }

    #[test]
    fn catch_up_is_skipped_after_a_recent_rescan() {
        let now = utc(12, 0);
        assert!(!catch_up_due(
            Some(now - chrono::Duration::hours(24)),
            true,
            now
        ));
    }

    #[test]
    fn catch_up_is_skipped_without_devices() {
        assert!(!catch_up_due(None, false, utc(12, 0)));
    }

    #[test]
    fn catch_up_runs_when_a_rescan_never_happened() {
        assert!(catch_up_due(None, true, utc(12, 0)));
    }

    #[test]
    fn the_digest_schedule_is_seven_every_day() {
        let cron = digest_cron().unwrap();
        let next = cron.find_next_occurrence(&utc(8, 0), false).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 10, 25, 7, 0, 0).unwrap());
    }

    #[test]
    fn the_digest_catches_up_only_after_the_summary_hour() {
        let early = Local.with_ymd_and_hms(2026, 10, 25, 6, 59, 0).unwrap();
        let late = Local.with_ymd_and_hms(2026, 10, 25, 7, 0, 0).unwrap();
        assert!(!digest_catch_up_due(early));
        assert!(digest_catch_up_due(late));
    }

    #[test]
    fn kev_is_imported_when_missing_or_a_day_old() {
        let now = utc(12, 0);
        assert!(kev_needs_import(None, now));
        assert!(kev_needs_import(
            Some(now - chrono::Duration::hours(25)),
            now
        ));
        assert!(!kev_needs_import(
            Some(now - chrono::Duration::hours(2)),
            now
        ));
    }
}
