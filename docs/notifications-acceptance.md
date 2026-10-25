# E-mail notifications: acceptance review (V1.1, Phase 11)

Branch: `feature/email-notifications` (head 67b739e). Reviewed 2026-10-25 by the product-owner.
Stories: `docs/backlog-notifications.md`. Design: `docs/design/notifications.md`. Security: `docs/security-review-notifications.md`. Architecture: `docs/architecture-notifications.md`, ADR 0007.

**Method and limits.** Read-only review: the stories were compared with the code, the tests and the docs by reading them. "Met" means the code matches the story, not that it ran. This review did not run `cargo test`, `npm test`, `npm run e2e`, the migration drift check, a browser, or a compose stack. Those are the gates in the Definition of done, and they must be run before merge (see "Before merge").

## Verdict

**Not yet. Ready to merge into main as V1.1 after two small fixes and a green local run of the gates.** The feature is close: the worker mail path, the token and confirm design, the rate limits, the wording and the e2e coverage all match the stories. Two gaps are real and small (Missing 1 and 2). Release (tagging V1.1) waits for the manual checklist and the user's answers to Questions 1 to 3.

## Meets

Backend (worker, Rust):
- NB-1 Mail settings: `SmtpSettings::from_lookup` names the bad variable and turns mail off without stopping the worker. `SMTP_PASSWORD` is redacted in `Debug` (test). `SMTP_TLS=off` logs a warning (`main.rs`). Only the `worker` service gets `SMTP_*` (`docker-compose.yml`). Every variable is commented in `.env.example`.
- NB-4 Sender: `send_email::run` returns `SMTP_NOT_CONFIGURED` before any connection when mail is off. Sends have a 20 s outer timeout (`mailer.rs`, test `a_silent_server_is_cut_off_at_the_time_limit`). Stub transport in tests. Logs carry user id and kind, not the body, address or token.
- NB-5 `SEND_EMAIL`: only QUEUED rows are sent, a second run changes nothing, a cancelled mail is marked CANCELLED when alerts went off, a deleted person ends without sending, and a payload that points at another person's row is refused (`BadPayload`).
- NB-6 Right away: `queue_instant` runs in the same transaction as the finding update, marks `notified_at` and `notification_id`, and takes the hourly slot under the pref row lock. Covered by DB tests: one mail, a second device inside the hour waits for the digest, Vulnerable and ignored findings are not mailed, a KEV import is mailed after the recompute, and two parallel checks queue one mail.
- NB-7 Daily summary: one `SEND_DIGEST` per day (cron `0 7 * * *` plus catch-up after 07:00), gated per person by `last_digest_at` on local midnight, no mail when nothing is new, held-back findings are included.
- N-D12: a mail that fails for good clears `notified_at` (`hooks.rs`, owner-checked, test).
- N-D17: backoff 1 min then 5 min, three attempts; `SMTP_NOT_CONFIGURED` is not retried (`queue.rs`, `contract.rs`).
- NB-9 to NB-12 (web, `src/server/notifications.ts`): state API with cross-user checks; confirm needs POST, Origin check and a nonce; GET on the link route reads only; unsubscribe is POST only, with one-click RFC 8058 on its own route; test mail returns 202 and checks the 5-minute limit; tokens are HMAC-SHA256 with an HKDF key from `BETTER_AUTH_SECRET` and the purpose in the signed data (`notification-tokens.ts`). Error codes match the story: 400 invalid link, 409 not set up or not ON, 429 rate limit, 413 body too large.
- Security fixes (`docs/security-review-notifications.md`, items 1 to 7): spot-checked in code. Confirm caps, capped body and depth, nonce rotation, failure-hook owner check, format characters removed from mail text, `SMTP_TLS=off` with a login refused unless the host is a private or loopback IP, and the proxy skips only the two landing paths. All are marked Fixed. Nothing open in the review.
- NB-3 Mail text: a pure builder with fixtures and tests. Footer on every kind, banned phrases absent (tests), subject at most 120 characters with no line breaks, device names with control characters or bidi marks cleaned, digest capped at 20 devices and 5 problems per device.
- NB-2 Schema: migrations `0002_email_notifications` and `0003_notification_hardening`, with the enum values and the contract tests on both sides.
- NB-13 (C) housekeeping: a test exists (`housekeeping_deletes_old_finished_notifications_by_id_and_keeps_notified_at`).

