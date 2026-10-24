//! Types shared with the web app: Postgres enums and job payloads.
//! Source of truth: `web/prisma/schema.prisma` and `docs/architecture-v1.md` section 4.1.
//! `tests/contract.rs` checks the enums against the schema and the payloads against `contracts/`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

/// Declares a Postgres enum read by sqlx and by serde with the same SCREAMING_SNAKE names.
/// `ALL` lets the contract test compare the variants with the Prisma schema.
macro_rules! db_enum {
    ($name:ident, $pg_type:literal, [$($variant:ident),+ $(,)?]) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, sqlx::Type, Serialize, Deserialize)]
        #[sqlx(type_name = $pg_type, rename_all = "SCREAMING_SNAKE_CASE")]
        #[serde(rename_all = "SCREAMING_SNAKE_CASE")]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];
        }
    };
}

db_enum!(
    DeviceType,
    "device_type",
    [
        Console, Pc, Laptop, Phone, Tablet, Tv, Speaker, Camera, Plug, Bulb, Thermostat, Router,
        Doorbell, Printer, Nas, Other
    ]
);
db_enum!(
    DeviceStatus,
    "device_status",
    [
        Pending,
        Critical,
        Vulnerable,
        UpdateAvailable,
        NoKnownVulns,
        NotTracked
    ]
);
db_enum!(CheckState, "check_state", [Idle, Checking, Failed]);
db_enum!(Severity, "severity", [Critical, High, Medium, Low, Unknown]);
db_enum!(FindingState, "finding_state", [Open, Ignored]);
db_enum!(FindingSource, "finding_source", [Nvd, Trivy]);
db_enum!(ComponentSource, "component_source", [Manual, Sbom]);
db_enum!(
    ComponentCheck,
    "component_check",
    [
        Pending,
        Checked,
        NoIdentifier,
        NoVersion,
        BadVersion,
        Unsupported
    ]
);
db_enum!(SbomFormat, "sbom_format", [Cyclonedx, Spdx]);
db_enum!(
    JobType,
    "job_type",
    [
        CheckDevice,
        RecomputeStatus,
        SearchProducts,
        RescanAll,
        UpdateTrivyDb,
        ImportKev,
        DevNoop
    ]
);
db_enum!(JobStatus, "job_status", [Queued, Running, Done, Failed]);
db_enum!(
    JobErrorCode,
    "job_error_code",
    [
        NvdUnavailable,
        TrivyFailed,
        TrivyDbMissing,
        SbomInvalid,
        KevUnavailable,
        Timeout,
        WorkerLost,
        BadPayload,
        Internal
    ]
);
db_enum!(
    ProductSearchStatus,
    "product_search_status",
    [Pending, Ready, Failed]
);
db_enum!(DataSourceId, "data_source_id", [Nvd, TrivyDb, Kev]);

