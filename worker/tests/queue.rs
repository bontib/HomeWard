//! Claiming, retrying, failing and reaping jobs against a real Postgres.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::TestDb;
use worker::contract::{JobErrorCode, JobType};
use worker::error::JobError;
use worker::{heartbeat, queue};

const ME: &str = "worker-a";

async fn add_job(db: &TestDb, job_type: &str, priority: i32, extra: &str) -> String {
    sqlx::query_scalar(&format!(
        "INSERT INTO job (type, payload, priority {extra}) VALUES ('{job_type}', '{{}}', {priority}) RETURNING id"
    ))
    .fetch_one(&db.pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn claim_takes_the_highest_priority_then_the_oldest() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let low = add_job(&db, "DEV_NOOP", 0, "").await;
    let high_old = add_job(&db, "DEV_NOOP", 20, "").await;
    let high_new = add_job(&db, "DEV_NOOP", 20, "").await;

    let order: Vec<String> = {
        let mut ids = Vec::new();
        while let Some(job) = queue::claim(&db.pool, &[JobType::DevNoop], ME)
            .await
            .unwrap()
        {
            ids.push(job.id);
        }
        ids
    };
    assert_eq!(order, [high_old, high_new, low]);
    db.drop_database().await;
}

#[tokio::test]
async fn claim_counts_the_attempt_and_marks_the_job_running() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    add_job(&db, "DEV_NOOP", 0, "").await;
    let job = queue::claim(&db.pool, &[JobType::DevNoop], ME)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(job.attempts, 1);
    let (status, locked_by): (String, String) =
        sqlx::query_as("SELECT status::text, locked_by FROM job WHERE id = $1")
            .bind(&job.id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!((status.as_str(), locked_by.as_str()), ("RUNNING", ME));
    db.drop_database().await;
}

#[tokio::test]
async fn claim_skips_other_lanes_and_jobs_that_are_not_due() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    add_job(&db, "IMPORT_KEV", 20, "").await;
    sqlx::query("INSERT INTO job (type, payload, run_after) VALUES ('DEV_NOOP', '{}', now() + interval '1 hour')")
        .execute(&db.pool)
        .await
        .unwrap();
    let claimed = queue::claim(&db.pool, &[JobType::DevNoop], ME)
        .await
        .unwrap();
    assert!(claimed.is_none());
    db.drop_database().await;
}

#[tokio::test]
async fn two_claimers_never_get_the_same_job() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    for _ in 0..20 {
        add_job(&db, "DEV_NOOP", 0, "").await;
    }
    let mut handles = Vec::new();
    for name in ["a", "b", "c", "d"] {
        let pool = db.pool.clone();
        handles.push(tokio::spawn(async move {
            let mut mine = Vec::new();
            while let Some(job) = queue::claim(&pool, &[JobType::DevNoop], name)
                .await
                .unwrap()
            {
                mine.push(job.id);
            }
            mine
        }));
    }
    let mut all = Vec::new();
    for handle in handles {
        all.extend(handle.await.unwrap());
    }
    let unique: std::collections::HashSet<_> = all.iter().collect();
    assert_eq!(all.len(), 20);
    assert_eq!(unique.len(), 20);
    db.drop_database().await;
}

#[tokio::test]
async fn a_finished_job_is_done() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    add_job(&db, "DEV_NOOP", 0, "").await;
    let job = queue::claim(&db.pool, &[JobType::DevNoop], ME)
        .await
        .unwrap()
        .unwrap();
    let result = queue::mark_done(&db.pool, &job.id, ME).await.unwrap();
    assert_eq!(result, queue::Finished::Done);
    let status: String = db.scalar("SELECT status::text FROM job").await;
    assert_eq!(status, "DONE");
    db.drop_database().await;
}

#[tokio::test]
async fn a_first_failure_waits_one_minute_before_the_retry() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    add_job(&db, "DEV_NOOP", 0, "").await;
    sqlx::query("UPDATE job SET max_attempts = 3")
        .execute(&db.pool)
        .await
        .unwrap();
    let job = queue::claim(&db.pool, &[JobType::DevNoop], ME)
        .await
        .unwrap()
        .unwrap();
    let error = JobError::NvdUnavailable("down".into());
    assert_eq!(
        queue::mark_failed(&db.pool, &job, ME, &error)
            .await
            .unwrap(),
        queue::Finished::WillRetry
    );

    let (status, code, wait): (String, String, f64) = sqlx::query_as(
        "SELECT status::text, error_code::text, extract(epoch FROM run_after - now())::float8 FROM job",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        (status.as_str(), code.as_str()),
        ("QUEUED", "NVD_UNAVAILABLE")
    );
    assert!(
        (55.0..=60.5).contains(&wait),
        "waits about a minute, got {wait}"
    );
    db.drop_database().await;
}

#[tokio::test]
async fn a_second_failure_waits_five_minutes() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    add_job(&db, "DEV_NOOP", 0, "").await;
    sqlx::query("UPDATE job SET max_attempts = 3, attempts = 1")
        .execute(&db.pool)
        .await
        .unwrap();
    let job = queue::claim(&db.pool, &[JobType::DevNoop], ME)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(job.attempts, 2);
    queue::mark_failed(&db.pool, &job, ME, &JobError::Timeout)
        .await
        .unwrap();
    let wait: f64 = db
        .scalar("SELECT extract(epoch FROM run_after - now())::float8 FROM job")
        .await;
    assert!(
        (295.0..=300.5).contains(&wait),
        "waits five minutes, got {wait}"
    );
    db.drop_database().await;
}

