//! E-mail alerts against a real Postgres: the triggers, the SEND_EMAIL job, the daily summary,
//! the failure hook and housekeeping. Mail goes to lettre's stub transport or to a loopback
//! SMTP sink. Nothing here contacts a real mail server.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use std::time::{Duration, Instant};

use common::smtp_sink::{Behaviour, SmtpSink};
use common::{context, Setup, TestDb};
use lettre::transport::stub::AsyncStubTransport;
use worker::context::Context;
use worker::contract::{DevicePayload, JobErrorCode, JobType, SendEmailPayload};
use worker::error::JobError;
use worker::jobs::{recompute_status, rescan_all, send_digest, send_email};
use worker::mailer::{Mailer, SmtpSettings};
use worker::queue::{self, ClaimedJob};
use worker::{heartbeat, notify, runner};

fn settings(port: u16) -> SmtpSettings {
    let lookup = |name: &str| match name {
        "SMTP_HOST" => Some("127.0.0.1".to_string()),
        "SMTP_PORT" => Some(port.to_string()),
        "SMTP_FROM" => Some("alerts@homeguard.test".to_string()),
        "SMTP_TLS" => Some("off".to_string()),
        "APP_URL" => Some("http://homeguard.test".to_string()),
        _ => None,
    };
    SmtpSettings::from_lookup(lookup).expect("valid test settings")
}

fn context_for(db: &TestDb, mailer: Option<Mailer>, port: u16) -> Context {
    let cache = tempfile::tempdir().unwrap().keep();
    let mut ctx = context(db, &Setup::new("http://127.0.0.1:1", &cache));
    ctx.config.smtp = Ok(settings(port));
    ctx.mailer = mailer;
    ctx
}

fn stub_context(db: &TestDb) -> (Context, AsyncStubTransport) {
    let stub = AsyncStubTransport::new_ok();
    let from = settings(1).from;
    let ctx = context_for(db, Some(Mailer::stub(from, stub.clone())), 1);
    (ctx, stub)
}

fn sink_context(db: &TestDb, sink: &SmtpSink, limit: Duration) -> Context {
    let mailer = Mailer::smtp_with_limit(&settings(sink.port), limit).unwrap();
    context_for(db, Some(mailer), sink.port)
}

/// A person with a notification_pref row in the given state.
async fn mail_user(db: &TestDb, id: &str, state: &str) {
    db.user(id).await;
    sqlx::query(
        "INSERT INTO notification_pref (user_id, email_state, unsubscribe_token)
         VALUES ($1, $2::email_alert_state, 'unsub-token')",
    )
    .bind(id)
    .bind(state)
    .execute(&db.pool)
    .await
    .unwrap();
}

