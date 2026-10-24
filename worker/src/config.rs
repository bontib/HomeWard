//! Settings read from environment variables.

use std::fmt;

use thiserror::Error;

/// Listener, two lanes, scheduler and one spare (architecture section 7.2).
const DB_POOL_SIZE: u32 = 5;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("{0} is not set. Set it in .env (see .env.example).")]
    Missing(&'static str),
    #[error("{name} is not valid: {reason}")]
    Invalid { name: &'static str, reason: String },
}

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub db_pool_size: u32,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let database_url = get("DATABASE_URL")
            .filter(|v| !v.trim().is_empty())
            .ok_or(ConfigError::Missing("DATABASE_URL"))?;
        Ok(Self {
            database_url,
            db_pool_size: DB_POOL_SIZE,
        })
    }
}

// The URL contains the database password, so it never goes into logs.
impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("database_url", &"<redacted>")
            .field("db_pool_size", &self.db_pool_size)
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
    fn pool_size_defaults_to_five() {
        let config = Config::from_lookup(lookup(&[("DATABASE_URL", "postgres://x")])).unwrap();
        assert_eq!(config.db_pool_size, 5);
    }

    #[test]
    fn debug_output_hides_the_password() {
        let config =
            Config::from_lookup(lookup(&[("DATABASE_URL", "postgres://u:secret@h/db")])).unwrap();
        assert!(!format!("{config:?}").contains("secret"));
    }
}