#[tokio::test]
async fn the_last_attempt_fails_the_job_and_the_device_check() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    db.user("u1").await;
    let (device, _) = db.device("u1", None, None).await;
    let job_id = db.queue_check(&device, "u1").await;
    sqlx::query("UPDATE job SET max_attempts = 3, attempts = 2 WHERE id = $1")
        .bind(&job_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let job = queue::claim(&db.pool, &[JobType::CheckDevice], ME)
        .await
        .unwrap()
        .unwrap();
    let error = JobError::NvdUnavailable("still down".into());
    assert_eq!(
        queue::mark_failed(&db.pool, &job, ME, &error)
            .await
            .unwrap(),
        queue::Finished::Failed
    );
    worker::hooks::on_failed(
        &db.pool,
        &job.id,
        job.job_type,
        job.device_id.as_deref(),
        error.code(),
    )
    .await
    .unwrap();

    let (state, code): (String, String) =
        sqlx::query_as("SELECT check_state::text, check_error_code::text FROM device")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        (state.as_str(), code.as_str()),
        ("FAILED", "NVD_UNAVAILABLE")
    );
    db.drop_database().await;
}

#[tokio::test]
async fn a_bad_payload_is_never_retried() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    add_job(&db, "DEV_NOOP", 0, "").await;
    let job = queue::claim(&db.pool, &[JobType::DevNoop], ME)
        .await
        .unwrap()
        .unwrap();
    let error = JobError::BadPayload("nope".into());
    assert_eq!(
        queue::mark_failed(&db.pool, &job, ME, &error)
            .await
            .unwrap(),
        queue::Finished::Failed
    );
    db.drop_database().await;
}

#[tokio::test]
async fn a_job_taken_over_by_the_reaper_drops_the_late_result() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    add_job(&db, "DEV_NOOP", 0, "").await;
    let job = queue::claim(&db.pool, &[JobType::DevNoop], ME)
        .await
        .unwrap()
        .unwrap();
    queue::reap(&db.pool, "worker-b", true).await.unwrap();
    assert_eq!(
        queue::mark_done(&db.pool, &job.id, ME).await.unwrap(),
        queue::Finished::Lost
    );
    db.drop_database().await;
}

#[tokio::test]
async fn at_start_jobs_of_a_dead_worker_go_back_to_the_queue() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    add_job(&db, "DEV_NOOP", 0, "").await;
    queue::claim(&db.pool, &[JobType::DevNoop], "old-instance")
        .await
        .unwrap();

    let reaped = queue::reap(&db.pool, "new-instance", true).await.unwrap();
    assert_eq!(reaped.len(), 1);
    let (status, code): (String, String) =
        sqlx::query_as("SELECT status::text, error_code::text FROM job")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!((status.as_str(), code.as_str()), ("QUEUED", "WORKER_LOST"));
    db.drop_database().await;
}

#[tokio::test]
async fn at_start_a_job_of_the_same_instance_is_left_alone() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    add_job(&db, "DEV_NOOP", 0, "").await;
    queue::claim(&db.pool, &[JobType::DevNoop], ME)
        .await
        .unwrap();
    assert!(queue::reap(&db.pool, ME, true).await.unwrap().is_empty());
    db.drop_database().await;
}

#[tokio::test]
async fn the_periodic_reaper_only_takes_jobs_running_over_fifteen_minutes() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    add_job(&db, "DEV_NOOP", 0, "").await;
    add_job(&db, "DEV_NOOP", 0, "").await;
    queue::claim(&db.pool, &[JobType::DevNoop], "other")
        .await
        .unwrap();
    queue::claim(&db.pool, &[JobType::DevNoop], "other")
        .await
        .unwrap();
    sqlx::query("UPDATE job SET started_at = now() - interval '20 minutes' WHERE id = (SELECT id FROM job LIMIT 1)")
        .execute(&db.pool)
        .await
        .unwrap();
    let reaped = queue::reap(&db.pool, ME, false).await.unwrap();
    assert_eq!(reaped.len(), 1);
    db.drop_database().await;
}

#[tokio::test]
async fn a_reaped_job_without_attempts_left_fails_its_device_check() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    db.user("u1").await;
    let (device, _) = db.device("u1", None, None).await;
    let job_id = db.queue_check(&device, "u1").await;
    sqlx::query("UPDATE job SET attempts = 2, max_attempts = 3 WHERE id = $1")
        .bind(&job_id)
        .execute(&db.pool)
        .await
        .unwrap();
    queue::claim(&db.pool, &[JobType::CheckDevice], "old")
        .await
        .unwrap();

    let count = heartbeat::reap(&db.pool, "new", true).await.unwrap();
    assert_eq!(count, 1);
    let (state, code): (String, Option<String>) =
        sqlx::query_as("SELECT check_state::text, check_error_code::text FROM device")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(state, "FAILED");
    assert_eq!(code.as_deref(), Some(JobErrorCode::WorkerLost.as_str()));
    db.drop_database().await;
}

#[tokio::test]
async fn system_jobs_are_not_queued_twice() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let first =
        queue::enqueue_unless_active(&db.pool, JobType::ImportKev, serde_json::json!({}), 5, None)
            .await
            .unwrap();
    let second =
        queue::enqueue_unless_active(&db.pool, JobType::ImportKev, serde_json::json!({}), 5, None)
            .await
            .unwrap();
    assert!(first.is_some());
    assert!(second.is_none());
    db.drop_database().await;
}
