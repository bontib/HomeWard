# Architecture: e-mail notifications (V1.1)

Owner: architect. Branch `feature/email-notifications`. Ships as V1.1, after V1 (backlog Q1 accepted). No quiet hours (Q2 accepted).
Inputs: `docs/backlog-notifications.md` (N-D1 to N-D22, NB/NF/NU/NE stories), `docs/architecture-v1.md`, ADR 0001 to 0006, `docs/design/notifications.md` (screens and mail text).
Decision record: `docs/adr/0007-email-sent-by-worker-with-lettre.md`.

This document is the contract between backend, frontend and e2e for Phase 11. It adds to `docs/architecture-v1.md`; where the two differ for notifications, this one wins. Changes to sections 2 to 5 need an architect review.

---

## 1. Summary

- Still three containers. The worker sends every mail over SMTP with `lettre`. The web app never opens an SMTP connection and never sees an `SMTP_*` variable.
- Web and worker still talk only through Postgres. Web queues `SEND_EMAIL` for CONFIRM and TEST mails. The worker queues `SEND_EMAIL` for INSTANT and DIGEST mails, and `SEND_DIGEST` once a day at 07:00.
- The data is one `notification_pref` row per user, one `notification` row per mail, and `finding.notified_at` / `finding.notification_id`. A finding is mailed at most once: the `notified_at IS NULL` guard and the row locks make sure of that.
- The web app signs every token, because only the web app has `BETTER_AUTH_SECRET`. The worker copies ready-made tokens from the database into the mails. It has no signing key and never checks a token.
- Web learns "SMTP is set up" from `worker_status.smtp_configured`, which the worker heartbeat writes. The flag is a yes/no; no SMTP detail goes into the database.
- The worker gets a third lane, `mail`, so a slow mail server cannot hold up product search or device checks.
- Tests never contact a real mail server. Rust unit tests use `lettre`'s `AsyncStubTransport`. Worker integration tests and Playwright use a small loopback SMTP sink that we write ourselves (no new dependency).

Proved in this sandbox before hand-over (2026-10-25):
- The schema below passes `prisma validate` (Prisma 7.10.1). `prisma migrate diff` produces migration `0002_email_notifications`, and both migrations apply to a fresh embedded Postgres 17.10. The drift check (`--from-migrations … --exit-code` with a shadow DB) reports no difference. Several `ALTER TYPE … ADD VALUE` statements in one migration work on PG 17.
- Ten SQL checks from sections 4 and 5 run on that database with two connections: two checks at the same time give one INSTANT; an OFF user gets nothing; the mail-lane claim works; the failure hook works and a rerun does nothing; the digest marks findings and a second run on the same day finds nobody; OFF cancels queued rows; the baseline works and a used nonce cannot be reused; the rate-limit UPDATE lets one of two parallel requests through; housekeeping deletes by id. `EXPLAIN` of the digest candidate query uses `device_user_id_created_at_idx` and `finding_device_id_state_idx`.
- `lettre 0.11.23` with the features from ADR 0007 builds next to the worker's current lock file. It adds 8 crates, with no second `rustls`, `tokio` or `rustls-platform-verifier`, and the worker builds in release mode. Against a loopback sink: a send works with the `List-Unsubscribe` headers; 5xx is `is_permanent()`; 4xx is `is_transient()`; `AsyncStubTransport` records mail. **lettre's own `timeout()` did not cover the server greeting**: a silent server held a send for 60 s, while an outer `tokio::time::timeout` stopped it at the limit. The outer timeout is therefore required (section 4.4).
- Not run here: real TLS to a real provider, the arm64/musl image build with lettre, idle memory. These are on the manual pre-release checklist in the backlog.

---

## 2. Data model

File `web/prisma/schema.prisma`, migration `web/prisma/migrations/0002_email_notifications/migration.sql`. Generate it with `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` (or `migrate dev` against the embedded DB). Do not edit it by hand.

### 2.1 Enum additions

```prisma
enum JobType {
  // … V1 values unchanged …
  SEND_EMAIL  // one notification row: CONFIRM, TEST, INSTANT or DIGEST
  SEND_DIGEST // daily 07:00 summary, system job
}

enum JobErrorCode {
  // … V1 values unchanged …
  SMTP_FAILED         // mail server refused, timed out or could not be reached
  SMTP_NOT_CONFIGURED // the worker has no valid SMTP_* settings
}

enum EmailAlertState {
  OFF
  PENDING_CONFIRM // confirm mail sent, link not used yet
  ON
  @@map("email_alert_state")
}

enum NotificationKind {
  CONFIRM
  TEST
  INSTANT
  DIGEST
  @@map("notification_kind")
}

enum NotificationStatus {
  QUEUED
  SENT
  FAILED
  CANCELLED
  @@map("notification_status")
}
```

The migration contains `ALTER TYPE "job_type" ADD VALUE 'SEND_EMAIL'` (and three more of the same kind). Nothing in `0002` may use the new values; they are first used at run time.

### 2.2 Model changes

```prisma
model User {
  // … unchanged …
  notificationPref NotificationPref?
  notifications    Notification[]
}

model Finding {
  // … unchanged …
  // Mailed once, ever (N-D11). Set when a mail is queued, on ignore, and by the confirm baseline.
  // Cleared again (with notificationId) when that mail fails for good (N-D12).
  notifiedAt     DateTime?     @map("notified_at")
  notificationId String?       @map("notification_id")
  notification   Notification? @relation(fields: [notificationId], references: [id], onDelete: SetNull)

  @@index([notificationId])
}

model WorkerStatus {
  // … unchanged …
  smtpConfigured Boolean @default(false) @map("smtp_configured") // SMTP_* settings valid at start
}

// One row per user, created on the first "turn on". No row = OFF.
model NotificationPref {
  userId            String          @id @map("user_id")
  user              User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  emailState        EmailAlertState @default(OFF) @map("email_state")
  confirmNonce      String?         @map("confirm_nonce")     // only the newest confirm link works; null after use
  unsubscribeToken  String          @map("unsubscribe_token") // signed by web, copied into every mail by the worker
  confirmedAt       DateTime?       @map("confirmed_at")
  lastConfirmSentAt DateTime?       @map("last_confirm_sent_at") // web clock, 10-minute limit
  lastTestAt        DateTime?       @map("last_test_at")         // web clock, 5-minute limit
  lastInstantAt     DateTime?       @map("last_instant_at")      // worker clock, one INSTANT per hour
  lastDigestAt      DateTime?       @map("last_digest_at")       // worker clock, one DIGEST per local day
  createdAt         DateTime        @default(now()) @map("created_at")

  @@map("notification_pref")
}

// One row per mail. The worker builds the text from current rows when it sends.
model Notification {
  id        String             @id @default(dbgenerated("(gen_random_uuid())::text"))
  userId    String             @map("user_id")
  user      User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind      NotificationKind
  status    NotificationStatus @default(QUEUED)
  itemCount Int                @default(0) @map("item_count") // findings in an INSTANT or DIGEST
  linkToken String?            @map("link_token")             // CONFIRM only; cleared when the row is final
  errorCode JobErrorCode?      @map("error_code")
  createdAt DateTime           @default(now()) @map("created_at")
  sentAt    DateTime?          @map("sent_at")

  findings Finding[]

  @@index([userId, createdAt(sort: Desc)])
  @@map("notification")
}
```

