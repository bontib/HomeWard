//! Device jobs carry the device id twice: in the payload and in `job.device_id` (with
//! `job.user_id`). Web writes both from the signed-in user's own device. The worker checks
//! that they agree, so a hand-made or damaged payload cannot make it act on another device.

use sqlx::PgPool;

use crate::error::JobError;
use crate::queue::ClaimedJob;

#[derive(Debug, PartialEq, Eq)]
enum Binding {
    /// `job.device_id` is NULL: the device was deleted after the job was queued.
    DeviceDeleted,
    Matches,
    Mismatch,
}

fn binding(job_device_id: Option<&str>, payload_device_id: &str) -> Binding {
    match job_device_id {
        None => Binding::DeviceDeleted,
        Some(id) if id == payload_device_id => Binding::Matches,
        Some(_) => Binding::Mismatch,
    }
}

/// Returns `Ok(true)` when the job may go on, `Ok(false)` when the device is gone.
pub async fn check_device_job(
    pool: &PgPool,
    job: &ClaimedJob,
    payload_device_id: &str,
) -> Result<bool, JobError> {
    match binding(job.device_id.as_deref(), payload_device_id) {
        Binding::DeviceDeleted => return Ok(false),
        Binding::Mismatch => {
            return Err(JobError::BadPayload(
                "the payload device does not match the job".into(),
            ))
        }
        Binding::Matches => {}
    }
    let Some(user_id) = job.user_id.as_deref() else {
        return Ok(true);
    };
    let owned: Option<bool> = sqlx::query_scalar("SELECT user_id = $2 FROM device WHERE id = $1")
        .bind(payload_device_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    match owned {
        Some(false) => Err(JobError::BadPayload(
            "the device does not belong to the job's user".into(),
        )),
        Some(true) => Ok(true),
        None => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_null_job_device_means_the_device_was_deleted() {
        assert_eq!(binding(None, "d1"), Binding::DeviceDeleted);
    }

    #[test]
    fn the_same_id_matches() {
        assert_eq!(binding(Some("d1"), "d1"), Binding::Matches);
    }

    #[test]
    fn a_different_id_is_a_mismatch() {
        assert_eq!(binding(Some("d1"), "d2"), Binding::Mismatch);
    }
}
