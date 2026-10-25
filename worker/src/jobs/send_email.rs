//! SEND_EMAIL: sends one `notification` row (architecture-notifications section 4.4).
//! Safe to run twice: only a QUEUED row is sent, and it becomes SENT afterwards.
//! Delivery is at least once: a crash after the server said 250 and before SENT sends it again.

use std::collections::BTreeMap;

use chrono::NaiveDateTime;
use sqlx::PgPool;
use tracing::{info, warn};

use crate::context::Context;
use crate::contract::{
    EmailAlertState, NotificationKind, NotificationStatus, SendEmailPayload, Severity,
};
use crate::error::JobError;
use crate::mail_text::{self, DeviceBlock, MailContent, MailInput, Problem};
use crate::mailer::OutgoingMail;
use crate::queue::ClaimedJob;
use crate::status::risk_level;

#[derive(sqlx::FromRow)]
struct NotificationRow {
    user_id: String,
    kind: NotificationKind,
    status: NotificationStatus,
    link_token: Option<String>,
    email: String,
    email_state: Option<EmailAlertState>,
    unsubscribe_token: Option<String>,
}

#[derive(sqlx::FromRow)]
struct ItemRow {
    device_id: String,
    device_name: String,
    last_checked_at: Option<NaiveDateTime>,
    component_name: String,
    product_title: Option<String>,
    summary: String,
    fixed_version: Option<String>,
    exploited: bool,
    cvss_score: Option<f64>,
    severity: Severity,
}

pub async fn run(
    ctx: &Context,
    job: &ClaimedJob,
    payload: &SendEmailPayload,
) -> Result<(), JobError> {
    let id = payload.notification_id.as_str();
    let Some(row) = load(&ctx.pool, id).await? else {
        info!("the person was deleted, nothing to send");
        return Ok(());
    };
    // Web and the worker write the job's user id; a payload that points at another person's
    // row is a damaged or hand-made job.
    if job.user_id.as_deref() != Some(row.user_id.as_str()) {
        return Err(JobError::BadPayload(
            "the notification does not belong to the job's user".into(),
        ));
    }
    if row.status != NotificationStatus::Queued {
        return Ok(());
    }
    if !state_allows(row.kind, row.email_state) {
        cancel(&ctx.pool, id).await?;
        info!(kind = ?row.kind, "alerts are not on any more, mail cancelled");
        return Ok(());
    }
    let (Some(mailer), Ok(settings)) = (&ctx.mailer, &ctx.config.smtp) else {
        return Err(JobError::SmtpNotConfigured);
    };
    let Some(unsubscribe_token) = row.unsubscribe_token.as_deref() else {
        cancel(&ctx.pool, id).await?;
        return Ok(());
    };

    let Some(content) = content_for(&ctx.pool, id, &row, &settings.app_url).await? else {
        cancel(&ctx.pool, id).await?;
        info!(kind = ?row.kind, "nothing left to tell, mail cancelled");
        return Ok(());
    };
    let built = mail_text::build(&MailInput {
        app_url: settings.app_url.clone(),
        unsubscribe_url: mail_text::unsubscribe_url(&settings.app_url, unsubscribe_token),
        content,
    });
    let outgoing = OutgoingMail {
        to: row.email.clone(),
        subject: built.subject,
        body: built.body,
        message_id: id.to_string(),
        unsubscribe_url: mail_text::one_click_url(&settings.app_url, unsubscribe_token),
    };
    if let Err(err) = mailer.send(&outgoing).await {
        warn!(user_id = %row.user_id, kind = ?row.kind, error = %err, "mail was not sent");
        return Err(JobError::SmtpFailed(err.to_string()));
    }
    mark_sent(&ctx.pool, id).await?;
    info!(user_id = %row.user_id, kind = ?row.kind, "mail sent");
    Ok(())
}