Name choices against NB-2:
- The backlog's `email_state`, `confirmed_at`, `last_*_at`, `item_count`, `sent_at` and `error_code` are kept as written.
- Added: `confirm_nonce`, `unsubscribe_token`, `link_token` (section 6), `finding.notification_id` (needed to clear `notified_at` after a failure, N-D12), `worker_status.smtp_configured` (section 8).
- There is no `notification.job_id`. The SEND_EMAIL payload already holds the notification id, and the failure hook reads it from `job.payload` (section 4.5). That saves one write and one column.
- There is no separate "confirm tokens" table. Tokens are signed and kept stateless; the only stored state is the nonce on `notification_pref` that makes a confirm link single-use.

Who writes what (one writer per column, so there is one clock per column):

| Column | Writer |
|---|---|
| `email_state`, `confirm_nonce`, `unsubscribe_token`, `confirmed_at`, `last_confirm_sent_at`, `last_test_at` | web |
| `last_instant_at`, `last_digest_at`, `worker_status.smtp_configured` | worker |
| `notification` rows | web inserts CONFIRM and TEST; worker inserts INSTANT and DIGEST; both set `CANCELLED`; only the worker sets `SENT` and `FAILED` |
| `finding.notified_at` | worker (queue, failure), web (ignore, confirm baseline) |

### 2.3 Index review

| Query | Index |
|---|---|
| Settings: newest SENT / FAILED mail of a user | `notification(user_id, created_at DESC)` |
| Cancel queued rows of a user on OFF | same index (prefix `user_id`) |
| Clear `notified_at` of a failed mail; list a mail's findings when sending | `finding(notification_id)` (also the FK index) |
| Digest candidates of a user | `device(user_id, created_at)` → `finding(device_id, state)` + filter `notified_at IS NULL` (EXPLAIN checked) |
| INSTANT candidates of a device | `finding(device_id, state)` |
| Users due for a digest | seq scan of `notification_pref` (one row per person in the home; no index) |
| Housekeeping | seq scan of `notification` (30 days of mail for one home is a few hundred rows) |

No partial indexes. The tables are small.

### 2.4 Retention (NB-13)

`RESCAN_ALL` housekeeping also runs:

```sql
DELETE FROM notification WHERE id IN (
  SELECT id FROM notification
  WHERE status <> 'QUEUED' AND created_at < now() - make_interval(days => 30));
```

Findings that pointed at a deleted row keep `notified_at`; the FK sets `notification_id` to null.

---

## 3. Contracts across the boundary

Same rules as ADR 0003: one source of truth per contract, guarded by tests on both sides, and every change in one PR.

| Contract | Source of truth | TS | Rust | Guard |
|---|---|---|---|---|
| New enums | `schema.prisma` | `enums.ts`: `EmailAlertStateSchema`, `NotificationKindSchema`, `NotificationStatusSchema`, plus new values in `JobTypeSchema` and `JobErrorCodeSchema` | `contract.rs`: `EmailAlertState`, `NotificationKind`, `NotificationStatus` (`sqlx::Type`, SCREAMING_SNAKE_CASE) + new variants | existing enum sync tests on both sides (they parse every `enum` block) |
| Job payloads | section 3.1 here | `JobPayloadSchemas.SEND_EMAIL`, `.SEND_DIGEST` | `SendEmailPayload`, `JobPayload::SendEmail`, `JobPayload::SendDigest` | `contracts/jobs/SEND_EMAIL.json`, `SEND_DIGEST.json`, `invalid/SEND_EMAIL.missing-notification-id.json`, `invalid/SEND_EMAIL.empty-notification-id.json` |
| Mail link paths | section 3.2 here | Next routes | `const`s in `worker/src/mail_text.rs` | NE-2 and NE-5 open the links from the captured mail |
| HTTP API | section 7 here | `api.ts` | n/a | route tests parse responses with the types |

Tokens are **not** a cross-boundary contract. Only the web app creates and reads them; to the worker they are opaque strings.

### 3.1 Job types

| Type | Payload | Queued by | Lane | Priority | Max attempts | Timeout | Job columns |
|---|---|---|---|---|---|---|---|
| `SEND_EMAIL` | `{ "notificationId": string }` (non-empty) | web: CONFIRM, TEST (20); worker: INSTANT (10), DIGEST (5) | **mail** | see column 2 | 3 | 60 s | `user_id` |
| `SEND_DIGEST` | `{}` | worker scheduler only | **mail** | 0 | 3 | 2 min | none (system job) |

```ts
// web/src/lib/contracts/jobs.ts (additions)
SEND_EMAIL: z.object({ notificationId: z.string().min(1) }),
SEND_DIGEST: z.object({}),
```

```rust
// worker/src/contract.rs (additions)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendEmailPayload { pub notification_id: String } // empty -> PayloadError, like deviceId
// JobPayload::SendEmail(SendEmailPayload), JobPayload::SendDigest
```

`web/src/lib/jobs.ts` `DEFAULTS`: `SEND_EMAIL: { priority: 20, maxAttempts: 3 }`, `SEND_DIGEST: { priority: 0, maxAttempts: 3 }`.

Retry rules (ADR 0001, N-D17): `SMTP_FAILED`, `TIMEOUT` and `WORKER_LOST` retry after 1 min and then 5 min. `SMTP_NOT_CONFIGURED` joins `SBOM_INVALID` and `BAD_PAYLOAD` as a code that fails at once, because retrying cannot fix the settings.

