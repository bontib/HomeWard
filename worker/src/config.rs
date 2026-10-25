//! Settings read from environment variables.

use std::fmt;
use std::path::PathBuf;
use std::str::FromStr;

use croner::Cron;
use thiserror::Error;

use crate::mailer::{SmtpOff, SmtpSettings};

/// Listener, three lanes (fast, slow, mail), scheduler and one spare (architecture section 7.2,
/// ADR 0007).
const DB_POOL_SIZE: u32 = 6;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("{0} is not set. Set it in .env (see .env.example).")]
    Missing(&'static str),
    #[error("{reason}")]
    Invalid { name: &'static str, reason: String },
}

const DEFAULT_RESCAN_CRON: &str = "0 3 * * *";
const DEFAULT_NVD_URL: &str = "https://services.nvd.nist.gov";
const DEFAULT_KEV_URL: &str =
    "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const DEFAULT_TRIVY_CACHE: &str = "/var/cache/trivy";

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub db_pool_size: u32,
    pub nvd_api_key: Option<String>,
    pub nvd_base_url: String,
    pub kev_url: String,
    pub trivy_path: PathBuf,
    pub trivy_cache_dir: PathBuf,
    /// Five fields, checked at start so a typo stops the worker at once.
    pub rescan_cron: String,
    /// The container's `TZ` name; the daily summary goes out at 07:00 in it.
    pub time_zone: String,
    /// `Err` means e-mail is off. A bad mail setting never stops the worker.
    pub smtp: Result<SmtpSettings, SmtpOff>,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Lets integration tests build a config without touching the process environment.
    pub fn from_lookup_for_tests(
        get: impl Fn(&str) -> Option<String>,
    ) -> Result<Self, ConfigError> {
        Self::from_lookup(get)
    }

    fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let database_url = get("DATABASE_URL")
            .filter(|v| !v.trim().is_empty())
            .ok_or(ConfigError::Missing("DATABASE_URL"))?;
        let rescan_cron = get("RESCAN_CRON")
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_RESCAN_CRON.to_string());
        check_cron(&rescan_cron)?;
        let value = |name: &str, default: &str| {
            get(name)
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| default.to_string())
        };
        Ok(Self {
            database_url,
            db_pool_size: DB_POOL_SIZE,
            nvd_api_key: get("NVD_API_KEY").filter(|v| !v.trim().is_empty()),
            nvd_base_url: value("NVD_BASE_URL", DEFAULT_NVD_URL),
            kev_url: value("KEV_URL", DEFAULT_KEV_URL),
            trivy_path: value("TRIVY_PATH", "trivy").into(),
            trivy_cache_dir: value("TRIVY_CACHE_DIR", DEFAULT_TRIVY_CACHE).into(),
            rescan_cron,
            time_zone: value("TZ", "UTC"),
            smtp: SmtpSettings::from_lookup(&get),
        })
    }
}

/// Exactly five fields (minute hour day month weekday); croner would also accept six.
pub fn check_cron(expression: &str) -> Result<Cron, ConfigError> {
    let invalid = || ConfigError::Invalid {
        name: "RESCAN_CRON",
        reason: format!("RESCAN_CRON is not a valid schedule: {expression}"),
    };
    if expression.split_whitespace().count() != 5 {
        return Err(invalid());
    }
    Cron::from_str(expression).map_err(|_| invalid())
}

