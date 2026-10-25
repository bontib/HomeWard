//! Everything a job needs, built once in `main` and shared by all lanes.

use std::time::Duration;

use sqlx::PgPool;

use crate::config::Config;
use crate::mailer::Mailer;
use crate::nvd::NvdClient;
use crate::trivy::Trivy;

pub struct Context {
    pub pool: PgPool,
    pub config: Config,
    pub nvd: NvdClient,
    pub trivy: Trivy,
    pub http: reqwest::Client,
    /// `None` means e-mail is off (no valid SMTP settings).
    pub mailer: Option<Mailer>,
    /// Marks the jobs this process runs (`job.locked_by`).
    pub instance_id: String,
}

/// How long a job may run before it is stopped (architecture section 4.1).
pub fn timeout_for(job_type: crate::contract::JobType) -> Duration {
    use crate::contract::JobType::*;
    match job_type {
        CheckDevice | RescanAll | UpdateTrivyDb => Duration::from_secs(10 * 60),
        ImportKev => Duration::from_secs(2 * 60),
        SearchProducts => Duration::from_secs(60),
        RecomputeStatus | DevNoop => Duration::from_secs(30),
        SendEmail => Duration::from_secs(60),
        SendDigest => Duration::from_secs(2 * 60),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::JobType;

    #[test]
    fn checks_get_ten_minutes_and_status_recompute_thirty_seconds() {
        assert_eq!(timeout_for(JobType::CheckDevice), Duration::from_secs(600));
        assert_eq!(
            timeout_for(JobType::RecomputeStatus),
            Duration::from_secs(30)
        );
        assert_eq!(timeout_for(JobType::ImportKev), Duration::from_secs(120));
    }
}