`GET /api/jobs/:id` already shows a job with `user_id = me`, so the UI can watch the `SEND_EMAIL` job of a test mail with `useJobWatcher`. `SEND_DIGEST` is a system job and stays hidden.

### 3.2 Mail link paths

`APP_URL` is the worker's copy of `BETTER_AUTH_URL` (section 9). The worker builds:

| Link | URL |
|---|---|
| Confirm (page) | `{APP_URL}/notifications/confirm?token={link_token}` |
| Unsubscribe (footer, page) | `{APP_URL}/notifications/unsubscribe?token={unsubscribe_token}` |
| One-click (header) | `List-Unsubscribe: <{APP_URL}/api/notifications/unsubscribe/one-click?token={unsubscribe_token}>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` |
| Device | `{APP_URL}/devices/{device_id}` |
| Home | `{APP_URL}/` |

---

## 4. Worker

### 4.1 Files

| File | Change |
|---|---|
| `worker/Cargo.toml` | `lettre` (ADR 0007 features) |
| `worker/src/mailer.rs` (new) | `SmtpSettings` (parsed from env, `Debug` hides the password), `Mailer` enum `{ Smtp(AsyncSmtpTransport<Tokio1Executor>), Stub(AsyncStubTransport) }`, `MailError` (thiserror), `send(&self, OutgoingMail) -> Result<(), MailError>` with the outer 20 s timeout. `Stub` is built only by tests. An enum, not a trait object: there are exactly two kinds. |
| `worker/src/mail_text.rs` (new) | Pure builder: `build(&MailInput) -> BuiltMail { subject, body }` for the four kinds, `clean_subject`, footer, link `const`s, 72-column wrap. Text is from `docs/design/notifications.md` section 5. No I/O. |
| `worker/src/notify.rs` (new) | `queue_instant(tx, device_id, smtp_on)` (section 4.3) and `queue_mail(tx, user_id, kind, finding_ids, priority)`, which INSTANT and DIGEST share. |
| `worker/src/jobs/send_email.rs` (new) | section 4.4 |
| `worker/src/jobs/send_digest.rs` (new) | section 4.6 |
| `worker/src/config.rs` | `smtp: Result<SmtpSettings, SmtpOff>` and `app_url`. A bad SMTP setting never stops the worker. |
| `worker/src/context.rs` | `mailer: Option<Mailer>` (`None` = e-mail off); `timeout_for`: `SendEmail` 60 s, `SendDigest` 2 min |
| `worker/src/contract.rs` | enums and payloads (section 3) |
| `worker/src/runner.rs` | `Lane::Mail` with `[SendEmail, SendDigest]`; a third `Notify` in `Wakeups`; `execute` arms |
| `worker/src/main.rs` | builds the mailer, prints the start-up lines (section 9), starts the mail lane |
| `worker/src/db.rs` / config | pool size 5 → 6 (the mail lane needs its own connection) |
| `worker/src/heartbeat.rs` | `beat` also writes `smtp_configured = ctx.mailer.is_some()` |
| `worker/src/hooks.rs` | `on_failed` arm for `SendEmail` (section 4.5) |
| `worker/src/scheduler.rs` | daily digest (section 4.6) |
| `worker/src/jobs/check_device.rs` | `write_results`: call `notify::queue_instant` after `status::recompute_device`, in the same transaction |
| `worker/src/jobs/recompute_status.rs` | same call, after `recompute_device` (covers KEV, NB-6) |
| `worker/src/jobs/rescan_all.rs` | housekeeping delete (section 2.4) |

### 4.2 Lock order (deadlock rule)

Every transaction that touches findings and the pref row takes locks in this order: **device → finding → notification_pref**. The pref row is always locked last.
- Check / recompute: `device FOR UPDATE` → finding upserts → candidates `FOR UPDATE OF f` → pref gate UPDATE.
- Digest: candidates `FOR UPDATE OF f` → pref gate UPDATE.
- Web confirm: baseline `UPDATE finding` → guarded pref UPDATE.
- Web OFF / test / resend: touch the pref and notification rows only.

### 4.3 Trigger: "right away" (NB-6)

`notify::queue_instant(&mut tx, device_id, smtp_on)` runs inside the device transaction of `CHECK_DEVICE` and `RECOMPUTE_STATUS`, right after `recompute_device`:

1. Candidates. The risk level is computed in Rust with `status::risk_level`, never in SQL, so there is still only one Rust implementation:
   ```sql
   SELECT f.id, v.cvss_score, v.severity, v.exploited
   FROM finding f JOIN vulnerability v ON v.id = f.vulnerability_id
   WHERE f.device_id = $1 AND f.state = 'OPEN' AND f.notified_at IS NULL
   ORDER BY f.id
   FOR UPDATE OF f;
   ```
   Keep the rows at `Critical`. None left → return.
2. `smtp_on` is false → return. Nothing is marked, so the findings wait until mail works.
3. Gate. The pref row lock serialises two checks of the same person's devices that run at once (proved):
   ```sql
   UPDATE notification_pref p SET last_instant_at = now()
   FROM device d
   WHERE d.id = $1 AND p.user_id = d.user_id AND p.email_state = 'ON'
     AND (p.last_instant_at IS NULL OR p.last_instant_at <= now() - interval '1 hour')
   RETURNING p.user_id;
   ```
   No row → return. Alerts are off, or an INSTANT went out less than an hour ago. The findings keep `notified_at` null and go into the next digest, or into the next INSTANT after the hour.
4. `queue_mail`:
   ```sql
   INSERT INTO notification (user_id, kind, item_count) VALUES ($1, 'INSTANT', $2) RETURNING id;
   UPDATE finding SET notified_at = now(), notification_id = $2
     WHERE id = ANY($1::text[]) AND notified_at IS NULL;          -- row count must equal $2 of the insert
   INSERT INTO job (type, payload, priority, max_attempts, user_id)
     VALUES ('SEND_EMAIL', jsonb_build_object('notificationId', $1::text), 10, 3, $2) RETURNING id;
   SELECT pg_notify('jobs', $1);                                  -- sent on commit
   ```

