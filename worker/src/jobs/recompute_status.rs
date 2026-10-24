//! RECOMPUTE_STATUS: status and counts of one device from its current rows.
//! Queued by web after ignore/reopen, and by IMPORT_KEV when a CVE becomes "exploited".

use sqlx::PgPool;

use crate::contract::DevicePayload;
use crate::error::JobError;
use crate::status;

pub async fn run(pool: &PgPool, payload: &DevicePayload) -> Result<(), JobError> {
    let mut tx = pool.begin().await?;
    let found: Option<String> =
        sqlx::query_scalar("SELECT id FROM device WHERE id = $1 FOR UPDATE")
            .bind(&payload.device_id)
            .fetch_optional(&mut *tx)
            .await?;
    // Device deleted meanwhile: nothing to do.
    if found.is_some() {
        status::recompute_device(&mut tx, &payload.device_id).await?;
    }
    tx.commit().await?;
    Ok(())
}
