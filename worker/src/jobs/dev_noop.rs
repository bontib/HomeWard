//! DEV_NOOP: sleeps, then finishes. Lets the UI and e2e tests watch a job go through the worker.

use std::time::Duration;

use crate::contract::DevNoopPayload;
use crate::error::JobError;

pub async fn run(payload: &DevNoopPayload) -> Result<(), JobError> {
    if let Some(ms) = payload.sleep_ms {
        tokio::time::sleep(Duration::from_millis(ms)).await;
    }
    Ok(())
}
