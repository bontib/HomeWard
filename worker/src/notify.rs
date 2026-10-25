//! Queueing mail inside the transaction that found the problem (architecture-notifications
//! section 4). A finding is marked `notified_at` in the same transaction as its notification
//! row, so two checks at once cannot mail the same finding twice.
//!
//! Lock order, everywhere: device -> finding -> notification_pref (the pref row last).

use sqlx::PgConnection;

use crate::contract::{NotificationKind, Severity};
use crate::status::{risk_level, RiskLevel};

const INSTANT_PRIORITY: i32 = 10;
pub const DIGEST_PRIORITY: i32 = 5;
const SEND_EMAIL_ATTEMPTS: i32 = 3;

/// An open finding nobody has been told about yet.
#[derive(Debug, sqlx::FromRow)]
pub struct Candidate {
    pub id: String,
    cvss_score: Option<f64>,
    severity: Severity,
    exploited: bool,
}

impl Candidate {
    /// The level is worked out in Rust (`status::risk_level`), never in SQL.
    pub fn level(&self) -> RiskLevel {
        risk_level(self.cvss_score, self.severity, self.exploited)
    }
}

/// Open, not yet mailed findings of one device, locked until the transaction ends.
async fn device_candidates(
    tx: &mut PgConnection,
    device_id: &str,
) -> Result<Vec<Candidate>, sqlx::Error> {
    sqlx::query_as(
        "SELECT f.id, v.cvss_score, v.severity, v.exploited
         FROM finding f JOIN vulnerability v ON v.id = f.vulnerability_id
         WHERE f.device_id = $1 AND f.state = 'OPEN' AND f.notified_at IS NULL
         ORDER BY f.id
         FOR UPDATE OF f",
    )
    .bind(device_id)
    .fetch_all(tx)
    .await
}

/// Open, not yet mailed findings of one person, locked until the transaction ends.
pub async fn user_candidates(
    tx: &mut PgConnection,
    user_id: &str,
) -> Result<Vec<Candidate>, sqlx::Error> {
    sqlx::query_as(
        "SELECT f.id, v.cvss_score, v.severity, v.exploited
         FROM finding f
         JOIN device d ON d.id = f.device_id
         JOIN vulnerability v ON v.id = f.vulnerability_id
         WHERE d.user_id = $1 AND f.state = 'OPEN' AND f.notified_at IS NULL
         ORDER BY f.id
         FOR UPDATE OF f",
    )
    .bind(user_id)
    .fetch_all(tx)
    .await
}

/// "Right away" mail for new Critical findings of one device. Call inside the device
/// transaction, after `status::recompute_device`. Returns the notification id when one
/// was queued.
pub async fn queue_instant(
    tx: &mut PgConnection,
    device_id: &str,
    smtp_on: bool,
) -> Result<Option<String>, sqlx::Error> {
    let critical: Vec<String> = device_candidates(tx, device_id)
        .await?
        .into_iter()
        .filter(|c| c.level() == RiskLevel::Critical)
        .map(|c| c.id)
        .collect();
    // Nothing is marked while mail is off, so the findings wait until it works.
    if critical.is_empty() || !smtp_on {
        return Ok(None);
    }
    let Some(user_id) = take_instant_slot(tx, device_id).await? else {
        return Ok(None);
    };
    let id = queue_mail(
        tx,
        &user_id,
        NotificationKind::Instant,
        &critical,
        INSTANT_PRIORITY,
    )
    .await?;
    Ok(Some(id))
}

/// One "right away" mail per person per hour. The pref row lock makes two checks of the
/// same person's devices wait for each other.
async fn take_instant_slot(
    tx: &mut PgConnection,
    device_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "UPDATE notification_pref p SET last_instant_at = now()
         FROM device d
         WHERE d.id = $1 AND p.user_id = d.user_id AND p.email_state = 'ON'
           AND (p.last_instant_at IS NULL OR p.last_instant_at <= now() - interval '1 hour')
         RETURNING p.user_id",
    )
    .bind(device_id)
    .fetch_optional(tx)
    .await
}

/// Writes the notification row, marks its findings and queues `SEND_EMAIL`. Shared by
/// INSTANT and DIGEST. The caller already holds the finding locks.
pub async fn queue_mail(
    tx: &mut PgConnection,
    user_id: &str,
    kind: NotificationKind,
    finding_ids: &[String],
    priority: i32,
) -> Result<String, sqlx::Error> {
    let item_count = i32::try_from(finding_ids.len()).unwrap_or(i32::MAX);
    let notification_id: String = sqlx::query_scalar(
        "INSERT INTO notification (user_id, kind, item_count) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(user_id)
    .bind(kind)
    .bind(item_count)
    .fetch_one(&mut *tx)
    .await?;

    let marked = sqlx::query(
        "UPDATE finding SET notified_at = now(), notification_id = $2
         WHERE id = ANY($1::text[]) AND notified_at IS NULL",
    )
    .bind(finding_ids)
    .bind(&notification_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    // The rows are locked, so a different count means a bug; roll everything back.
    if marked != finding_ids.len() as u64 {
        return Err(sqlx::Error::Protocol(
            "a finding was marked as notified by someone else".into(),
        ));
    }

    let job_id: String = sqlx::query_scalar(
        "INSERT INTO job (type, payload, priority, max_attempts, user_id)
         VALUES ('SEND_EMAIL', jsonb_build_object('notificationId', $1::text), $2, $3, $4)
         RETURNING id",
    )
    .bind(&notification_id)
    .bind(priority)
    .bind(SEND_EMAIL_ATTEMPTS)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    // pg_notify is delivered when the transaction commits.
    sqlx::query("SELECT pg_notify('jobs', $1)")
        .bind(&job_id)
        .execute(&mut *tx)
        .await?;
    Ok(notification_id)
}