async fn add_finding(
    db: &TestDb,
    device: &str,
    component: &str,
    cve: &str,
    cvss: f64,
    exploited: bool,
) -> String {
    sqlx::query(
        "INSERT INTO vulnerability (id, severity, cvss_score, exploited, summary, details_source, fetched_at)
         VALUES ($1, 'HIGH', $2, $3, 'A flaw lets someone take over the device. More.', 'NVD', now())
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(cve)
    .bind(cvss)
    .bind(exploited)
    .execute(&db.pool)
    .await
    .unwrap();
    sqlx::query_scalar(
        "INSERT INTO finding (device_id, component_id, vulnerability_id, source, fixed_version)
         VALUES ($1, $2, $3, 'NVD', '2.0') RETURNING id",
    )
    .bind(device)
    .bind(component)
    .bind(cve)
    .fetch_one(&db.pool)
    .await
    .unwrap()
}

async fn instant_in_tx(db: &TestDb, device: &str, smtp_on: bool) -> Option<String> {
    let mut tx = db.pool.begin().await.unwrap();
    let queued = notify::queue_instant(&mut tx, device, smtp_on)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    queued
}

async fn notified(db: &TestDb, finding: &str) -> bool {
    sqlx::query_scalar("SELECT notified_at IS NOT NULL FROM finding WHERE id = $1")
        .bind(finding)
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

async fn count(db: &TestDb, sql: &str) -> i64 {
    db.scalar(sql).await
}

/// Inserts a notification and its SEND_EMAIL job the way web does for CONFIRM and TEST.
async fn queue_notification(
    db: &TestDb,
    user: &str,
    kind: &str,
    link_token: Option<&str>,
) -> (String, String) {
    let notification: String = sqlx::query_scalar(
        "INSERT INTO notification (user_id, kind, link_token) VALUES ($1, $2::notification_kind, $3) RETURNING id",
    )
    .bind(user)
    .bind(kind)
    .bind(link_token)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    let job = insert_send_job(db, user, &notification).await;
    (notification, job)
}

async fn insert_send_job(db: &TestDb, user: &str, notification: &str) -> String {
    sqlx::query_scalar(
        "INSERT INTO job (type, payload, priority, user_id)
         VALUES ('SEND_EMAIL', jsonb_build_object('notificationId', $1::text), 20, $2) RETURNING id",
    )
    .bind(notification)
    .bind(user)
    .fetch_one(&db.pool)
    .await
    .unwrap()
}

async fn claim_mail(ctx: &Context) -> ClaimedJob {
    queue::claim(&ctx.pool, &[JobType::SendEmail], &ctx.instance_id)
        .await
        .unwrap()
        .expect("a SEND_EMAIL job is waiting")
}

async fn send(ctx: &Context, job: &ClaimedJob) -> Result<(), JobError> {
    let payload = SendEmailPayload {
        notification_id: job.payload["notificationId"].as_str().unwrap().to_string(),
    };
    send_email::run(ctx, job, &payload).await
}

/// lettre sends long lines as quoted-printable; mail clients undo that, so the tests do too.
fn quoted_printable_decoded(raw: &str) -> String {
    let joined = raw.replace("=\r\n", "").replace("=\n", "");
    let mut out = String::new();
    let mut rest = joined.as_str();
    while let Some(at) = rest.find('=') {
        out.push_str(&rest[..at]);
        let code = rest
            .get(at + 1..at + 3)
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        match code {
            Some(byte) => {
                out.push(char::from(byte));
                rest = &rest[at + 3..];
            }
            None => {
                out.push('=');
                rest = &rest[at + 1..];
            }
        }
    }
    out.push_str(rest);
    out
}

async fn status_of(db: &TestDb, notification: &str) -> String {
    sqlx::query_scalar("SELECT status::text FROM notification WHERE id = $1")
        .bind(notification)
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

// ---------- Right away (NB-6) ----------

#[tokio::test]
async fn a_new_critical_finding_queues_one_instant_mail_and_marks_it() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    let (device, component) = db.device("u1", None, None).await;
    let finding = add_finding(&db, &device, &component, "CVE-1", 9.8, false).await;

    let queued = instant_in_tx(&db, &device, true).await;

    let notification = queued.expect("an INSTANT mail was queued");
    assert!(notified(&db, &finding).await);
    let linked: String = db.scalar("SELECT notification_id FROM finding").await;
    assert_eq!(linked, notification);
    let (kind, items): (String, i32) =
        sqlx::query_as("SELECT kind::text, item_count FROM notification")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!((kind.as_str(), items), ("INSTANT", 1));
    let (priority, user, attempts): (i32, String, i32) =
        sqlx::query_as("SELECT priority, user_id, max_attempts FROM job WHERE type = 'SEND_EMAIL'")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!((priority, user.as_str(), attempts), (10, "u1", 3));
    db.drop_database().await;
}

#[tokio::test]
async fn a_second_device_within_the_hour_gets_no_instant_mail_and_waits_for_the_digest() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    let (first, c1) = db.device("u1", None, None).await;
    let (second, c2) = db.device("u1", None, None).await;
    add_finding(&db, &first, &c1, "CVE-1", 9.8, false).await;
    let held_back = add_finding(&db, &second, &c2, "CVE-2", 9.8, false).await;

    assert!(instant_in_tx(&db, &first, true).await.is_some());
    assert!(instant_in_tx(&db, &second, true).await.is_none());

    assert!(!notified(&db, &held_back).await);
    assert_eq!(count(&db, "SELECT count(*) FROM notification").await, 1);
    db.drop_database().await;
}

#[tokio::test]
async fn vulnerable_ignored_and_already_told_findings_are_not_mailed() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    let (device, component) = db.device("u1", None, None).await;
    add_finding(&db, &device, &component, "CVE-V", 7.5, false).await;
    let ignored = add_finding(&db, &device, &component, "CVE-I", 9.8, false).await;
    let told = add_finding(&db, &device, &component, "CVE-T", 9.8, false).await;
    sqlx::query("UPDATE finding SET state = 'IGNORED', notified_at = now() WHERE id = $1")
        .bind(&ignored)
        .execute(&db.pool)
        .await
        .unwrap();
    // A reopened finding keeps notified_at, so it is not mailed again.
    sqlx::query("UPDATE finding SET notified_at = now() WHERE id = $1")
        .bind(&told)
        .execute(&db.pool)
        .await
        .unwrap();

    assert!(instant_in_tx(&db, &device, true).await.is_none());

    assert_eq!(count(&db, "SELECT count(*) FROM notification").await, 0);
    db.drop_database().await;
}

