//! The job loop: two lanes, each running one job at a time (architecture section 4.3).
//! Fast lane: product search, status recompute. Slow lane: checks, rescans, data updates.
//! A long check never blocks a product search, and only one Trivy runs at a time.

use std::sync::Arc;
use std::time::Duration;

use sqlx::postgres::PgListener;
use sqlx::PgPool;
use tokio::sync::{watch, Notify};
use tracing::{error, info, info_span, warn, Instrument};

use crate::context::{timeout_for, Context};
use crate::contract::{JobPayload, JobType};
use crate::error::JobError;
use crate::hooks;
use crate::jobs;
use crate::queue::{self, ClaimedJob, Finished};

/// How often a lane looks for work even without a notification (D17).
pub const POLL_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lane {
    Fast,
    Slow,
}

impl Lane {
    pub fn job_types(self) -> &'static [JobType] {
        match self {
            Self::Fast => &[
                JobType::SearchProducts,
                JobType::RecomputeStatus,
                JobType::DevNoop,
            ],
            Self::Slow => &[
                JobType::CheckDevice,
                JobType::RescanAll,
                JobType::UpdateTrivyDb,
                JobType::ImportKev,
            ],
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::Slow => "slow",
        }
    }
}

/// Wakes the lanes when Postgres says a job was queued.
#[derive(Default)]
pub struct Wakeups {
    pub fast: Notify,
    pub slow: Notify,
}

impl Wakeups {
    fn wake_all(&self) {
        // notify_one stores a permit, so a job queued while a lane is busy is not missed.
        self.fast.notify_one();
        self.slow.notify_one();
    }

    fn for_lane(&self, lane: Lane) -> &Notify {
        match lane {
            Lane::Fast => &self.fast,
            Lane::Slow => &self.slow,
        }
    }
}

/// Listens on the `jobs` channel until shutdown. sqlx reconnects the listener by itself.
pub async fn listen(pool: PgPool, wakeups: Arc<Wakeups>, mut shutdown: watch::Receiver<bool>) {
    let mut listener = match PgListener::connect_with(&pool).await {
        Ok(l) => l,
        Err(err) => {
            error!(error = %err, "could not start listening for jobs; relying on the 30 s poll");
            return;
        }
    };
    if let Err(err) = listener.listen("jobs").await {
        error!(error = %err, "LISTEN jobs failed; relying on the 30 s poll");
        return;
    }
    loop {
        tokio::select! {
            _ = shutdown.changed() => return,
            received = listener.recv() => match received {
                Ok(_) => wakeups.wake_all(),
                Err(err) => {
                    warn!(error = %err, "listener error, will retry");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    wakeups.wake_all();
                }
            },
        }
    }
}

pub async fn run_lane(
    ctx: Arc<Context>,
    lane: Lane,
    wakeups: Arc<Wakeups>,
    mut shutdown: watch::Receiver<bool>,
) {
    info!(lane = lane.name(), "lane started");
    loop {
        if *shutdown.borrow() {
            break;
        }
        match drain(&ctx, lane, &shutdown).await {
            Ok(()) => {}
            Err(err) => error!(lane = lane.name(), error = %err, "could not read the queue"),
        }
        tokio::select! {
            _ = shutdown.changed() => break,
            () = wakeups.for_lane(lane).notified() => {}
            () = tokio::time::sleep(POLL_INTERVAL) => {}
        }
    }
    info!(lane = lane.name(), "lane stopped");
}

/// Runs jobs until nothing is due.
async fn drain(
    ctx: &Context,
    lane: Lane,
    shutdown: &watch::Receiver<bool>,
) -> Result<(), sqlx::Error> {
    while !*shutdown.borrow() {
        let Some(job) = queue::claim(&ctx.pool, lane.job_types(), &ctx.instance_id).await? else {
            return Ok(());
        };
        process(ctx, job, None).await;
    }
    Ok(())
}

/// Runs one claimed job and records the outcome. `limit` overrides the type's timeout (tests).
pub async fn process(ctx: &Context, job: ClaimedJob, limit: Option<Duration>) {
    let span =
        info_span!("job", job_id = %job.id, job_type = ?job.job_type, attempt = job.attempts);
    async {
        let limit = limit.unwrap_or_else(|| timeout_for(job.job_type));
        let started = std::time::Instant::now();
        let result = match tokio::time::timeout(limit, execute(ctx, &job)).await {
            Ok(result) => result,
            Err(_) => Err(JobError::Timeout),
        };
        match result {
            Ok(()) => finish_ok(ctx, &job, started).await,
            Err(err) => finish_err(ctx, &job, &err).await,
        }
    }
    .instrument(span)
    .await;
}

async fn finish_ok(ctx: &Context, job: &ClaimedJob, started: std::time::Instant) {
    match queue::mark_done(&ctx.pool, &job.id, &ctx.instance_id).await {
        Ok(Finished::Lost) => warn!("job was taken over while it ran, result dropped"),
        Ok(_) => info!(
            elapsed_ms = started.elapsed().as_millis() as u64,
            "job done"
        ),
        Err(err) => error!(error = %err, "could not mark the job done"),
    }
}

async fn finish_err(ctx: &Context, job: &ClaimedJob, err: &JobError) {
    let outcome = queue::mark_failed(&ctx.pool, job, &ctx.instance_id, err).await;
    match outcome {
        Ok(Finished::WillRetry) => {
            warn!(code = ?err.code(), error = %err, "job failed, will retry")
        }
        Ok(Finished::Failed) => {
            error!(code = ?err.code(), error = %err, "job failed for good");
            run_failed_hook(&ctx.pool, job, err).await;
        }
        Ok(_) => warn!("job was taken over while it ran, failure dropped"),
        Err(db_err) => error!(error = %db_err, original = %err, "could not record the job failure"),
    }
}

async fn run_failed_hook(pool: &PgPool, job: &ClaimedJob, err: &JobError) {
    let hook = hooks::on_failed(
        pool,
        &job.id,
        job.job_type,
        job.device_id.as_deref(),
        err.code(),
    )
    .await;
    if let Err(hook_err) = hook {
        error!(error = %hook_err, "failed-job cleanup did not run");
    }
}

async fn execute(ctx: &Context, job: &ClaimedJob) -> Result<(), JobError> {
    let payload = JobPayload::parse(job.job_type, &job.payload)
        .map_err(|e| JobError::BadPayload(e.to_string()))?;
    match payload {
        JobPayload::CheckDevice(p) => jobs::check_device::run(ctx, job, &p).await,
        JobPayload::RecomputeStatus(p) => jobs::recompute_status::run(&ctx.pool, &p).await,
        JobPayload::SearchProducts(p) => jobs::search_products::run(ctx, &p).await,
        JobPayload::RescanAll(p) => jobs::rescan_all::run(ctx, &p).await,
        JobPayload::UpdateTrivyDb => jobs::update_trivy_db::run(ctx).await,
        JobPayload::ImportKev => jobs::import_kev::run(ctx).await,
        JobPayload::DevNoop(p) => jobs::dev_noop::run(&p).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_job_type_belongs_to_exactly_one_lane() {
        for job_type in crate::contract::JobType::ALL {
            let fast = Lane::Fast.job_types().contains(job_type);
            let slow = Lane::Slow.job_types().contains(job_type);
            assert!(fast ^ slow, "{job_type:?} must be in one lane");
        }
    }
}