// The URL contains the database password, so it never goes into logs.
impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("database_url", &"<redacted>")
            .field("db_pool_size", &self.db_pool_size)
            .field(
                "nvd_api_key",
                &self.nvd_api_key.as_ref().map(|_| "<redacted>"),
            )
            .field("nvd_base_url", &self.nvd_base_url)
            .field("kev_url", &self.kev_url)
            .field("trivy_path", &self.trivy_path)
            .field("trivy_cache_dir", &self.trivy_cache_dir)
            .field("rescan_cron", &self.rescan_cron)
            .field("time_zone", &self.time_zone)
            .field("smtp", &self.smtp)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |name| {
            pairs
                .iter()
                .find(|(k, _)| *k == name)
                .map(|(_, v)| v.to_string())
        }
    }

    #[test]
    fn missing_database_url_names_the_variable() {
        let err = Config::from_lookup(lookup(&[])).unwrap_err();
        assert_eq!(err, ConfigError::Missing("DATABASE_URL"));
        assert!(err.to_string().contains("DATABASE_URL"));
    }

    #[test]
    fn blank_database_url_counts_as_missing() {
        let err = Config::from_lookup(lookup(&[("DATABASE_URL", "  ")])).unwrap_err();
        assert_eq!(err, ConfigError::Missing("DATABASE_URL"));
    }

    #[test]
    fn pool_size_defaults_to_six() {
        let config = Config::from_lookup(lookup(&[("DATABASE_URL", "postgres://x")])).unwrap();
        assert_eq!(config.db_pool_size, 6);
    }

    #[test]
    fn defaults_point_at_the_real_services() {
        let config = Config::from_lookup(lookup(&[("DATABASE_URL", "postgres://x")])).unwrap();
        assert_eq!(config.nvd_base_url, "https://services.nvd.nist.gov");
        assert_eq!(config.rescan_cron, "0 3 * * *");
        assert_eq!(config.trivy_cache_dir, PathBuf::from("/var/cache/trivy"));
        assert!(config.nvd_api_key.is_none());
    }

    #[test]
    fn an_empty_api_key_means_no_key() {
        let config =
            Config::from_lookup(lookup(&[("DATABASE_URL", "x"), ("NVD_API_KEY", "")])).unwrap();
        assert!(config.nvd_api_key.is_none());
    }

    #[test]
    fn a_bad_cron_names_the_variable_and_the_value() {
        let err = Config::from_lookup(lookup(&[
            ("DATABASE_URL", "x"),
            ("RESCAN_CRON", "every day"),
        ]))
        .unwrap_err();
        assert_eq!(
            err.to_string(),
            "RESCAN_CRON is not a valid schedule: every day"
        );
    }

    #[test]
    fn six_field_cron_is_refused() {
        assert!(check_cron("0 0 3 * * *").is_err());
        assert!(check_cron("*/5 * * * *").is_ok());
    }

    #[test]
    fn debug_output_hides_the_api_key() {
        let config = Config::from_lookup(lookup(&[
            ("DATABASE_URL", "x"),
            ("NVD_API_KEY", "abc-key-123"),
        ]))
        .unwrap();
        assert!(!format!("{config:?}").contains("abc-key-123"));
    }

    #[test]
    fn without_smtp_host_email_is_off_and_the_config_still_loads() {
        let config = Config::from_lookup(lookup(&[("DATABASE_URL", "x")])).unwrap();
        assert!(config.smtp.is_err());
        assert_eq!(config.time_zone, "UTC");
    }

    #[test]
    fn the_smtp_password_never_shows_in_the_config_debug_output() {
        let config = Config::from_lookup(lookup(&[
            ("DATABASE_URL", "x"),
            ("SMTP_HOST", "mail.example.com"),
            ("SMTP_PORT", "587"),
            ("SMTP_USER", "me"),
            ("SMTP_PASSWORD", "mail-secret-pw"),
            ("SMTP_FROM", "a@example.com"),
            ("APP_URL", "http://localhost:3000"),
        ]))
        .unwrap();
        assert!(config.smtp.is_ok());
        assert!(!format!("{config:?}").contains("mail-secret-pw"));
    }

    #[test]
    fn debug_output_hides_the_password() {
        let config =
            Config::from_lookup(lookup(&[("DATABASE_URL", "postgres://u:secret@h/db")])).unwrap();
        assert!(!format!("{config:?}").contains("secret"));
    }
}