#[tokio::test]
async fn a_kev_import_that_makes_a_finding_critical_is_mailed_after_the_recompute() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    let (device, component) = db.device("u1", None, None).await;
    add_finding(&db, &device, &component, "CVE-K", 7.5, false).await;
    let payload = DevicePayload {
        device_id: device.clone(),
    };
    recompute_status::run(&db.pool, &payload, true)
        .await
        .unwrap();
    assert_eq!(count(&db, "SELECT count(*) FROM notification").await, 0);

    sqlx::query("UPDATE vulnerability SET exploited = true")
        .execute(&db.pool)
        .await
        .unwrap();
    recompute_status::run(&db.pool, &payload, true)
        .await
        .unwrap();

    assert_eq!(
        count(
            &db,
            "SELECT count(*) FROM notification WHERE kind = 'INSTANT'"
        )
        .await,
        1
    );
    db.drop_database().await;
}

#[tokio::test]
async fn nothing_is_marked_while_email_is_off_or_alerts_are_not_on() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    mail_user(&db, "u2", "OFF").await;
    let (mine, c1) = db.device("u1", None, None).await;
    let (theirs, c2) = db.device("u2", None, None).await;
    let waiting = add_finding(&db, &mine, &c1, "CVE-1", 9.8, false).await;
    let off_user = add_finding(&db, &theirs, &c2, "CVE-2", 9.8, false).await;

    assert!(instant_in_tx(&db, &mine, false).await.is_none());
    assert!(instant_in_tx(&db, &theirs, true).await.is_none());

    assert!(!notified(&db, &waiting).await);
    assert!(!notified(&db, &off_user).await);
    db.drop_database().await;
}

#[tokio::test]
async fn two_checks_at_the_same_time_queue_only_one_instant_mail() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    let (first, c1) = db.device("u1", None, None).await;
    let (second, c2) = db.device("u1", None, None).await;
    add_finding(&db, &first, &c1, "CVE-1", 9.8, false).await;
    add_finding(&db, &second, &c2, "CVE-2", 9.8, false).await;

    let (pool_a, pool_b) = (db.pool.clone(), db.pool.clone());
    let run = |pool: sqlx::PgPool, device: String| {
        tokio::spawn(async move {
            let mut tx = pool.begin().await.unwrap();
            let queued = notify::queue_instant(&mut tx, &device, true).await.unwrap();
            tokio::time::sleep(Duration::from_millis(100)).await;
            tx.commit().await.unwrap();
            queued
        })
    };
    let (a, b) = tokio::join!(run(pool_a, first), run(pool_b, second));

    let queued = [a.unwrap(), b.unwrap()];
    assert_eq!(queued.iter().flatten().count(), 1);
    assert_eq!(count(&db, "SELECT count(*) FROM notification").await, 1);
    db.drop_database().await;
}

// ---------- SEND_EMAIL (NB-5) ----------

#[tokio::test]
async fn an_instant_mail_is_sent_to_the_owner_and_marked_sent_once() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    let (device, component) = db.device("u1", None, None).await;
    add_finding(&db, &device, &component, "CVE-1", 9.8, true).await;
    let notification = instant_in_tx(&db, &device, true).await.unwrap();
    let (ctx, stub) = stub_context(&db);

    let job = claim_mail(&ctx).await;
    send(&ctx, &job).await.unwrap();
    send(&ctx, &job).await.unwrap();

    let sent = stub.messages().await;
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].0.to()[0].to_string(), "u1@example.com");
    assert!(sent[0].1.contains("Subject: Test device needs fixing now"));
    assert!(sent[0]
        .1
        .contains("Attackers are already using this problem."));
    assert_eq!(status_of(&db, &notification).await, "SENT");
    db.drop_database().await;
}