What counts as "new" follows from the rules:
- `notified_at IS NULL` means "never mailed". Low and "Update available" findings are never mailed, so they stay null. If KEV later makes one Critical, it is mailed then. That is wanted.
- Ignore sets `notified_at = COALESCE(notified_at, now())` (web `src/server/findings.ts`). A finding the person has already seen and ignored is never mailed, also after reopen (N-D11).
- Findings that existed before alerts were confirmed are marked by the baseline (section 6.4).
- A finding that disappears from a check and comes back later is a new row, so it can be mailed again. This is rare and accepted (section 11).

### 4.4 `SEND_EMAIL` (NB-4, NB-5)

1. Load the row:
   ```sql
   SELECT n.kind, n.status, n.link_token, u.email, p.email_state, p.unsubscribe_token
   FROM notification n JOIN app_user u ON u.id = n.user_id
   LEFT JOIN notification_pref p ON p.user_id = n.user_id
   WHERE n.id = $1;
   ```
   No row (user deleted, cascade) → `Ok`, DONE. `status <> 'QUEUED'` → `Ok` (already SENT, CANCELLED or FAILED; this makes the job safe to run twice).
2. Allowed state: CONFIRM needs `PENDING_CONFIRM`; TEST, INSTANT and DIGEST need `ON`. Otherwise run `UPDATE notification SET status = 'CANCELLED', link_token = NULL WHERE id = $1 AND status = 'QUEUED'` and return `Ok`.
3. `ctx.mailer` is `None` → `Err(SmtpNotConfigured)`, which fails at once and runs the hook.
4. Build the input from current rows. For INSTANT and DIGEST: findings `WHERE notification_id = $1 AND state = 'OPEN'`, joined with device (name, `last_checked_at`), component, `cpe_product.title`, and vulnerability (summary, exploited, score). One query, no N+1. Order worst first with `status::risk_level`. No items left (fixed or ignored since) → CANCELLED, `Ok`. CONFIRM without a `link_token` → CANCELLED.
5. `mail_text::build`, then `mailer.send`. Recipient: `u.email`, always the row owner's address (TEST included). From: `SMTP_FROM`; a bare address gets the display name "HomeGuard". `Message-ID: <{notification_id}@{from domain}>`, because lettre does not add one without its `hostname` feature.
6. Sent → `UPDATE notification SET status = 'SENT', sent_at = now(), link_token = NULL WHERE id = $1 AND status = 'QUEUED'`.
7. Send error → `Err(SmtpFailed)`, and the runner's normal retry applies. The row stays QUEUED between attempts. If the person turns alerts off meanwhile, the next attempt cancels it in step 2.

Sending:
- `tokio::time::timeout(Duration::from_secs(20), transport.send(msg))` around the **whole** send. lettre's `.timeout(Some(20 s))` is set too, but it does not cover the greeting (proved). Elapsed → `SmtpFailed`.
- One connection per mail. No `pool` feature: no idle sockets, no idle memory.
- Logs: `job_id`, `user_id`, mail kind, result, SMTP reply code. Never the address, the subject, the body, a token or the password. The lettre `tracing` feature stays off because it logs SMTP commands, which contain addresses.

Delivery is at least once. If the worker dies after the server accepted the mail (250) and before step 6, the reaper requeues the job and the mail goes out twice. This window is a few milliseconds; we accept it. A `SENDING` state would only move the window.

### 4.5 Failure hook (N-D12)

`hooks::on_failed` for `JobType::SendEmail`, also reached through the reaper:

```sql
WITH n AS (
  UPDATE notification SET status = 'FAILED', error_code = $2, link_token = NULL
  WHERE id = (SELECT payload->>'notificationId' FROM job WHERE id = $1) AND status = 'QUEUED'
  RETURNING id)
UPDATE finding SET notified_at = NULL, notification_id = NULL
WHERE notification_id IN (SELECT id FROM n);
```

The INSTANT or DIGEST findings become "new" again, so the next digest picks them up. CONFIRM and TEST have no findings. A second run changes nothing (proved).

`SEND_DIGEST` failure: no hook. Rerunning it is safe.

### 4.6 Daily summary (NB-7)

Scheduler (`scheduler.rs`), only while `ctx.mailer.is_some()`:
- A fixed `croner` schedule `0 7 * * *` in the container's local time (`TZ`), next to `RESCAN_CRON`. Sleep in steps of at most 60 s. When it is due, insert `SEND_DIGEST {}` unless one is `QUEUED` or `RUNNING`.
- Catch-up at start: if local time is past 07:00, queue one the same way. The per-user gate below makes this a no-op for anyone who already got today's summary, so no "last run" bookkeeping is needed.

`SEND_DIGEST` handler:
1. `local_midnight` = today 00:00 in `TZ`, as a UTC `NaiveDateTime` (the worker session is UTC and the columns are `timestamp(3)`).
2. Users due: `SELECT user_id FROM notification_pref WHERE email_state = 'ON' AND (last_digest_at IS NULL OR last_digest_at < $1) ORDER BY user_id`.
3. One short transaction per user (a home has a handful of users; a loop is fine):
   - Candidates: the query from 4.3, but by user (`JOIN device d … WHERE d.user_id = $1`), `FOR UPDATE OF f`. Keep `Critical` and `Vulnerable` in Rust. None → rollback, next user. `last_digest_at` is not set, so a later run today can still send if something new turns up.
   - `queue_mail(kind = DIGEST, priority 5)`.
   - Gate last (lock order): `UPDATE notification_pref SET last_digest_at = now() WHERE user_id = $1 AND email_state = 'ON' AND (last_digest_at IS NULL OR last_digest_at < $2) RETURNING user_id`. No row → rollback. The person turned alerts off, or a parallel run got there first.
4. Rerun on the same day: step 2 finds nobody (proved).

The digest lists the worst 20 devices and at most 5 problems per device (design section 5.3). `item_count` counts all findings that were marked, so those not listed are still "told" and point to the home page.

---

## 5. SQL the web side runs

All inside `src/server/notifications.ts`. Prisma `updateMany` with the same `where` is fine; the guard must be in the `WHERE`, never a read followed by a write.

- Rate limit (N-D21), atomic (proved). The test limit (5 min, `last_test_at`) is the same shape:
  ```sql
  UPDATE notification_pref SET last_confirm_sent_at = $2
  WHERE user_id = $1 AND (last_confirm_sent_at IS NULL OR last_confirm_sent_at < $2::timestamp - interval '10 minutes');
  ```
  0 rows → 429.
- OFF cancels queued mail:
  `UPDATE notification SET status = 'CANCELLED', link_token = NULL WHERE user_id = $1 AND status = 'QUEUED'`.
