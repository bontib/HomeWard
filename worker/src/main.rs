use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context as _;
use chrono::Utc;
use sqlx::PgPool;
use tokio::sync::watch;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;
use worker::config::{check_cron, Config};
use worker::context::Context;
use worker::db::{self, ConnectPolicy};
use worker::nvd::{NvdClient, NvdSettings};
use worker::runner::{self, Lane, Wakeups};
use worker::trivy::Trivy;
use worker::{heartbeat, scheduler};

/// `docker compose` calls `worker healthcheck`: exit 0 when the heartbeat is recent.
const HEALTH_MAX_AGE_SECONDS: i32 = 90;
/// How long running jobs get to finish after SIGTERM before the process exits.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(8);

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let healthcheck = std::env::args().nth(1).is_some_and(|a| a == "healthcheck");
    let result = if healthcheck {
        health().await
    } else {
        serve().await
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("{err:#}");
            ExitCode::FAILURE
        }
    }
}

async fn connect(config: &Config, max_attempts: u32) -> anyhow::Result<PgPool> {
    let policy = ConnectPolicy {
        pool_size: config.db_pool_size,
        max_attempts,
        first_delay: Duration::from_secs(1),
        attempt_timeout: Duration::from_secs(5),
    };
    Ok(db::connect_with_retry(&config.database_url, &policy).await?)
}

async fn health() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    let pool = connect(&config, 1).await?;
    if heartbeat::is_alive(&pool, HEALTH_MAX_AGE_SECONDS).await? {
        Ok(())
    } else {
        anyhow::bail!(
            "the worker has not sent a heartbeat in the last {HEALTH_MAX_AGE_SECONDS} seconds"
        )
    }
}

fn instance_id() -> String {
    let host = std::env::var("HOSTNAME").unwrap_or_else(|_| "worker".to_string());
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos());
    format!("{host}-{:x}{nanos:x}", std::process::id())
}

async fn build_context(config: Config, pool: PgPool) -> anyhow::Result<Context> {
    worker::install_crypto_provider();
    let nvd = NvdClient::new(NvdSettings::standard(
        config.nvd_base_url.clone(),
        config.nvd_api_key.clone(),
    ))?;
    let trivy = Trivy::new(config.trivy_path.clone(), config.trivy_cache_dir.clone());
    let http = reqwest::Client::builder()
        .user_agent(concat!("homeguard-worker/", env!("CARGO_PKG_VERSION")))
        .redirect(worker::http_limits::same_host_redirects())
        .build()
        .context("could not build the HTTP client")?;
    Ok(Context {
        pool,
        config,
        nvd,
        trivy,
        http,
        instance_id: instance_id(),
    })
}

async fn serve() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    let cron = check_cron(&config.rescan_cron)?;
    let pool = connect(&config, 8).await?;
    db::check_schema(&pool).await?;

    let started_at = Utc::now();
    let ctx = Arc::new(build_context(config, pool.clone()).await?);
    info!(instance = %ctx.instance_id, api_key = ctx.config.nvd_api_key.is_some(), "worker starting");

    // Jobs left RUNNING by an earlier process go back in the queue before we claim anything.
    heartbeat::beat(&pool, &ctx.config, started_at).await?;
    heartbeat::reap(&pool, &ctx.instance_id, true).await?;
    scheduler::bootstrap(&pool, ctx.trivy.has_db()).await?;

    let (stop, shutdown) = watch::channel(false);
    let wakeups = Arc::new(Wakeups::default());
    let mut tasks = tokio::task::JoinSet::new();
    tasks.spawn(runner::listen(
        pool.clone(),
        wakeups.clone(),
        shutdown.clone(),
    ));
    for lane in [Lane::Fast, Lane::Slow] {
        tasks.spawn(runner::run_lane(
            ctx.clone(),
            lane,
            wakeups.clone(),
            shutdown.clone(),
        ));
    }
    tasks.spawn(scheduler::run(pool.clone(), cron, shutdown.clone()));
    tasks.spawn(heartbeat::run(
        pool.clone(),
        ctx.config.clone(),
        ctx.instance_id.clone(),
        started_at,
        shutdown.clone(),
    ));
    info!("ready");

    wait_for_signal().await?;
    info!("shutting down");
    let _ = stop.send(true);
    let drained = tokio::time::timeout(SHUTDOWN_GRACE, async {
        while tasks.join_next().await.is_some() {}
    })
    .await;
    if drained.is_err() {
        warn!("a job was still running; it will be picked up again after the restart");
    }
    Ok(())
}

async fn wait_for_signal() -> anyhow::Result<()> {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .context("could not listen for SIGTERM")?;
    tokio::select! {
        result = tokio::signal::ctrl_c() => result.context("could not listen for Ctrl+C"),
        _ = terminate.recv() => Ok(()),
    }
}