#[tokio::test]
async fn a_mail_is_cancelled_when_alerts_were_turned_off_after_queueing() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    let (notification, _) = queue_notification(&db, "u1", "TEST", None).await;
    sqlx::query("UPDATE notification_pref SET email_state = 'OFF'")
        .execute(&db.pool)
        .await
        .unwrap();
    let (ctx, stub) = stub_context(&db);

    let job = claim_mail(&ctx).await;
    send(&ctx, &job).await.unwrap();

    assert!(stub.messages().await.is_empty());
    assert_eq!(status_of(&db, &notification).await, "CANCELLED");
    db.drop_database().await;
}

#[tokio::test]
async fn a_test_mail_goes_to_the_owners_own_address_only() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    mail_user(&db, "u2", "ON").await;
    queue_notification(&db, "u1", "TEST", None).await;
    let (ctx, stub) = stub_context(&db);

    let job = claim_mail(&ctx).await;
    send(&ctx, &job).await.unwrap();

    let sent = stub.messages().await;
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].0.to().len(), 1);
    assert_eq!(sent[0].0.to()[0].to_string(), "u1@example.com");
    db.drop_database().await;
}

#[tokio::test]
async fn a_confirm_mail_carries_the_link_and_clears_the_token_afterwards() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "PENDING_CONFIRM").await;
    let (notification, _) = queue_notification(&db, "u1", "CONFIRM", Some("v1.link.sig")).await;
    let (ctx, stub) = stub_context(&db);

    let job = claim_mail(&ctx).await;
    send(&ctx, &job).await.unwrap();

    let raw = &stub.messages().await[0].1;
    let text = quoted_printable_decoded(raw);
    assert!(text.contains("http://homeguard.test/notifications/confirm?token=v1.link.sig"));
    assert!(text.contains("http://homeguard.test/notifications/unsubscribe?token=unsub-token"));
    let token: Option<String> = db.scalar("SELECT link_token FROM notification").await;
    assert_eq!(token, None);
    assert_eq!(status_of(&db, &notification).await, "SENT");
    db.drop_database().await;
}

#[tokio::test]
async fn a_confirm_mail_is_cancelled_when_the_link_token_is_missing_or_state_is_not_pending() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "PENDING_CONFIRM").await;
    mail_user(&db, "u2", "ON").await;
    let (no_token, _) = queue_notification(&db, "u1", "CONFIRM", None).await;
    let (wrong_state, _) = queue_notification(&db, "u2", "CONFIRM", Some("t")).await;
    let (ctx, stub) = stub_context(&db);

    for _ in 0..2 {
        let job = claim_mail(&ctx).await;
        send(&ctx, &job).await.unwrap();
    }

    assert!(stub.messages().await.is_empty());
    assert_eq!(status_of(&db, &no_token).await, "CANCELLED");
    assert_eq!(status_of(&db, &wrong_state).await, "CANCELLED");
    db.drop_database().await;
}

#[tokio::test]
async fn a_notification_that_is_gone_finishes_the_job_without_sending() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    queue_notification(&db, "u1", "TEST", None).await;
    // Deleting the person removes the job too (cascade), so the row is removed on its own here.
    sqlx::query("DELETE FROM notification")
        .execute(&db.pool)
        .await
        .unwrap();
    let (ctx, stub) = stub_context(&db);

    let job = claim_mail(&ctx).await;

    assert!(send(&ctx, &job).await.is_ok());
    assert!(stub.messages().await.is_empty());
    db.drop_database().await;
}

#[tokio::test]
async fn without_a_mailer_the_job_fails_at_once_with_smtp_not_configured() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    let (notification, _) = queue_notification(&db, "u1", "TEST", None).await;
    let ctx = context_for(&db, None, 1);

    let job = claim_mail(&ctx).await;
    runner::process(&ctx, job, None).await;

    let (status, code): (String, Option<JobErrorCode>) =
        sqlx::query_as("SELECT status::text, error_code FROM job WHERE type = 'SEND_EMAIL'")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(status, "FAILED");
    assert_eq!(code, Some(JobErrorCode::SmtpNotConfigured));
    assert_eq!(status_of(&db, &notification).await, "FAILED");
    db.drop_database().await;
}