- Baseline and guarded confirm: section 6.4.

---

## 6. Tokens

### 6.1 Who signs

The web app signs and checks every token. The worker never gets `BETTER_AUTH_SECRET` and gets no second shared secret either. It reads finished tokens from two columns:
- `notification_pref.unsubscribe_token`: written by web when the pref row is created, and re-minted on every turn-on and confirm. Every mail kind uses it.
- `notification.link_token`: the confirm token, written by web on the CONFIRM row. The worker clears it when the row becomes SENT, FAILED or CANCELLED, so it exists in the database only while the mail is on its way.

Rejected options: (a) giving the worker `BETTER_AUTH_SECRET`, which would let a worker bug forge sessions; (b) a new `NOTIFY_TOKEN_SECRET` in both services, which is one more secret to set and to leak, for no gain. Storing a signed token does not make it weaker. Anyone who can read the database can already change the pref row directly.

### 6.2 Format

```
token   = "v1." + b64url(payload_json) + "." + b64url(HMAC-SHA256(key, "v1." + b64url(payload_json)))
payload = { "p": "confirm" | "unsubscribe", "u": userId, "n": nonce | null, "e": expiryUnixSeconds | null }
key     = HKDF-SHA256(ikm = BETTER_AUTH_SECRET, salt = "", info = "homeguard notification token v1", length = 32)
```

- `crypto.hkdfSync`, `createHmac` and `timingSafeEqual` from `node:crypto`. No library.
- The purpose `p` is inside the signed data. A token is refused when `p` does not match the route.
- confirm: `n` = 16 random bytes (b64url), stored in `confirm_nonce`; `e` = now + 48 h.
- unsubscribe: `n = null`, `e = null` (no expiry, N-D14). The token is the same every time for a user, so re-minting it is idempotent.
- Zod for every token input: `z.string().min(20).max(512).regex(/^[A-Za-z0-9_.-]+$/)`.
- Module: `web/src/server/notification-tokens.ts` with `signToken(purpose, userId, opts)` and `verifyToken(token, purpose): { userId, nonce, expiresAt } | null`. Unit tests: round trip, wrong purpose, flipped byte, expired, other secret, malformed, too long.

### 6.3 Checks per route

| Route | Valid when |
|---|---|
| confirm | signature OK, `p = confirm`, not expired, pref `email_state = PENDING_CONFIRM` and `confirm_nonce = n`. **Or** signature OK and the user is already `ON`: answer success and change nothing, so a second click does not alarm anyone (design section 3). |
| unsubscribe | signature OK, `p = unsubscribe`. Already OFF or no pref row → success, no change. |

Every failure gives the same answer: 400 `INVALID_LINK` with the route's text. Nothing tells a forged token apart from an expired one.

### 6.4 Confirm transaction (NB-8, NB-10)

1. Baseline: `UPDATE finding f SET notified_at = now() FROM device d WHERE d.id = f.device_id AND d.user_id = $1 AND f.notified_at IS NULL`. This covers every finding, open and ignored.
2. `UPDATE notification_pref SET email_state = 'ON', confirmed_at = now(), confirm_nonce = NULL, unsubscribe_token = $3 WHERE user_id = $1 AND email_state = 'PENDING_CONFIRM' AND confirm_nonce = $2`. 0 rows → rollback, then the "already ON?" check, else 400. A used nonce cannot be reused (proved).

### 6.5 Secret rotation

Changing `BETTER_AUTH_SECRET` already signs everyone out. It also makes the links in mails already sent stop working: confirm links (48 h anyway) and unsubscribe links. Settings > Notifications still works, and the next turn-on re-mints the token. This goes in the README next to the secret.

---

## 7. HTTP API

### 7.1 Contract types (`web/src/lib/contracts/api.ts`)

```ts
export type ApiErrorCode = /* V1 codes */ | "CONFLICT" /* 409 */ | "INVALID_LINK" /* 400, token routes only */;

export type NotificationSettings = {
  state: EmailAlertState;            // OFF | PENDING_CONFIRM | ON
  email: string;                     // the signed-in person's own address, nobody else's
  smtpConfigured: boolean;           // worker_status.smtp_configured; false when the worker never ran
  lastSentAt: IsoDate | null;        // newest SENT notification, any kind
  lastError: JobErrorCode | null;    // set when the newest finished (SENT or FAILED) notification is FAILED
  digestHour: number;                // 7; local to timeZone
  timeZone: string | null;           // worker TZ name; null when the worker never ran
  confirmResendAt: IsoDate | null;   // PENDING_CONFIRM: when "Send the link again" unlocks (countdown)
  testAvailableAt: IsoDate | null;   // when "Send a test email" unlocks; null = now
};

export type NotificationLinkView = {
  purpose: "confirm" | "unsubscribe";
  maskedEmail: string;               // "y***@example.com" (design section 3)
  alreadyDone: boolean;              // confirm: already ON; unsubscribe: already OFF
};

export const SetEmailAlertsSchema = z.object({ enabled: z.boolean() }).strict();
export const NotificationTokenSchema = z.object({
  token: z.string().min(20).max(512).regex(/^[A-Za-z0-9_.-]+$/),
}).strict();
export const NotificationLinkQuerySchema = NotificationTokenSchema.extend({
  purpose: z.enum(["confirm", "unsubscribe"]),
});
```

UI states come from the data: "Can't send" = `state === "ON" && !smtpConfigured`; "Not set up" = `!smtpConfigured && state !== "ON"`. The UI owns the text for every `lastError` code; all codes show the same N-D17 sentence.

### 7.2 Routes

Signed-in routes use the V1 handler shape (`withSession` → Zod → `src/server/notifications.ts` → JSON). Token routes do not use a session.

