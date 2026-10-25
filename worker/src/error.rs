//! The error a job returns. Each variant maps to the machine code stored in `job.error_code`.

use thiserror::Error;

use crate::contract::JobErrorCode;

#[derive(Debug, Error)]
pub enum JobError {
    #[error("NVD is unavailable: {0}")]
    NvdUnavailable(String),
    #[error("Trivy failed: {0}")]
    TrivyFailed(String),
    #[error("the Trivy database is missing")]
    TrivyDbMissing,
    #[error("the SBOM is not valid: {0}")]
    SbomInvalid(String),
    #[error("the KEV list is unavailable: {0}")]
    KevUnavailable(String),
    #[error("the mail could not be sent: {0}")]
    SmtpFailed(String),
    #[error("e-mail is not set up on this worker")]
    SmtpNotConfigured,
    #[error("the job took too long")]
    Timeout,
    #[error("{0}")]
    BadPayload(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("{0}")]
    Internal(String),
}

impl JobError {
    pub fn code(&self) -> JobErrorCode {
        match self {
            Self::NvdUnavailable(_) => JobErrorCode::NvdUnavailable,
            Self::TrivyFailed(_) => JobErrorCode::TrivyFailed,
            Self::TrivyDbMissing => JobErrorCode::TrivyDbMissing,
            Self::SbomInvalid(_) => JobErrorCode::SbomInvalid,
            Self::KevUnavailable(_) => JobErrorCode::KevUnavailable,
            Self::SmtpFailed(_) => JobErrorCode::SmtpFailed,
            Self::SmtpNotConfigured => JobErrorCode::SmtpNotConfigured,
            Self::Timeout => JobErrorCode::Timeout,
            Self::BadPayload(_) => JobErrorCode::BadPayload,
            Self::Database(_) | Self::Internal(_) => JobErrorCode::Internal,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_error_maps_to_its_code() {
        assert_eq!(JobError::Timeout.code(), JobErrorCode::Timeout);
        assert_eq!(
            JobError::SbomInvalid("x".into()).code(),
            JobErrorCode::SbomInvalid
        );
        assert_eq!(
            JobError::Internal("x".into()).code(),
            JobErrorCode::Internal
        );
    }

    #[test]
    fn mail_errors_map_to_their_codes() {
        assert_eq!(
            JobError::SmtpFailed("x".into()).code(),
            JobErrorCode::SmtpFailed
        );
        assert_eq!(
            JobError::SmtpNotConfigured.code(),
            JobErrorCode::SmtpNotConfigured
        );
    }

    #[test]
    fn database_errors_are_internal() {
        assert_eq!(
            JobError::Database(sqlx::Error::PoolTimedOut).code(),
            JobErrorCode::Internal
        );
    }
}