#[tokio::test]
async fn a_job_for_another_persons_notification_is_a_bad_payload() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    mail_user(&db, "u2", "ON").await;
    let (notification, _) = queue_notification(&db, "u1", "TEST", None).await;
    // A second job that names u1's notification but belongs to u2.
    insert_send_job(&db, "u2", &notification).await;
    let (ctx, stub) = stub_context(&db);

    let own = claim_mail(&ctx).await;
    let foreign = claim_mail(&ctx).await;
    let (first, second) = if own.user_id.as_deref() == Some("u1") {
        (own, foreign)
    } else {
        (foreign, own)
    };

    assert!(matches!(
        send(&ctx, &second).await,
        Err(JobError::BadPayload(_))
    ));
    assert!(stub.messages().await.is_empty());
    assert!(send(&ctx, &first).await.is_ok());
    db.drop_database().await;
}

#[tokio::test]
async fn an_instant_mail_whose_findings_were_ignored_meanwhile_is_cancelled() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    let (device, component) = db.device("u1", None, None).await;
    let finding = add_finding(&db, &device, &component, "CVE-1", 9.8, false).await;
    let notification = instant_in_tx(&db, &device, true).await.unwrap();
    sqlx::query("UPDATE finding SET state = 'IGNORED' WHERE id = $1")
        .bind(&finding)
        .execute(&db.pool)
        .await
        .unwrap();
    let (ctx, stub) = stub_context(&db);

    let job = claim_mail(&ctx).await;
    send(&ctx, &job).await.unwrap();

    assert!(stub.messages().await.is_empty());
    assert_eq!(status_of(&db, &notification).await, "CANCELLED");
    db.drop_database().await;
}

// ---------- A real SMTP conversation (loopback sink) ----------

#[tokio::test]
async fn a_mail_reaches_the_sink_with_the_unsubscribe_headers() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let sink = SmtpSink::start(Behaviour::Accept).await;
    mail_user(&db, "u1", "ON").await;
    queue_notification(&db, "u1", "TEST", None).await;
    let ctx = sink_context(&db, &sink, Duration::from_secs(5));

    let job = claim_mail(&ctx).await;
    send(&ctx, &job).await.unwrap();

    let mails = sink.mails();
    assert_eq!(mails.len(), 1);
    let raw = &mails[0];
    assert!(raw.contains("To: u1@example.com"));
    assert!(raw.contains("From: HomeGuard <alerts@homeguard.test>"));
    assert!(raw.contains("Subject: HomeGuard test email"));
    assert!(raw.contains(
        "List-Unsubscribe: <http://homeguard.test/api/notifications/unsubscribe/one-click?token=unsub-token>"
    ));
    assert!(raw.contains("List-Unsubscribe-Post: List-Unsubscribe=One-Click"));
    assert!(raw.contains("We only email about new problems."));
    db.drop_database().await;
}

#[tokio::test]
async fn permanent_and_temporary_refusals_are_smtp_failed() {
    for code in [550, 451] {
        let Some(db) = TestDb::new().await else {
            return;
        };
        let sink = SmtpSink::start(Behaviour::RejectWith(code)).await;
        mail_user(&db, "u1", "ON").await;
        queue_notification(&db, "u1", "TEST", None).await;
        let ctx = sink_context(&db, &sink, Duration::from_secs(5));

        let job = claim_mail(&ctx).await;
        let result = send(&ctx, &job).await;

        let Err(err) = result else {
            panic!("a {code} reply must fail the job");
        };
        assert_eq!(err.code(), JobErrorCode::SmtpFailed);
        assert!(err.to_string().contains(&code.to_string()));
        assert!(!err.to_string().contains("example.com"));
        db.drop_database().await;
    }
}

#[tokio::test]
async fn a_silent_server_is_cut_off_at_the_time_limit() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let sink = SmtpSink::start(Behaviour::Silent).await;
    mail_user(&db, "u1", "ON").await;
    queue_notification(&db, "u1", "TEST", None).await;
    let ctx = sink_context(&db, &sink, Duration::from_millis(400));

    let job = claim_mail(&ctx).await;
    let started = Instant::now();
    let result = send(&ctx, &job).await;

    assert!(matches!(result, Err(JobError::SmtpFailed(_))));
    assert!(started.elapsed() < Duration::from_secs(5));
    db.drop_database().await;
}

// ---------- Failure hook (N-D12) ----------