| Method, path | Auth | Request | 2xx | Errors (code: message) |
|---|---|---|---|---|
| `GET /api/notifications` | session | none | `200 { settings: NotificationSettings }` | 401 |
| `PUT /api/notifications/email` | session, JSON, Origin | `SetEmailAlertsSchema` | `200 { settings, jobId: string \| null }`. `true`: OFF or PENDING → PENDING_CONFIRM, a new nonce (older links die), the queued CONFIRM rows cancelled, a new CONFIRM row + SEND_EMAIL; `jobId` is that job. ON → no change, `jobId` null. `false`: OFF, nonce null, queued rows cancelled, `jobId` null. | 400 `VALIDATION_FAILED`; 401; 403 `FORBIDDEN`; 409 `CONFLICT`: "Email alerts aren't set up on this HomeGuard yet." (only for `true`; nothing changes); 429 `RATE_LIMITED`: "Wait a few minutes before asking for another link." |
| `POST /api/notifications/test` | session, JSON, Origin | `{}` | `202 { settings, jobId }` | 401; 403; 409 `CONFLICT`: "Email alerts aren't set up on this HomeGuard yet." or "Turn on email alerts first."; 429: "Wait a few minutes before sending another test email." |
| `GET /api/notifications/link?purpose=&token=` | none | `NotificationLinkQuerySchema` | `200 { link: NotificationLinkView }`. Reads only. | 400 `INVALID_LINK` with the route's text |
| `POST /api/notifications/confirm` | none; JSON, Origin | `NotificationTokenSchema` | `200 { state: "ON" }` | 400 `INVALID_LINK`: "This link has expired. Turn on alerts again in Settings > Notifications."; 403; 409 `CONFLICT`: "Email alerts aren't set up on this HomeGuard yet." |
| `POST /api/notifications/unsubscribe` | none; JSON, Origin | `NotificationTokenSchema` | `200 { state: "OFF" }` | 400 `INVALID_LINK`: "This link doesn't work. You can turn alerts off in Settings > Notifications."; 403 |
| `POST /api/notifications/unsubscribe/one-click?token=` | none; **no Origin check**; `application/x-www-form-urlencoded`, body `List-Unsubscribe=One-Click` (RFC 8058) | token in the query | `200` empty body | 400 (bad token or body); 413 over 1 KB; 415 any other content type |

Notes:
- 404 is never used here: everything is "me" or a token.
- The `GET` routes and pages change nothing. Link scanners only GET, so they cannot confirm or unsubscribe.
- The one-click route is the one exception to the V1 rules "check Origin" and "require JSON". RFC 8058 says the mail provider sends a form POST from its own servers. The signed token is the only credential, and the route reads no cookie, so cross-site request forgery gains nothing. Body cap 1 KB. The JSON routes use the existing body reader in `http.ts`, with its size and depth caps.
- Token routes have no IP rate limit. A forged token fails the HMAC check in microseconds and touches no row.
- `src/proxy.ts` matcher: add `notifications` to the excluded paths so the two pages work without a session. The existing `Referrer-Policy: same-origin` keeps the token out of the Referer header sent to other sites.
- RTK Query: a new tag `Notifications`. `GET` provides it. PUT and test invalidate it now and again when their `jobId` settles (`useJobWatcher`). The landing pages use `GET link` and the POSTs; they need no tags.

---

## 8. "SMTP not configured" without SMTP secrets in web

- The worker parses `SMTP_*` at start. Valid → `Mailer::Smtp`, else `None` plus the one start-up line from section 9.
- `heartbeat::beat` writes `smtp_configured` every 30 s together with `heartbeat_at`. A restart with different settings shows up within one beat.
- Web reads `worker_status.smtp_configured`. No row → `false`. The flag is not combined with heartbeat age: if the worker is down, queued mail waits, and the Checks page already shows "scanner off".
- The flag means "the settings look valid". It does not mean "the server accepts our mail". Wrong passwords show up as `SMTP_FAILED` on the first mail. The test mail is the way to find out.
- Web refuses to queue when the flag is false (N-D4, 409). The worker also skips INSTANT and DIGEST while `mailer` is `None`. If SMTP goes away while alerts are ON, the UI shows "Can't send" and nothing is marked as notified.

---

## 9. Configuration

Worker only (`docker-compose.yml` `worker.environment`, `.env.example` with a comment per line). `web` gets none of these.

| Var | Rule |
|---|---|
| `SMTP_HOST` | unset → e-mail off: "Email alerts are off: SMTP_HOST is not set." |
| `SMTP_PORT` | required when `SMTP_HOST` is set (NB-1); 1 to 65535. `.env.example` has `587`. |
| `SMTP_USER`, `SMTP_PASSWORD` | both or neither. Only one set → off: "Email alerts are off: set both SMTP_USER and SMTP_PASSWORD, or neither." The password never appears in `Debug` or a log (test). |
| `SMTP_FROM` | required. `name <addr>` or `addr`, parsed as a lettre `Mailbox`. |
| `SMTP_TLS` | unset or `on`: port 465 = implicit TLS (`relay`), any other port = STARTTLS required (`starttls_relay`). `off`: plain text (`builder_dangerous`, `Tls::None`), with the warning "SMTP_TLS is off: email and the SMTP password are sent unencrypted." Any other value → off with a message. |
| `APP_URL` | not a new setting for users. Compose passes `APP_URL: ${BETTER_AUTH_URL:-http://localhost:3000}`. Must be an http(s) URL when SMTP is set, otherwise e-mail is off with a message. |
| `TZ` | already passed; also sets the 07:00 time. |

On valid settings the start-up line is: "Email alerts are on: sending through {host}:{port} with STARTTLS|TLS|no encryption." Every message names the variable and never its value, except host and port, which are not secret.

Certificates: `rustls-platform-verifier`, the same verifier reqwest uses, with the image's `ca-certificates`. A LAN relay with a self-signed certificate needs `SMTP_TLS=off`. The README says so.

---

## 10. File ownership (parallel work)

Same rule as V1 section 6.1: frontend never writes under `src/app/api`, `src/server` or `src/lib`; backend never writes under `src/components`, `src/features` or `src/store`. `src/lib/contracts/` changes only in PR-N1, which frontend reviews.