Frontend:
- NF-1 Settings tab "Notifications" after Account and Checks (`settings/layout.tsx`). The sidebar has no Notifications item.
- NF-2 Card: the states Not set up, Off, Waiting for you (with resend countdown and turn-off button), On, and Can't send (switch kept on so it can be turned off) are derived from data (`display.ts`). The switch does not flip until the server answers. "On" uses the brand colour, not the safe green. Icon and text on every state.
- NF-3 "What we email you": information only, with no controls. States what is not emailed.
- NF-4 Test button: disabled reasons are text (`testBlockedReason`). Last-email line handles never, sent and failed. Rate-limit text comes from the API.
- NF-5 Landing pages: `/notifications/confirm` and `/notifications/unsubscribe` sit outside the app shell, need no session (proxy matcher), show the masked address, and only the button changes state. Copy matches the spec.
- NU-1 Spec and copy: `docs/design/notifications.md` is written and the mail wording matches section 5 of it. Rows 27 to 33 exist in `docs/design/v1-changes.md`.
- NE-1 to NE-7 (Playwright): specs exist for the happy path with confirm, the right-away mail, the no-spam rescan, the no-SMTP state, unsubscribe, one-click, cross-user isolation, the honesty check on the mail body (`notifications.spec.ts` line 59 to 64), the test button, and a `@no-smtp` spec. Not run here.

Definition of done:
- No test contacts a real mail server (`mail sink` in `web/e2e/support/mail.ts`, stub transport in worker tests).
- GET never changes state on the confirm, unsubscribe or link routes.
- SMTP secrets are not in logs, the API or the UI.
- Docs: `.env.example`, `docker-compose.yml`, README "Email alerts" section, `docs/design/v1-changes.md` rows, ADR 0007.

## Missing

Blocking before merge:
1. **NF-2: the Off state has no address line.** The story says "Off" shows "your address" (`NotificationsScreen`/`EmailAlertsCard.tsx`, `stateLine` for "off" has no address). Owner: frontend-engineer. Fix: add "Your address: <email>" under the Off line. Add an assertion to `EmailAlertsCard.test.tsx` ("shows Off with the address").
2. **NB-8: the baseline on confirm marks every finding, not only open ones.** `confirmInTransaction` (`notifications.ts`) runs `finding.updateMany` with `where: { device: { userId }, notifiedAt: null }` and no state filter. The story says every OPEN finding. The effect is that a Critical finding that was closed before confirm and reappears later is never mailed. Owner: backend-engineer. Fix: add `state: "OPEN"` to the where clause. Add a DB test: a RESOLVED finding stays un-notified at confirm and is mailed when it returns as OPEN at Critical. The existing test "turns alerts on and marks every existing finding as already told" should still pass.

Not blocking (fix in the next PR or record as accepted):
3. **NB-9:** the PUT response does not carry the sentence "We sent a link to <address>. Open it to turn on alerts." The UI writes it instead (`useNotificationActions.ts`). Accepted: the UI shows it. Amend the story wording.
4. **N-D21:** the 429 texts are JSON errors, not "plain text". Accepted: the text is plain. Amend the story wording.
5. **NB-3:** the story says "and N more on the HomeGuard page" for more than 20 devices. The code says "and N more devices: <link>" (the later design, `docs/design/notifications.md` 5.3). Accepted, per N-D23. Amend the story.
6. **NB-7:** the scheduler's 07:00 trigger has only a cron-string unit test and a catch-up unit test. Nothing in the DB tests proves the cron run queues `SEND_DIGEST` once. Covered by the e2e "daily summary is silent" test only for the empty case. Add a worker test that calls the digest queue function twice. Low priority.
7. **`readOneClickRequest`** uses the error code `UNSUPPORTED_FILE` (415) for a non-form body. Wrong name, same status. Rename to a neutral code in a later PR (backend).
8. **NF-1 (mobile tabs at under 800 px, 44 px targets), NF-6 (C) phone layout:** not verified in a browser. Add to the manual checklist.
9. **Honesty check covers fixtures only.** The banned-phrase tests use fixtures, and the e2e honesty check reads the captured mails. A device name or an NVD sentence containing "safe" (for example "safe mode") would still appear. This is not a safety claim, so it is not blocking. Note it in the wording review.

Gates not run in this review (must pass before merge): `cargo test` and `cargo clippy --all-targets -- -D warnings` with `REQUIRE_DB_TESTS=1`; `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` in `web/`; the migration drift check; `npm run e2e`.

## Wording check

Method: grep of `web/src/features/notifications`, `web/src/app/(public)/notifications`, `worker/src/mail_text.rs`, the e2e specs, and the mail tests.