#[tokio::test]
async fn a_mail_that_fails_for_good_gives_its_findings_back_and_a_rerun_changes_nothing() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let sink = SmtpSink::start(Behaviour::RejectWith(550)).await;
    mail_user(&db, "u1", "ON").await;
    let (device, component) = db.device("u1", None, None).await;
    let finding = add_finding(&db, &device, &component, "CVE-1", 9.8, false).await;
    let notification = instant_in_tx(&db, &device, true).await.unwrap();
    let ctx = sink_context(&db, &sink, Duration::from_secs(5));

    // Two attempts are used up already; this is the last one.
    sqlx::query("UPDATE job SET attempts = 2 WHERE type = 'SEND_EMAIL'")
        .execute(&db.pool)
        .await
        .unwrap();
    let job = claim_mail(&ctx).await;
    runner::process(&ctx, job.clone(), None).await;

    assert_eq!(status_of(&db, &notification).await, "FAILED");
    let code: Option<JobErrorCode> = db.scalar("SELECT error_code FROM notification").await;
    assert_eq!(code, Some(JobErrorCode::SmtpFailed));
    assert!(!notified(&db, &finding).await);
    let link: Option<String> = db.scalar("SELECT notification_id FROM finding").await;
    assert_eq!(link, None);

    worker::hooks::on_failed(
        &db.pool,
        &job.id,
        JobType::SendEmail,
        None,
        JobErrorCode::SmtpFailed,
    )
    .await
    .unwrap();
    assert_eq!(status_of(&db, &notification).await, "FAILED");
    db.drop_database().await;
}

#[tokio::test]
async fn a_failed_attempt_with_tries_left_keeps_the_mail_queued() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let sink = SmtpSink::start(Behaviour::RejectWith(451)).await;
    mail_user(&db, "u1", "ON").await;
    let (notification, _) = queue_notification(&db, "u1", "TEST", None).await;
    let ctx = sink_context(&db, &sink, Duration::from_secs(5));

    let job = claim_mail(&ctx).await;
    runner::process(&ctx, job, None).await;

    assert_eq!(status_of(&db, &notification).await, "QUEUED");
    let job_status: String = db
        .scalar("SELECT status::text FROM job WHERE type = 'SEND_EMAIL'")
        .await;
    assert_eq!(job_status, "QUEUED");
    db.drop_database().await;
}

#[tokio::test]
async fn the_reaper_runs_the_same_cleanup_for_a_mail_job_that_was_lost() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    let (device, component) = db.device("u1", None, None).await;
    let finding = add_finding(&db, &device, &component, "CVE-1", 9.8, false).await;
    let notification = instant_in_tx(&db, &device, true).await.unwrap();
    sqlx::query(
        "UPDATE job SET status = 'RUNNING', attempts = 3, locked_by = 'dead-worker', started_at = now()
         WHERE type = 'SEND_EMAIL'",
    )
    .execute(&db.pool)
    .await
    .unwrap();

    heartbeat::reap(&db.pool, "new-worker", true).await.unwrap();

    assert_eq!(status_of(&db, &notification).await, "FAILED");
    assert!(!notified(&db, &finding).await);
    db.drop_database().await;
}

// ---------- Daily summary (NB-7) ----------

#[tokio::test]
async fn the_digest_lists_new_critical_and_vulnerable_findings_once_a_day() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    mail_user(&db, "u2", "OFF").await;
    let (first, c1) = db.device("u1", None, None).await;
    let (second, c2) = db.device("u1", None, None).await;
    let (third, c3) = db.device("u1", None, None).await;
    let (off_device, c4) = db.device("u2", None, None).await;
    add_finding(&db, &first, &c1, "CVE-1", 9.8, false).await;
    let held_back = add_finding(&db, &second, &c2, "CVE-2", 9.8, false).await;
    let vulnerable = add_finding(&db, &second, &c2, "CVE-3", 7.5, false).await;
    let low = add_finding(&db, &third, &c3, "CVE-4", 2.0, false).await;
    add_finding(&db, &off_device, &c4, "CVE-5", 9.8, false).await;
    assert!(instant_in_tx(&db, &first, true).await.is_some());
    assert!(instant_in_tx(&db, &second, true).await.is_none());
    let (ctx, _stub) = stub_context(&db);

    send_digest::run(&ctx).await.unwrap();
    send_digest::run(&ctx).await.unwrap();

    let items: i32 = db
        .scalar("SELECT item_count FROM notification WHERE kind = 'DIGEST'")
        .await;
    assert_eq!(items, 2);
    assert_eq!(
        count(
            &db,
            "SELECT count(*) FROM notification WHERE kind = 'DIGEST'"
        )
        .await,
        1
    );
    assert!(notified(&db, &held_back).await);
    assert!(notified(&db, &vulnerable).await);
    assert!(!notified(&db, &low).await);
    let digest_priority: i32 = db
        .scalar(
            "SELECT priority FROM job WHERE type = 'SEND_EMAIL' ORDER BY created_at DESC LIMIT 1",
        )
        .await;
    assert_eq!(digest_priority, 5);
    let stamped: bool = db
        .scalar("SELECT last_digest_at IS NOT NULL FROM notification_pref WHERE user_id = 'u1'")
        .await;
    assert!(stamped);
    db.drop_database().await;
}

