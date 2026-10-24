//! UPDATE_TRIVY_DB: downloads the Trivy vulnerability database into the cache directory.

use crate::context::Context;
use crate::contract::DataSourceId;
use crate::data_source;
use crate::error::JobError;

pub async fn run(ctx: &Context) -> Result<(), JobError> {
    refresh(ctx).await
}

/// Also called by RESCAN_ALL, where a failure is logged but not fatal.
pub async fn refresh(ctx: &Context) -> Result<(), JobError> {
    let result = ctx.trivy.update_db().await.map_err(JobError::from);
    match result {
        Ok(updated_at) => {
            data_source::record_success(&ctx.pool, DataSourceId::TrivyDb, updated_at).await?;
            Ok(())
        }
        Err(err) => {
            data_source::record_failure(&ctx.pool, DataSourceId::TrivyDb, err.code()).await?;
            Err(err)
        }
    }
}