| Path | Owner |
|---|---|
| `web/prisma/schema.prisma`, `web/prisma/migrations/0002_email_notifications/` | backend |
| `web/src/lib/contracts/{enums,jobs,api}.ts`, `web/src/lib/jobs.ts` | backend (frontend reviews) |
| `web/src/server/notifications.ts`, `notification-tokens.ts`, `findings.ts` (ignore sets `notified_at`), `errors.ts` (two codes), `http.ts` (form-body reader for one-click) | backend |
| `web/src/app/api/notifications/**` (7 route files) | backend |
| `web/src/proxy.ts` (matcher) | backend |
| `worker/**`, `contracts/jobs/SEND_*.json`, `contracts/jobs/invalid/SEND_EMAIL.*.json` | backend |
| `docker-compose.yml`, `.env.example`, README "Email alerts" section | backend |
| `web/src/app/(app)/settings/notifications/page.tsx`, `web/src/app/(app)/settings/layout.tsx` (tab) | frontend |
| `web/src/app/(public)/notifications/{confirm,unsubscribe}/page.tsx` + `(public)/layout.tsx` (new group, no app shell, no session) | frontend |
| `web/src/features/notifications/**`: `api.ts` (`injectEndpoints`), `EmailAlertsCard.tsx`, `WhatWeEmailCard.tsx`, `AlertSampleCard.tsx`, `TestEmailButton.tsx`, `LinkLandingPage.tsx` (one component for both pages, two real uses), `fixtures.ts` | frontend |
| `web/src/store/api.ts` (tag `Notifications`) | frontend |
| `web/src/components/ui/` Pill icon slot, Banner critical icon (extensions of existing components, design section 6) | frontend |
| `web/e2e/support/mail-sink.mjs`, `web/e2e/support/stack.ts` (`PORTS.smtp`, `PORTS.sinkHttp`), `web/e2e/global-setup.ts`, `web/e2e/notifications*.spec.ts`, `web/package.json` script `e2e` | e2e-tester |

