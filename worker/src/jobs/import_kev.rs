//! IMPORT_KEV: replaces the KEV table, marks CVEs as "exploited", and queues a status
//! recompute for devices whose open findings changed.

use sqlx::PgPool;

use crate::context::Context;
use crate::contract::DataSourceId;
use crate::data_source;
use crate::error::JobError;
use crate::kev::{self, KevList};
use crate::queue;

pub async fn run(ctx: &Context) -> Result<(), JobError> {
    refresh(ctx).await
}

/// Also called by RESCAN_ALL, where a failure is logged but not fatal. On failure the old
/// list stays in place (P5-6).
pub async fn refresh(ctx: &Context) -> Result<(), JobError> {
    let downloaded = kev::fetch(&ctx.http, &ctx.config.kev_url)
        .await
        .map_err(JobError::from);
    let list = match downloaded {
        Ok(list) => list,
        Err(err) => {
            data_source::record_failure(&ctx.pool, DataSourceId::Kev, err.code()).await?;
            return Err(err);
        }
    };
    store(&ctx.pool, &list).await?;
    data_source::record_success(&ctx.pool, DataSourceId::Kev, list.released_at).await?;
    Ok(())
}

async fn store(pool: &PgPool, list: &KevList) -> Result<(), JobError> {
    let ids: Vec<&str> = list.entries.iter().map(|e| e.cve_id.as_str()).collect();
    let dates: Vec<chrono::NaiveDate> = list.entries.iter().map(|e| e.date_added).collect();

    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM kev_entry")
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO kev_entry (cve_id, date_added, imported_at)
         SELECT id, added, now() FROM unnest($1::text[], $2::date[]) AS t(id, added)
         ON CONFLICT (cve_id) DO NOTHING",
    )
    .bind(&ids)
    .bind(&dates)
    .execute(&mut *tx)
    .await?;

    let changed: Vec<String> = sqlx::query_scalar(
        "UPDATE vulnerability v
         SET exploited = EXISTS (SELECT 1 FROM kev_entry k WHERE k.cve_id = v.id)
         WHERE v.exploited IS DISTINCT FROM EXISTS (SELECT 1 FROM kev_entry k WHERE k.cve_id = v.id)
         RETURNING v.id",
    )
    .fetch_all(&mut *tx)
    .await?;

    queue_recomputes(&mut tx, &changed).await?;
    tx.commit().await?;
    // One wake-up after commit; the lanes pick up all the new jobs.
    queue::notify(pool, "kev").await?;
    Ok(())
}

/// One RECOMPUTE_STATUS per device that has an open finding for a changed CVE.
async fn queue_recomputes(
    tx: &mut sqlx::PgConnection,
    changed: &[String],
) -> Result<(), sqlx::Error> {
    if changed.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO job (type, payload, priority, user_id, device_id)
         SELECT 'RECOMPUTE_STATUS', jsonb_build_object('deviceId', d.id), 20, d.user_id, d.id
         FROM device d
         WHERE EXISTS (
             SELECT 1 FROM finding f
             WHERE f.device_id = d.id AND f.state = 'OPEN' AND f.vulnerability_id = ANY($1::text[]))
           AND NOT EXISTS (
             SELECT 1 FROM job j
             WHERE j.type = 'RECOMPUTE_STATUS' AND j.status = 'QUEUED' AND j.device_id = d.id)",
    )
    .bind(changed)
    .execute(tx)
    .await?;
    Ok(())
}