async fn load(pool: &PgPool, id: &str) -> Result<Option<NotificationRow>, sqlx::Error> {
    sqlx::query_as(
        "SELECT n.user_id, n.kind, n.status, n.link_token, u.email,
                p.email_state, p.unsubscribe_token
         FROM notification n
         JOIN app_user u ON u.id = n.user_id
         LEFT JOIN notification_pref p ON p.user_id = n.user_id
         WHERE n.id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// CONFIRM goes out while the person waits to confirm; every other kind needs alerts ON.
fn state_allows(kind: NotificationKind, state: Option<EmailAlertState>) -> bool {
    match (kind, state) {
        (NotificationKind::Confirm, Some(EmailAlertState::PendingConfirm)) => true,
        (NotificationKind::Confirm, _) => false,
        (_, Some(EmailAlertState::On)) => true,
        _ => false,
    }
}

async fn cancel(pool: &PgPool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE notification SET status = 'CANCELLED', link_token = NULL
         WHERE id = $1 AND status = 'QUEUED'",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn mark_sent(pool: &PgPool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE notification SET status = 'SENT', sent_at = now(), link_token = NULL
         WHERE id = $1 AND status = 'QUEUED'",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// `None` means there is nothing to send (the mail would be empty).
async fn content_for(
    pool: &PgPool,
    id: &str,
    row: &NotificationRow,
    app_url: &str,
) -> Result<Option<MailContent>, sqlx::Error> {
    Ok(match row.kind {
        NotificationKind::Test => Some(MailContent::Test),
        NotificationKind::Confirm => row.link_token.as_deref().map(|token| MailContent::Confirm {
            confirm_url: mail_text::confirm_url(app_url, token),
        }),
        NotificationKind::Instant | NotificationKind::Digest => {
            let devices = load_devices(pool, id, &row.user_id).await?;
            if devices.is_empty() {
                None
            } else if row.kind == NotificationKind::Instant {
                Some(MailContent::Instant { devices })
            } else {
                Some(MailContent::Digest { devices })
            }
        }
    })
}

/// The still-open findings of one mail, grouped by device. One query, no N+1.
async fn load_devices(
    pool: &PgPool,
    notification_id: &str,
    user_id: &str,
) -> Result<Vec<DeviceBlock>, sqlx::Error> {
    let rows: Vec<ItemRow> = sqlx::query_as(
        "SELECT d.id AS device_id, d.name AS device_name, d.last_checked_at,
                c.name AS component_name, cp.title AS product_title,
                v.summary, f.fixed_version, v.exploited, v.cvss_score, v.severity
         FROM finding f
         JOIN device d ON d.id = f.device_id
         JOIN component c ON c.id = f.component_id
         JOIN vulnerability v ON v.id = f.vulnerability_id
         LEFT JOIN cpe_product cp ON cp.cpe = c.cpe
         WHERE f.notification_id = $1 AND f.state = 'OPEN' AND d.user_id = $2
         ORDER BY d.id, f.id",
    )
    .bind(notification_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(group_by_device(rows))
}

fn group_by_device(rows: Vec<ItemRow>) -> Vec<DeviceBlock> {
    let mut devices: BTreeMap<String, DeviceBlock> = BTreeMap::new();
    for row in rows {
        let problem = Problem {
            level: risk_level(row.cvss_score, row.severity, row.exploited),
            product: row.product_title.unwrap_or(row.component_name),
            summary: row.summary,
            fixed_version: row.fixed_version,
            exploited: row.exploited,
        };
        devices
            .entry(row.device_id.clone())
            .or_insert_with(|| DeviceBlock {
                id: row.device_id,
                name: row.device_name,
                last_checked: row.last_checked_at.map(|t| t.and_utc()),
                problems: Vec::new(),
            })
            .problems
            .push(problem);
    }
    devices.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confirm_mail_needs_a_pending_confirmation() {
        assert!(state_allows(
            NotificationKind::Confirm,
            Some(EmailAlertState::PendingConfirm)
        ));
        assert!(!state_allows(
            NotificationKind::Confirm,
            Some(EmailAlertState::Off)
        ));
        assert!(!state_allows(
            NotificationKind::Confirm,
            Some(EmailAlertState::On)
        ));
    }

    #[test]
    fn other_mail_needs_alerts_on() {
        for kind in [
            NotificationKind::Test,
            NotificationKind::Instant,
            NotificationKind::Digest,
        ] {
            assert!(state_allows(kind, Some(EmailAlertState::On)));
            assert!(!state_allows(kind, Some(EmailAlertState::Off)));
            assert!(!state_allows(kind, Some(EmailAlertState::PendingConfirm)));
            assert!(!state_allows(kind, None));
        }
    }
}