Form and local state (switch busy, countdown) stay in `useState`. No Redux slice is needed: everything else is server data in RTK Query.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Duplicate mail if the worker dies between SMTP "250" and `SENT` | Accepted (milliseconds). Documented as at least once. |
| A slow or silent SMTP server blocks work | Separate mail lane; an outer 20 s tokio timeout (lettre's own timeout misses the greeting, proved); 60 s job timeout. |
| Deadlock between check, digest and confirm | Lock order device → finding → pref (4.2). Postgres would break a deadlock anyway, and the job retries. |
| Two checks at once send two INSTANTs | Pref row gate inside the device transaction (proved). |
| Mail sent after the person turned alerts off | The job checks the state before sending. The remaining window is under a second. The page leaves out the "may still arrive" caption. |
| Rotating `BETTER_AUTH_SECRET` breaks old unsubscribe links | Settings still works; documented (6.5). |
| A finding that disappears and comes back is mailed again | Accepted: rare (NVD data changes, version downgrades). |
| Restarting the worker after 07:00 sends the day's digest at start | Only if nothing was sent today; documented. |
| KEV makes several devices Critical at once; only the first gets an INSTANT | By design (hourly cap, N-D11). The others are in the 07:00 digest. |
| TZ left at UTC: "7 am" is 07:00 UTC | `.env.example` and README stress `TZ`. Open point below. |
| Mail lands in spam | Correct `From`, `Message-ID`, `Date` and `List-Unsubscribe`; DKIM and SPF are the relay's job. The manual checklist covers this. |
| An address lettre cannot parse | `SMTP_FAILED` after 3 attempts; logged without the address. |

## 12. Tests

Worker (no network, `REQUIRE_DB_TESTS=1` in CI):
- Unit: `mail_text` on fixtures for all four kinds. Checks: banned phrases, exact footer, subject without CR/LF and at most 120 chars for a name like `Cam\r\nBcc: x`, 20-device and 5-per-device caps, plurals, level word and "Last checked" present. `SmtpSettings` parsing table (each bad variable gives its message; `Debug` has no password). The TLS choice by port and `SMTP_TLS`. Contract fixtures for `SEND_EMAIL` and `SEND_DIGEST`. `Lane::Mail` covers exactly the two types (the existing "every type in one lane" test).
- Stub (`Mailer::Stub`): SEND_EMAIL sends, sets SENT and clears `link_token`; second run does nothing; OFF → CANCELLED; deleted user → DONE; no mailer → `SMTP_NOT_CONFIGURED` with no connection; TEST goes to the owner's address.
- Loopback sink (`worker/tests/support/smtp_sink.rs`, a tokio `TcpListener` on 127.0.0.1): 550 → `SmtpFailed`; 451 → `SmtpFailed`; a silent server → `SmtpFailed` within the 20 s limit (in the test, a short limit passed in); the headers include `List-Unsubscribe` and `List-Unsubscribe-Post`.
- DB: each NB-6 case (critical → one INSTANT and `notified_at` set; a second device within the hour → none, and it is in the next digest; Vulnerable → none; ignored → none; reopened → none; KEV via `RECOMPUTE_STATUS` → INSTANT; SMTP off → nothing marked). Two parallel transactions → one INSTANT. Digest: grouping, nothing new → no row, second run → no row, held-back finding included. Failure hook and reaper path clear `notified_at`. Housekeeping deletes rows older than 30 days by id.

Web (Vitest):
- Unit: `notification-tokens.ts` (round trip, wrong purpose, tampered, expired, other secret, malformed, length), masking, Zod schemas.
- DB (`*.db.test.ts`): each route function. Cross-user: B never reads or changes A's pref, rows or test mail. A's confirm and unsubscribe tokens change only A, and a token made for A cannot be used for B. Rate limits (10 min, 5 min, two parallel calls → one). 409 when `smtp_configured` is false, with nothing written. OFF cancels queued rows. Confirm baseline. A used nonce is refused. Resend kills the older link. Ignore sets `notified_at`. One-click accepts only the form body and reads no cookie. GET link changes nothing.

E2E (`npm run e2e`, no internet):
- `web/e2e/support/mail-sink.mjs`: about 80 lines of `node:net`. It answers EHLO/MAIL/RCPT/DATA/QUIT, keeps mail in memory and serves `GET /messages?to=` and `DELETE /messages` on a second loopback port for the specs. No STARTTLS, so the e2e worker runs with `SMTP_TLS=off`. This covers the real lettre SMTP path except TLS. Global setup fails if any `SMTP_HOST` other than `127.0.0.1` is set (NE-1).
- The main run (sink on): NE-2, NE-3 (the 07:00 digest is started by inserting `SEND_DIGEST` with SQL, as the e2e already does for jobs), NE-5, NE-6, NE-7.
- NE-4 needs a worker without SMTP, and only one worker may run per database. So `npm run e2e` runs a second, short Playwright pass with `E2E_SMTP=off E2E_SKIP_BUILD=1` and `--grep @no-smtp`. Global setup leaves out the `SMTP_*` variables in that pass, and the main pass skips `@no-smtp`.

## 13. PR split

Wave 0, contract freeze (backend, one PR, reviewed by frontend and architect). Blocks everything else.
- **PR-N1 schema + contracts**: section 2 schema and migration `0002`, `enums.ts` / `jobs.ts` / `api.ts` (types and Zod from section 7.1), `errors.ts` codes, `lib/jobs.ts` defaults, `contract.rs` enums and payloads, contract fixtures, both sync tests green, drift check green.

Then in parallel:

| Backend | Frontend | E2E |
|---|---|---|
| **PR-N2** worker SMTP config, `mailer.rs`, lettre dependency, heartbeat flag, compose/.env/README (NB-1, NB-4) | **PR-F1** Settings tab + route shell; Pill icon slot; Banner critical (NF-1) | **PR-E1** mail sink + harness + second pass (NE-1), after PR-N2 |
| **PR-N3** `mail_text.rs` builder (NB-3) | **PR-F2** the three cards on fixtures (NF-2 to NF-4), wired to RTK Query after PR-N6 | |
| **PR-N4** `SEND_EMAIL`, mail lane, failure hook (NB-5) | **PR-F3** confirm and unsubscribe pages on fixtures (NF-5), wired after PR-N7 | |
| **PR-N5** `notify.rs` trigger in check/recompute + ignore marks `notified_at` (NB-6) | NF-6 (C) mobile pass | |
| **PR-N6** token module + `GET /api/notifications`, `PUT …/email`, `POST …/test` (NB-9, NB-12) | | |
| **PR-N7** confirm, unsubscribe, one-click, link routes, proxy, baseline (NB-8, NB-10, NB-11) | | |
| **PR-N8** `SEND_DIGEST`, scheduler, housekeeping (NB-7, NB-13) | | **PR-E2** NE-2 to NE-7 specs, after N4 to N8 and F2/F3 |

Then the security review (NB-14) of PR-N2, N4, N6 and N7 before merge. Each route PR adds a response fixture that matches `features/notifications/fixtures.ts` (V1 section 6.2).

## 14. Deviations from the backlog, and open points

Deviations (also to be noted in plan section 9 when this merges):
1. Extra columns `confirm_nonce`, `unsubscribe_token`, `link_token`, `finding.notification_id`, `worker_status.smtp_configured`. No `notification.job_id`.
2. A third worker lane `mail` and worker pool size 6 (amends ADR 0001's two lanes; recorded in ADR 0007).
3. The worker gets `APP_URL`, mapped in compose from `BETTER_AUTH_URL`. There is no new setting for the user.
4. The one-click unsubscribe route takes a form body and skips the Origin check (RFC 8058). All other routes keep the V1 rules.
5. `GET /api/notifications/link` serves the masked address to the landing pages (design open point).
6. Confirm answers 409 when SMTP is not set up (design section 3), not success.
7. Ignoring a finding marks it as notified. That is what makes "reopen does not mail again" hold.
8. Two new `ApiErrorCode` values: `CONFLICT` (409) and `INVALID_LINK` (400).

Open points, decided in PR-N1:
- The time zone is shown. The worker writes `worker_status.time_zone` (its `TZ`) with the heartbeat (PR-N2). `NotificationSettings` has `digestHour` (7, from `DIGEST_HOUR`; `contracts/notifications.json` keeps web and worker equal) and `timeZone` (null until the worker has run). Settings reads "7 am (server time, Europe/Amsterdam)".
- The confirm baseline marks every existing finding of every level (section 6.4), as written. A Low finding that KEV later makes Critical is not mailed.

## 15. Deviations made while building PR-N2 to PR-N8 (backend)

Nothing here changes a contract in sections 3 and 7.

Worker:
1. `Mailer` is a small struct (private `Transport` enum `{ Smtp, Stub }`, the `From` mailbox and the send limit), not a bare enum. `Mailer::stub(from, transport)` is for tests and `Mailer::smtp_with_limit` lets a test prove the outer timeout in 400 ms instead of 20 s. The outer `tokio::time::timeout` wraps the whole send, as in 4.4.
2. `SmtpSettings` (in `mailer.rs`) also holds the validated `app_url`; there is no separate `Config.app_url`. `Config` gets `smtp: Result<SmtpSettings, SmtpOff>` and `time_zone` (from `TZ`, default `UTC`). `SmtpOff` is a message newtype; "SMTP_HOST is not set" logs at info, every other reason at warn.
3. `heartbeat::beat` and `heartbeat::run` take `smtp_on: bool` (true when a mailer was built) and write `smtp_configured` and `time_zone`.
4. `notify.rs` also exports `user_candidates` (digest) and `DIGEST_PRIORITY`. `queue_instant` returns `Option<notification id>`.
5. `SEND_EMAIL` checks that `job.user_id` equals the notification's user and fails with `BAD_PAYLOAD` otherwise (V1 lesson). The mail's unsubscribe token is read from the pref row in the same query as the address.
6. The digest task (`scheduler::run_digest`) and its catch-up at start run only when a mailer exists at start. Turning SMTP on needs a worker restart, which compose does anyway when the environment changes.
7. lettre sends a body as quoted-printable when a line is longer than 76 characters, which the long token links always are. Mail programs decode it; the tests decode it too. The mail text itself is unchanged.
8. The loopback SMTP sink is `worker/tests/common/smtp_sink.rs` (next to the other test helpers); the mail tests are `worker/tests/mail.rs`. Unit tests for `mail_text`, `mailer` settings and the stub transport sit in their modules.
9. `worker/src/db.rs` lists `notification` and `notification_pref` as required tables, so a worker that starts before the web migrations fails with the usual plain message.

Web:
10. The 10-minute (confirm) and 5-minute (test) limits take `SELECT … FOR UPDATE` on the pref row inside the transaction and then check the time, instead of a guarded `UPDATE … WHERE`. The effect is the same and two parallel calls give one success (tested). Because the confirm limit is on the pref row, switching OFF and ON again inside 10 minutes also answers 429.
11. A genuine but expired confirm link is accepted as "already on" when the person is already ON (a late second click). Every other failure is `INVALID_LINK`.
12. `GET /api/notifications/link`: an unknown `purpose` is `VALIDATION_FAILED`; a bad or missing token is `INVALID_LINK` with that purpose's text.
13. Token route helpers are in `src/server/notification-http.ts` (`parseTokenBody`, `readOneClickRequest`); the one-click body is read with the existing `readBodyCapped` (1 KB). `http.ts` only gained `withSameSite` (the Origin rule for routes without a session).
14. `src/test/db-client.ts` lists the two new tables in `resetTables`.
