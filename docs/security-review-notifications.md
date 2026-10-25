# Security review: email notifications

Review of branch `feature/email-notifications`. Each finding with its status and fix.

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | Medium | Confirm-mail bombing through open sign-up | Fixed |
| 2 | Medium | `parseJsonBody` read the whole body, no depth limit | Fixed |
| 3 | Low | Unsubscribe token never changed | Fixed |
| 4 | Low | Failed-mail hook did not check the mail's owner | Fixed |
| 5 | Low | Bidi and zero-width characters in mail text | Fixed |
| 6 | Low | SMTP login allowed without TLS to any host | Fixed |
| 7 | Info | Proxy matcher skipped all `/notifications*` paths; tokens in access logs | Fixed (narrowed, documented) |

## 1. Confirm-mail bombing (Medium)

With `ALLOW_SIGNUP=true` and SMTP set up, a stranger could create accounts with any address and
make HomeGuard mail it, or burn the SMTP account's reputation.

Fix (`web/src/server/notifications.ts`, migration `0003_notification_hardening`):
- Per account: `notification_pref.confirm_send_count`; at most 3 confirm mails (`CONFIRM_MAILS_PER_ACCOUNT`).
  Turning alerts off and on again resets the count.
- Per address: new table `confirm_send` (lower-case address + time, kept 2 days). At most 3 per
  address per 24 hours (`CONFIRM_MAILS_PER_ADDRESS_PER_DAY`). It survives deleting and re-creating an account.
- Whole instance: at most 20 per hour (`CONFIRM_MAILS_PER_HOUR`), counted in the same table.
  Counts and the insert run under `pg_advisory_xact_lock`, so parallel requests cannot overshoot.
- The existing 10-minute gap between mails stays.
- README and `.env.example` now say to set `ALLOW_SIGNUP=false` after setup.

The settings shape is unchanged (`confirmResendAt` countdown works as before). When a cap is hit the
API answers 429 `RATE_LIMITED` with a plain message ("... Turn email alerts off and on again to start
over." or "... Try again later."). The pending card has no off switch visible, so a UI copy/flow check
is advisable (see hand-off in the task report).

Tests: `notifications.db.test.ts`, "confirm mail limits".

## 2. Unbounded JSON body (Medium)

`parseJsonBody` called `req.json()`, so an unauthenticated caller of `/api/notifications/confirm` or
`/unsubscribe` could send a huge or deeply nested body.

Fix (`web/src/server/http.ts`): the body is read with `readBodyCapped` (default 8 KB, `maxBytes` per
call; 413 `PAYLOAD_TOO_LARGE`, also when Content-Length is missing or lies). Parsed JSON deeper than
8 levels is refused (iterative check, no recursion). The token routes pass 1 KB.

Tests: `http.test.ts`, "JSON body limits" (oversized body with and without Content-Length, custom limit, deep nesting).

## 3. Unsubscribe token never rotated (Low)

One token for the life of the account meant a leaked old mail could switch alerts off forever.

Fix: `notification_pref.unsubscribe_nonce` is a random value inside the signed token. A new nonce and
token are written on turn-on and on confirm. The unsubscribe route and the landing page accept a link
only when its nonce matches the stored one while alerts are not OFF, so the newest link works for the
whole current "on" period (one-click and page) and older links stop. When alerts are already OFF any
genuine link answers "off", which changes nothing. The worker still just copies `unsubscribe_token`
into mails, so it needed no change. Existing rows have a null nonce and their tokens keep working until
the next turn-on. Opening the confirm link rotates the token, so the unsubscribe link inside the
confirm mail itself stops working after confirmation.

Tests: `notifications.db.test.ts`, "unsubscribe link rotation".

## 4. Failure hook ownership (Low)

`worker/src/hooks.rs` marked the notification named in the job payload as failed without checking its
owner. It now requires `notification.user_id` to equal the job's `user_id`.
Test: `tests/mail.rs`, `the_failure_hook_ignores_a_notification_of_another_user`.

## 5. Format characters in mail text (Low)

`plain()` in `worker/src/mail_text.rs` only replaced control characters, so device names could carry
bidi overrides or zero-width characters into a mail. It now drops Unicode format characters (category
Cf: soft hyphen, zero-width, bidi marks and overrides, isolates, BOM, tags). Tests in `mail_text.rs`.

## 6. SMTP login without TLS (Low)

`SMTP_TLS=off` with `SMTP_USER`/`SMTP_PASSWORD` sent the password in clear text to any host. The
worker now keeps email off (with a log line naming the variables) unless `SMTP_HOST` is a loopback,
private or link-local IP address. Host names do not count. Tests in `mailer.rs`.

## 7. Proxy matcher and access logs (Info)

`web/src/proxy.ts` skipped the sign-in redirect for every path starting with `notifications`. The
matcher now skips only `notifications/confirm` and `notifications/unsubscribe`. The README notes that a
reverse proxy's access log will contain the tokens in those URLs.

## Not verified here

Real SMTP servers, a reverse proxy in front, and the browser flow of the capped pending state.