impl JobErrorCode {
    /// The name stored in Postgres and sent to the browser.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NvdUnavailable => "NVD_UNAVAILABLE",
            Self::TrivyFailed => "TRIVY_FAILED",
            Self::TrivyDbMissing => "TRIVY_DB_MISSING",
            Self::SbomInvalid => "SBOM_INVALID",
            Self::KevUnavailable => "KEV_UNAVAILABLE",
            Self::Timeout => "TIMEOUT",
            Self::WorkerLost => "WORKER_LOST",
            Self::BadPayload => "BAD_PAYLOAD",
            Self::Internal => "INTERNAL",
        }
    }

    /// Retrying will not help for these (architecture section 4.3).
    pub fn is_retryable(self) -> bool {
        !matches!(self, Self::SbomInvalid | Self::BadPayload)
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
#[error("bad {job_type:?} payload: {reason}")]
pub struct PayloadError {
    pub job_type: JobType,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePayload {
    pub device_id: String,
}

#[derive(Debug, Deserialize)]
pub struct SearchProductsPayload {
    pub query: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RescanAllPayload {
    pub user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevNoopPayload {
    pub sleep_ms: Option<u64>,
}

/// A payload that passed the same checks as the Zod schemas in `web/src/lib/contracts/jobs.ts`.
#[derive(Debug)]
pub enum JobPayload {
    CheckDevice(DevicePayload),
    RecomputeStatus(DevicePayload),
    SearchProducts(SearchProductsPayload),
    RescanAll(RescanAllPayload),
    UpdateTrivyDb,
    ImportKev,
    DevNoop(DevNoopPayload),
}

const MAX_NOOP_SLEEP_MS: u64 = 5000;

impl JobPayload {
    pub fn parse(job_type: JobType, value: &Value) -> Result<Self, PayloadError> {
        let fail = |reason: String| PayloadError { job_type, reason };
        let decode_error = |e: serde_json::Error| fail(e.to_string());

        match job_type {
            JobType::CheckDevice | JobType::RecomputeStatus => {
                let payload = DevicePayload::deserialize(value).map_err(decode_error)?;
                if payload.device_id.is_empty() {
                    return Err(fail("deviceId is empty".into()));
                }
                Ok(if job_type == JobType::CheckDevice {
                    Self::CheckDevice(payload)
                } else {
                    Self::RecomputeStatus(payload)
                })
            }
            JobType::SearchProducts => {
                let payload = SearchProductsPayload::deserialize(value).map_err(decode_error)?;
                let length = payload.query.chars().count();
                if !(2..=60).contains(&length) {
                    return Err(fail("query must be 2 to 60 characters".into()));
                }
                Ok(Self::SearchProducts(payload))
            }
            JobType::RescanAll => {
                // Option would accept a missing key; the web schema requires it (null = everyone).
                if value.get("userId").is_none() {
                    return Err(fail("userId is required (use null for all users)".into()));
                }
                RescanAllPayload::deserialize(value)
                    .map(Self::RescanAll)
                    .map_err(decode_error)
            }
            JobType::UpdateTrivyDb => Ok(Self::UpdateTrivyDb),
            JobType::ImportKev => Ok(Self::ImportKev),
            JobType::DevNoop => {
                let payload = DevNoopPayload::deserialize(value).map_err(decode_error)?;
                if payload.sleep_ms.is_some_and(|ms| ms > MAX_NOOP_SLEEP_MS) {
                    return Err(fail(format!("sleepMs must be at most {MAX_NOOP_SLEEP_MS}")));
                }
                Ok(Self::DevNoop(payload))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn enum_names_are_screaming_snake_case() {
        let name = serde_json::to_value(DeviceStatus::NoKnownVulns).unwrap();
        assert_eq!(name, json!("NO_KNOWN_VULNS"));
    }

    #[test]
    fn short_names_are_all_caps() {
        let name = serde_json::to_value(DeviceType::Tv).unwrap();
        assert_eq!(name, json!("TV"));
    }

    #[test]
    fn bad_payload_and_invalid_sbom_are_not_retryable() {
        assert!(!JobErrorCode::BadPayload.is_retryable());
        assert!(!JobErrorCode::SbomInvalid.is_retryable());
    }

    #[test]
    fn nvd_errors_are_retryable() {
        assert!(JobErrorCode::NvdUnavailable.is_retryable());
    }

    #[test]
    fn device_payload_needs_a_device_id() {
        let result = JobPayload::parse(JobType::CheckDevice, &json!({}));
        assert!(result.is_err());
    }

    #[test]
    fn rescan_all_accepts_null_user() {
        let result = JobPayload::parse(JobType::RescanAll, &json!({ "userId": null }));
        assert!(matches!(
            result,
            Ok(JobPayload::RescanAll(RescanAllPayload { user_id: None }))
        ));
    }

    #[test]
    fn search_query_length_is_checked() {
        let result = JobPayload::parse(JobType::SearchProducts, &json!({ "query": "x" }));
        assert!(result.is_err());
    }
}
