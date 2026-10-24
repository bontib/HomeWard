use std::time::Duration;

use anyhow::Context;
use tracing::info;
use tracing_subscriber::EnvFilter;
use worker::config::Config;
use worker::db::{self, ConnectPolicy};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config = Config::from_env()?;
    let policy = ConnectPolicy {
        pool_size: config.db_pool_size,
        max_attempts: 8,
        first_delay: Duration::from_secs(1),
        attempt_timeout: Duration::from_secs(5),
    };
    let pool = db::connect_with_retry(&config.database_url, &policy).await?;
    db::check_schema(&pool).await?;
    info!("ready");

    // The job loop arrives in phase 4; until then the process just stays up.
    tokio::signal::ctrl_c()
        .await
        .context("could not listen for shutdown signal")?;
    info!("shutting down");
    Ok(())
}