#[tokio::test]
async fn nothing_new_means_no_digest_and_no_timestamp() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    let (device, component) = db.device("u1", None, None).await;
    let told = add_finding(&db, &device, &component, "CVE-1", 9.8, false).await;
    sqlx::query("UPDATE finding SET notified_at = now() WHERE id = $1")
        .bind(&told)
        .execute(&db.pool)
        .await
        .unwrap();
    let (ctx, _stub) = stub_context(&db);

    send_digest::run(&ctx).await.unwrap();

    assert_eq!(count(&db, "SELECT count(*) FROM notification").await, 0);
    let stamped: Option<chrono::NaiveDateTime> = db
        .scalar("SELECT last_digest_at FROM notification_pref")
        .await;
    assert_eq!(stamped, None);
    db.drop_database().await;
}

#[tokio::test]
async fn a_digest_sends_and_lists_the_held_back_finding() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    let (device, component) = db.device("u1", None, None).await;
    add_finding(&db, &device, &component, "CVE-9", 7.5, false).await;
    let (ctx, stub) = stub_context(&db);

    send_digest::run(&ctx).await.unwrap();
    let job = claim_mail(&ctx).await;
    send(&ctx, &job).await.unwrap();

    let raw = &stub.messages().await[0].1;
    assert!(raw.contains("Subject: Daily summary: 1 new problem on 1 device"));
    assert!(raw.contains("Vulnerable: Security problem in Xbox"));
    db.drop_database().await;
}

// ---------- Housekeeping (NB-13) ----------

#[tokio::test]
async fn housekeeping_deletes_old_finished_notifications_by_id_and_keeps_notified_at() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    mail_user(&db, "u1", "ON").await;
    let (device, component) = db.device("u1", None, None).await;
    let finding = add_finding(&db, &device, &component, "CVE-1", 9.8, false).await;
    let old_sent: String = sqlx::query_scalar(
        "INSERT INTO notification (user_id, kind, status, created_at)
         VALUES ('u1', 'INSTANT', 'SENT', now() - interval '40 days') RETURNING id",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    let old_queued: String = sqlx::query_scalar(
        "INSERT INTO notification (user_id, kind, status, created_at)
         VALUES ('u1', 'TEST', 'QUEUED', now() - interval '40 days') RETURNING id",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    let recent: String = sqlx::query_scalar(
        "INSERT INTO notification (user_id, kind, status) VALUES ('u1', 'TEST', 'SENT') RETURNING id",
    )
    .fetch_one(&db.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE finding SET notified_at = now(), notification_id = $1 WHERE id = $2")
        .bind(&old_sent)
        .bind(&finding)
        .execute(&db.pool)
        .await
        .unwrap();
    let ctx = context_for(&db, None, 1);

    rescan_all::run(&ctx, &worker::contract::RescanAllPayload { user_id: None })
        .await
        .unwrap();

    let left: Vec<String> = sqlx::query_scalar("SELECT id FROM notification ORDER BY id")
        .fetch_all(&db.pool)
        .await
        .unwrap();
    let mut expected = vec![old_queued, recent];
    expected.sort();
    assert_eq!(left, expected);
    assert!(notified(&db, &finding).await);
    let link: Option<String> = db.scalar("SELECT notification_id FROM finding").await;
    assert_eq!(link, None);
    db.drop_database().await;
}
