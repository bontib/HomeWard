//! SEND_DIGEST: the daily summary (architecture-notifications section 4.6). A system job.
//! For every person with alerts ON who has not had a summary today, it queues one DIGEST
//! mail with their new Critical and Vulnerable findings. Nothing new means no mail.

use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Utc};
use sqlx::PgPool;
use tracing::{info, warn};

use crate::context::Context;
use crate::contract::NotificationKind;
use crate::error::JobError;
use crate::notify::{self, DIGEST_PRIORITY};
use crate::status::RiskLevel;

pub async fn run(ctx: &Context) -> Result<(), JobError> {
    if ctx.mailer.is_none() {
        warn!("email is off, the daily summary was skipped");
        return Ok(());
    }
    let since = local_midnight_utc(Local::now());
    let mut queued = 0_u32;
    for user_id in due_users(&ctx.pool, since).await? {
        if queue_digest_for(&ctx.pool, &user_id, since).await? {
            queued += 1;
        }
    }
    info!(queued, "daily summary done");
    Ok(())
}

/// Today 00:00 in the given zone, as the UTC time that the `timestamp(3)` columns hold.
pub fn local_midnight_utc<Tz: TimeZone>(now: DateTime<Tz>) -> NaiveDateTime {
    let midnight = now.date_naive().and_time(chrono::NaiveTime::MIN);
    now.timezone()
        .from_local_datetime(&midnight)
        .earliest()
        // Midnight does not exist on a clock-change day in some zones; a day back is close enough.
        .map_or_else(
            || now.with_timezone(&Utc).naive_utc() - chrono::Duration::hours(24),
            |t| t.with_timezone(&Utc).naive_utc(),
        )
}

async fn due_users(pool: &PgPool, since: NaiveDateTime) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT user_id FROM notification_pref
         WHERE email_state = 'ON' AND (last_digest_at IS NULL OR last_digest_at < $1)
         ORDER BY user_id",
    )
    .bind(since)
    .fetch_all(pool)
    .await
}

/// One short transaction per person. Returns true when a DIGEST was queued.
async fn queue_digest_for(
    pool: &PgPool,
    user_id: &str,
    since: NaiveDateTime,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let finding_ids: Vec<String> = notify::user_candidates(&mut tx, user_id)
        .await?
        .into_iter()
        .filter(|c| matches!(c.level(), RiskLevel::Critical | RiskLevel::Vulnerable))
        .map(|c| c.id)
        .collect();
    // Nothing new: leave last_digest_at alone so a later run today can still send.
    if finding_ids.is_empty() {
        return Ok(false);
    }
    notify::queue_mail(
        &mut tx,
        user_id,
        NotificationKind::Digest,
        &finding_ids,
        DIGEST_PRIORITY,
    )
    .await?;
    // The pref row is locked last (lock order). No row: alerts went off, or another run won.
    let gate: Option<String> = sqlx::query_scalar(
        "UPDATE notification_pref SET last_digest_at = now()
         WHERE user_id = $1 AND email_state = 'ON'
           AND (last_digest_at IS NULL OR last_digest_at < $2)
         RETURNING user_id",
    )
    .bind(user_id)
    .bind(since)
    .fetch_optional(&mut *tx)
    .await?;
    if gate.is_none() {
        tx.rollback().await?;
        return Ok(false);
    }
    tx.commit().await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use chrono::FixedOffset;

    use super::*;

    #[test]
    fn midnight_in_amsterdam_summer_time_is_22_00_utc_the_day_before() {
        let zone = FixedOffset::east_opt(2 * 3600).unwrap();
        let now = zone.with_ymd_and_hms(2026, 10, 25, 9, 30, 0).unwrap();
        let expected = chrono::NaiveDate::from_ymd_opt(2026, 10, 24)
            .unwrap()
            .and_hms_opt(22, 0, 0)
            .unwrap();
        assert_eq!(local_midnight_utc(now), expected);
    }

    #[test]
    fn midnight_in_utc_is_midnight() {
        let now = Utc.with_ymd_and_hms(2026, 10, 25, 23, 59, 0).unwrap();
        let expected = chrono::NaiveDate::from_ymd_opt(2026, 10, 25)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        assert_eq!(local_midnight_utc(now), expected);
    }
}