- "safe" appears only in the required line "No email does not mean a device is safe." It appears in: every mail footer (`mail_text.rs` `footer`), the "What we email you" card, the confirm success body and the e2e honesty check. The UX spec said the success state must not use the word "safe", which contradicted the footer rule. Resolved in `docs/design/notifications.md` (section 3): no claim of safety, and the footer line is the only use.
- No "all clear", "all good", "good news" or "up to date" in any mail or page (grep; the mail tests and the e2e check assert it).
- "Not tracked" devices and "Update available" or "Low" findings are never mailed (`notify.rs` filters Critical and Vulnerable; `notified_at` set only for those).
- "Turn on alerts" / "On" never implies things are fine: the copy is "On. Sent to <address>." and "Email alerts are on." Only the sending state is described.
- The landing page for unsubscribe says "Your devices are still checked every day." This is true (nightly rescan) and does not claim safety.
- "No known vulnerabilities" is not used in mail or in the new pages.

## Documents changed on merge

Done in this review (text only):
- `docs/implementation-plan.md`: section 1 (e-mail moved to V1.1, push and the rest still out); section 9 (Notifications row now says e-mail is in V1.1); section 10 (new "Phase 11: Email notifications (V1.1)" with its done-when); section 12 (`TZ` also covers the daily summary; `APP_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`/`SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TLS` rows); section 13 (decision text updated).
- `docs/backlog.md`: the Later list (push, weekly report, quiet hours, per-device alerts, frequency choices; e-mail in V1.1); D3 marked superseded for e-mail only.
- `docs/backlog-notifications.md`: status line; Decisions N-D23 to N-D25 (daily summary wording, "Turn off email alerts" label, extra confirm caps).
- `docs/design/notifications.md`: the "Cancel" button is now "Turn off email alerts" (matches the code); the "safe" rule in section 3 is resolved.

Already in place, checked: `README.md` "Email alerts (optional)" section; `.env.example` (all `SMTP_*` and `TZ`, with comments); `docker-compose.yml` (SMTP only in the `worker` block); `docs/design/v1-changes.md` rows 27 to 33; ADR 0007.

Still to do on merge:
- Add the V1.1 release note line to `docs/v1-acceptance.md` after the release (not a V1 change; a new line).
- When the NF-2 and NB-8 fixes land, tick them in this file.

## Questions for the user

Q1 (open, from the backlog). **Release timing:** does e-mail ship as V1.1, a follow-up right after V1? Recommendation: yes, V1.1.

Q2 (open, from the backlog). **Night-time alerts:** no quiet hours in V1, so a right-away Critical mail can arrive at night, at most one per person per hour. Recommendation: yes. If you want nothing at night, hold right-away mail until 07:00 (a new story).

Q3 (new). **Extra limits on confirm mail:** the security fix added three limits not in the backlog. At most 3 confirm mails per account until alerts are turned off and on again, at most 3 per address per 24 hours, and at most 20 across the whole instance per hour. Effect: someone who asks for a fourth link to the same address in a day is told "Try again later" with no countdown. Recommendation: keep them (open sign-up plus SMTP can otherwise mail any address).

Q4 (new). **Daily summary time:** the card says "7 am (server time, UTC)" until `TZ` is set. Recommendation: keep the zone in the text, so a household that has not set `TZ` can see it is wrong.

## Manual pre-release checklist

The sandbox cannot run these. Each one needs a person on a real install.

- [ ] Compose install with the real `.env` SMTP values from a real provider with TLS (STARTTLS on 587 and TLS on 465). Send a test mail; it arrives in the inbox, not spam, and the subject and body read correctly.
- [ ] `SMTP_TLS=off` with a login to a private IP relay: start-up warning shown; with a login to a public host, e-mail is refused with a log line naming the variables.
- [ ] Daily summary fires at 07:00 local time with the compose `TZ` set to the household's zone (check the `Last email sent` time and the time in the card).
- [ ] `linux/arm64` worker image builds with lettre 0.11.23 (musl, rustls with ring) and starts; confirm a send from it.
- [ ] Idle worker memory stays inside the 512 MB budget with mail on (`docker stats`), and the number is noted in the README.
- [ ] Turn SMTP off after alerts were on: Settings shows "Can't send" with the banner, the test button shows its reason, nothing crashes, and queued mails fail honestly.
- [ ] Mail rendering in real clients (Gmail web, Outlook, Apple Mail): plain text, lines not broken badly, links clickable, the one-click unsubscribe button shown by clients that support it.
- [ ] Settings > Notifications at 390 px and 320 px: tabs scroll sideways, targets are 44 px, no horizontal scroll, the card stacks.
- [ ] Landing pages opened from a real mail: confirm once, then open the link again (the page says "Email alerts are on."); unsubscribe; an expired link shows the expired text.
- [ ] A reverse proxy in front of HomeGuard: the access log holds the tokens (documented in README); `BETTER_AUTH_URL` is set to the public address so the links in mail work.
