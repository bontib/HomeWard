//! RESCAN_ALL: the daily (or "Check all now") re-check.
//! Freshens Trivy and KEV data when old, tidies old rows, then queues one CHECK_DEVICE per device.

use chrono::{Duration, Utc};
use sqlx::PgPool;
use tracing::{info, warn};

use crate::context::Context;
use crate::contract::{DataSourceId, RescanAllPayload};
use crate::data_source;
use crate::error::JobError;
use crate::jobs::{import_kev, update_trivy_db};
use crate::queue;

const OUTSIDE_DATA_MAX_AGE_HOURS: i64 = 12;
const KEEP_DAYS: i32 = 30;

pub async fn run(ctx: &Context, payload: &RescanAllPayload) -> Result<(), JobError> {
    // A failure here is noted in data_source and does not stop the rescan (D23):
    // yesterday's data is better than no check at all.
    if is_old(&ctx.pool, DataSourceId::TrivyDb).await? {
        if let Err(err) = update_trivy_db::refresh(ctx).await {
            warn!(error = %err, "Trivy database update failed, continuing with the old one");
        }
    }
    if is_old(&ctx.pool, DataSourceId::Kev).await? {
        if let Err(err) = import_kev::refresh(ctx).await {
            warn!(error = %err, "KEV import failed, continuing with the old list");
        }
    }
    housekeeping(&ctx.pool).await?;
    let queued = queue_checks(&ctx.pool, payload.user_id.as_deref()).await?;
    info!(queued, "rescan queued device checks");
    Ok(())
}

async fn is_old(pool: &PgPool, id: DataSourceId) -> Result<bool, sqlx::Error> {
    let last = data_source::last_success(pool, id).await?;
    Ok(last.is_none_or(|t| Utc::now() - t > Duration::hours(OUTSIDE_DATA_MAX_AGE_HOURS)))
}

async fn housekeeping(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM job WHERE status IN ('DONE', 'FAILED') AND finished_at < now() - make_interval(days => $1)",
    )
    .bind(KEEP_DAYS)
    .execute(pool)
    .await?;
    sqlx::query(
        "DELETE FROM product_search WHERE COALESCE(fetched_at, requested_at) < now() - make_interval(days => $1)",
    )
    .bind(KEEP_DAYS)
    .execute(pool)
    .await?;
    Ok(())
}

/// One low-priority CHECK_DEVICE for every device (of one user, or of everyone) that has
/// no check waiting. Returns how many were queued.
async fn queue_checks(pool: &PgPool, user_id: Option<&str>) -> Result<u64, sqlx::Error> {
    let queued = sqlx::query(
        "WITH targets AS (
           SELECT d.id, d.user_id FROM device d
           WHERE ($1::text IS NULL OR d.user_id = $1)
             AND NOT EXISTS (
               SELECT 1 FROM job j
               WHERE j.type = 'CHECK_DEVICE' AND j.status = 'QUEUED' AND j.device_id = d.id)
         ), inserted AS (
           INSERT INTO job (type, payload, priority, user_id, device_id)
           SELECT 'CHECK_DEVICE', jsonb_build_object('deviceId', id), 0, user_id, id FROM targets
           RETURNING id, device_id
         )
         UPDATE device SET check_state = 'CHECKING', check_job_id = inserted.id, check_error_code = NULL
         FROM inserted WHERE device.id = inserted.device_id",
    )
    .bind(user_id)
    .execute(pool)
    .await?
    .rows_affected();
    if queued > 0 {
        queue::notify(pool, "rescan").await?;
    }
    Ok(queued)
}
