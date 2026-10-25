# Backlog: E-mail notifications

Owner: product-owner. Branch: `feature/email-notifications`. Status: built on the branch; acceptance review in `docs/notifications-acceptance.md` (verdict there). Not yet merged.
Inputs: `CLAUDE.md`, `docs/backlog.md` (Later list, D1 to D24), `docs/architecture-v1.md` (sections 2 to 4, 6, 7), `docs/implementation-plan.md` (sections 1, 9, 12), `docs/design/homeguard/screens/06-settings-notifications.png`, `docs/design/v1-changes.md`.

Scope change: the user has moved **e-mail** notifications from "Later" into scope. Push, SMS, weekly report, quiet hours, per-device alerts and "who gets alerts" stay out (see N-D1). When this merges, plan section 1 ("Notifications (email, push)") and backlog D3 are updated for e-mail only. Nothing else in the V1 DoD changes.

Priority: **M** = must have for this feature. **C** = could have, cut first.
Phase: all stories are **Phase 11 (Email notifications)**. Track is in brackets: `[B]` backend, `[F]` frontend, `[U]` UX, `[E]` e2e.

---

## Decisions

Taken by the product owner under the user's delegation. Each has a one-line why. The two items in "Questions for the user" at the end are the only ones that still need the user.

| ID | Question | Decision | Why |
|----|----------|----------|-----|
| N-D1 | Which channels and features? | E-mail only. Out for now: push, SMS, weekly report, quiet hours, per-device alerts, a list of recipients per device, per-level frequency choices. | The user asked for e-mail; the rest needs more settings and more UI than a home user needs. |
| N-D2 | Does this override D3 and plan section 1? | For e-mail only. D3 stays for push and the per-device switch. | The user moved e-mail into scope; the rest is still a non-goal. |
| N-D3 | Who configures the mail server? | The host, once, in `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TLS`. Only the `worker` service gets these variables. | One sender for the whole home; no mail passwords in the database or the UI (same rule as D12); per-service secrets. |
| N-D4 | What if SMTP is missing or wrong? | E-mail stays off. The app runs. The worker logs one plain line that names the variable. Settings shows "Email alerts aren't set up on this HomeGuard yet." and the switch is disabled. Nothing is queued. | The app must work without mail; a missing setting must not look like working alerts. |
| N-D5 | TLS? | TLS is required by default (STARTTLS or implicit TLS, picked by port). `SMTP_TLS=off` is allowed only when set on purpose, and the worker logs a warning at start. | Passwords must not travel in plain text by accident; a home LAN relay still works when someone chooses it. |
| N-D6 | Which address gets the mail? | The address on the person's account. No second address field in V1. | Fewer fields, one source of truth. Account e-mail change is not in V1, so there is nothing to sync. |
| N-D7 | Opt-in? | Off by default, per person. Turning it on sends a confirmation link to the account address; the link works for 48 hours and alerts start only after the link is opened and the button pressed. | Nobody gets mail they did not ask for. Stops someone who signs up with another person's address from subscribing them. |
| N-D8 | Existing problems when alerts are turned on? | Not mailed. When the link is confirmed, every open finding the person already has is marked as already notified. | Otherwise turning on alerts mails the whole backlog at once. |
| N-D9 | What is sent? | (a) **Right away**: a new open finding at Critical (this includes known exploited). (b) **Daily summary**: new open findings at Critical or Vulnerable. Never for "Update available", "Low", "Not tracked", or ignored findings. | Only things a person can act on; keeps mail rare. |
| N-D10 | When is the daily summary? | 07:00 in the worker's time zone (`TZ`). Fixed in V1. Sent only if there is something new. No "all clear" mail. | Silence is not a claim, and an empty mail teaches people to ignore mail. A fixed hour is one less setting. |
| N-D11 | How do we avoid spam? | A finding is mailed once, ever. Reopening an ignored finding does not mail it again. A repeated check does not mail the same finding again. At most one "right away" mail per person per hour; anything held back goes into the next daily summary. | One rescan or "Check again" must never produce a burst. |
| N-D12 | How do we avoid duplicates under concurrent checks? | `finding.notified_at` is set when the mail is queued, in the same transaction. If the mail finally fails, it is cleared so the next daily summary picks the finding up. | Two checks at once cannot queue two mails; a failed send is not lost. |
| N-D13 | Quiet hours? | None in V1. "Right away" mails can arrive at night, at most one per hour. | Quiet hours is a Later item; the hourly cap is the spam control. Flagged to the user (Question 2). |
| N-D14 | Unsubscribe? | Every mail has a footer link and the `List-Unsubscribe` header with one-click POST. The link opens a page with a button; the button turns alerts off. The token is signed, needs no sign-in, and does not expire. Turning off cancels queued mails. | Standard for mail; a home user must be able to stop mail without signing in. |
| N-D15 | Test mail? | A "Send a test email" button, only when alerts are on, to the person's own address, at most once every 5 minutes. | Proves the route works; the limit stops the button being used to spam. |
| N-D16 | Mail wording? | Plain text only in V1. Same words as the UI ("needs fixing now", "Update to 3.1.2 to fix this"). Never "safe" as a claim, never "good news", "all clear", "all good" or "up to date". Every mail ends with: "We only email about new problems. No email does not mean a device is safe." Device names are plain text, with control characters removed from subjects. | Honesty rules apply to mail too. |
| N-D17 | Failed sends? | Same as jobs: 3 attempts, waits of 1 and 5 minutes (D18). After that the row is FAILED. Settings says "Last email couldn't be sent. We'll try again with the next daily summary." | Gentle on the mail server; the user sees it and nothing is lost. |
| N-D18 | Secrets and personal data in logs and API? | The SMTP password, tokens and e-mail addresses never appear in logs, API responses or the UI text beyond the person's own address on their own page. Logs carry `job_id` and user id only. | No secrets in the UI (D12); logs get shared when people ask for help. |
| N-D19 | How long are notification rows kept? | 30 days, deleted during `RESCAN_ALL` housekeeping. | Same as finished jobs (architecture section 2, Retention). |
| N-D20 | Who sends? | The worker, always. The web app only inserts rows and jobs (`SEND_EMAIL`, `SEND_DIGEST`) through `enqueueJob`. Confirm and test mails are queued by the web app; alerts and summaries are queued by the worker. | CLAUDE.md: slow work and outside calls live in the worker. |
| N-D21 | Rate limits on the web side? | Turning alerts on: one confirmation mail per person per 10 minutes. Test mail: once per 5 minutes. Over the limit: 429 with plain text. | Stops a signed-in user, or someone holding a copied session, from filling a mailbox. |
| N-D22 | Mail library? | Architect's choice, recorded in a new ADR. Must support rustls, timeouts, and a stub transport for tests. | Architect owns the technical choice. |
| N-D23 | Wording of the daily summary time and the "too many devices" line (NB-3, NF-3)? | Keep the built wording: "Daily summary, 7 am (server time, UTC)" and "and N more devices: <link>" (as in `docs/design/notifications.md` 5.3). | The later UX spec already says this; the zone shows where 7 am is measured. |
| N-D24 | Label of the button that cancels a pending link (NF-2)? | "Turn off email alerts" instead of "Cancel" (`docs/design/notifications.md` updated). | Says what the button does; a person who wants out should see the word "off". |
| N-D25 | Extra limits on confirm mail added by the security fix (3 per account until off and on again, 3 per address per 24 h, 20 per instance per hour)? | Keep. They are stricter than N-D21 and reset nothing that matters to a real person. | Open sign-up plus SMTP means a stranger can make HomeGuard mail any address. Question 3 asks the user to confirm. |

---

## Phase 11: Email notifications

### Backend [B]

**NB-1 (M) Mail settings and start-up check.** As the person who runs HomeGuard, I want to set the mail server once in `.env`, so that alerts work without a settings screen.
- Given `SMTP_HOST` is missing, when the worker starts, then it logs "Email alerts are off: SMTP_HOST is not set." and keeps running.
- Given `SMTP_HOST` is set but `SMTP_FROM` or a port is missing or invalid, when the worker starts, then it logs one plain line naming the bad variable, sets e-mail off, and keeps running.
- Given `SMTP_TLS=off`, when the worker starts, then it logs a warning that the mail is not encrypted.
- Given a valid setup, when the worker starts, then `worker_status.smtp_configured` is true.
- Given the worker runs with any setup, then `SMTP_PASSWORD` never appears in any log line or in `Debug` output (test).
- Given `.env.example` and `docker-compose.yml`, then every `SMTP_*` variable has a short comment and is passed to the `worker` service only, not to `web`.

**NB-2 (M) Schema migration.** As the team, we want the notification data in Prisma, so that web and worker share one schema.
- Given the migration, when I run `prisma migrate deploy` on an empty database, then it succeeds; the drift check in CI passes.
- Given the new enums, then `SEND_EMAIL` and `SEND_DIGEST` are in `JobType`, and `SMTP_FAILED` and `SMTP_NOT_CONFIGURED` are in `JobErrorCode`. The contract sync tests on both sides cover them.
- Given the schema, then it has: `finding.notified_at` (nullable); table `notification_pref` (one row per user: `email_state` OFF / PENDING_CONFIRM / ON, `confirmed_at`, `last_instant_at`, `last_digest_at`, `last_test_at`, `last_confirm_sent_at`); table `notification` (`id`, `user_id`, `kind` CONFIRM / TEST / INSTANT / DIGEST, `status` QUEUED / SENT / FAILED / CANCELLED, `item_count`, `created_at`, `sent_at`, `error_code`). The architect confirms names and the enum `ALTER` statements.
- Given the worker code, then it contains no `CREATE`, `ALTER` or migration statements (existing CI guard).

**NB-3 (M) Mail text builder.** As a home user, I want the mails to say what to do in plain words, so that I can act without reading a report.
- Given a device and its open findings, when the builder runs for INSTANT, DIGEST, CONFIRM or TEST, then it returns a subject and a plain-text body built from fixtures.
- Given any built mail, then the text contains none of: "safe" (except inside "does not mean a device is safe"), "all clear", "all good", "good news", "up to date".
- Given any built mail, then it ends with the footer from N-D16 and the unsubscribe link.
- Given a device name with line breaks or control characters, then the subject has none of them and is at most 120 characters.
- Given a DIGEST with more than 20 devices, then it lists the worst 20 and says "and N more on the HomeGuard page".
- Given the builder, then it is a pure function with Rust unit tests on fixtures (no network, no database).

**NB-4 (M) SMTP sender.** As the team, we want sending to be isolated, so that it can be tested without a mail server.
- Given e-mail is off (NB-1), when the sender is called, then it returns `SMTP_NOT_CONFIGURED` without opening a connection.
- Given the server answers 4xx or 5xx, or does not answer within 20 seconds, then it returns `SMTP_FAILED` and the job retries (N-D17).
- Given the tests, then they use a stub transport and never open a real SMTP connection.
- Given the sender logs, then it logs the job id, the mail kind and the result, never the body or the address.

**NB-5 (M) `SEND_EMAIL` job.** As a home user, I want each mail sent once and only while I still want it, so that turning alerts off really stops them.
- Given a `notification` row is QUEUED and the person's `email_state` is ON (or PENDING_CONFIRM for CONFIRM mails), when the job runs, then the mail is sent and the row becomes SENT with `sent_at`.
- Given the person turned alerts off after the row was queued, when the job runs, then the row becomes CANCELLED and nothing is sent.
- Given the job runs twice, then the second run does nothing (row already SENT).
- Given the send fails for good (after 3 attempts), then the row is FAILED with the error code, and for INSTANT and DIGEST the related findings get `notified_at` cleared (N-D12).
- Given a job for a user who was deleted, then it finishes DONE and sends nothing.
- Given the test (NB-12), then the job runs with kind TEST and sends to the person's own address.

**NB-6 (M) "Right away" alerts from check results.** As a home user, I want a Critical problem mailed to me right away, so that I can act on it the same day.
- Given a check or a status recompute writes a new OPEN finding at Critical for a person whose alerts are ON and SMTP is configured, then one INSTANT row is queued and `finding.notified_at` is set, in the same transaction.
- Given a second check in the same hour finds another new Critical finding, then no second INSTANT row is queued; that finding keeps `notified_at` null and goes into the next DIGEST.
- Given a new finding at Vulnerable or lower, then no INSTANT row is queued.
- Given a Critical finding that is IGNORED, then nothing is queued.
- Given a finding that was mailed before and was reopened, then nothing is queued (N-D11).
- Given a Critical finding caused by KEV import (`IMPORT_KEV` then `RECOMPUTE_STATUS`), then it is mailed the same way.
- Given the test suite, then it covers each case with the database (`*.db.test.ts` or worker DB tests).

**NB-7 (M) Daily summary at 07:00.** As a home user, I want one summary a day with what is new, so that I hear about Vulnerable problems without a stream of mails.
- Given the scheduler reaches 07:00 in `TZ`, then `SEND_DIGEST` is queued once (unless one is already queued) and runs as a system job.
- Given a person has ON alerts and open Critical or Vulnerable findings with `notified_at` null, then one DIGEST row is queued, grouped by device (worst first), and those findings get `notified_at`.
- Given nothing is new for a person, then no DIGEST row is created and no mail is sent (no "all clear" mail).
- Given the job runs twice on the same day, then the second run skips people whose `last_digest_at` is today.
- Given an INSTANT alert was held back by the hourly cap (NB-6), then its finding is in the next DIGEST.

**NB-8 (M) Baseline on confirm.** As a home user, I want turning alerts on to be quiet at first, so that I do not get the old backlog as mail.
- Given a person confirms alerts (NB-10), then every OPEN finding they already have gets `notified_at = now()` in the same transaction, and no mail is sent for them.
- Given a Critical finding appears after confirmation, then it is mailed under NB-6.
- Given the test, then both cases are covered.

**NB-9 (M) Alerts state API.** As a home user, I want to see whether alerts are on and turn them on or off, so that I control my mail.
- Given a signed-in person, when they call `GET /api/notifications`, then they get `{ state, email (their own address), smtpConfigured, lastSentAt, lastError }` where `lastError` is a plain text code, never a stack trace or server text.
- Given `PUT /api/notifications/email` with `{ enabled: true }`, when SMTP is configured, then the state becomes PENDING_CONFIRM, a CONFIRM row is queued (N-D21 limit), and the response says "We sent a link to <address>. Open it to turn on alerts."
- Given `{ enabled: true }` and SMTP is not configured, then the response is an error with the text "Email alerts aren't set up on this HomeGuard yet." and nothing changes.
- Given `{ enabled: false }`, then the state becomes OFF and queued INSTANT and DIGEST rows are cancelled.
- Given the 10-minute limit is hit, then the response is 429 with "Wait a few minutes before asking for another link."
- Given person A and person B, when B calls the API, then B only ever reads and changes B's own state (cross-user test).
- Given the route, then it follows the handler shape in architecture section 3.1 (session, Zod, `src/server/`).

**NB-10 (M) Confirm link.** As a home user, I want the link in my mail to turn alerts on after I press a button, so that a mail scanner cannot turn them on for me.
- Given the confirmation mail, then its link opens `/notifications/confirm?token=...` (a page, see NF-5).
- Given `POST /api/notifications/confirm` with a valid, unexpired token (48 hours), then state becomes ON, `confirmed_at` is set, NB-8 runs, and the response is success. No sign-in is needed.
- Given a GET request to the confirm API, then nothing changes (link scanners cannot confirm).
- Given an expired, forged or malformed token, then the response is 400 with "This link has expired. Turn on alerts again in Settings > Notifications." (or the same text for forged tokens).
- Given a token, then it can only change the user it was made for (test).
- Given the token, then it is signed with a key derived from `BETTER_AUTH_SECRET` and its purpose is part of the signed data, so a token from another purpose is refused.

**NB-11 (M) Unsubscribe.** As a home user, I want to stop the mail from any mail, so that I never feel trapped.
- Given `POST /api/notifications/unsubscribe` with a valid token (no expiry), then state becomes OFF and queued rows are cancelled. No sign-in is needed.
- Given the `List-Unsubscribe` header and `List-Unsubscribe-Post` value on every mail, then the one-click POST reaches the same endpoint.
- Given an invalid token, then the response is 400 with plain text and nothing changes.
- Given a token, then it only affects the user it was made for (test).
- Given the page for unsubscribing (NF-5), then the button is the only way to change state from the footer link (GET changes nothing).

**NB-12 (M) Test mail.** As a home user, I want to send myself a test mail, so that I know the route works.
- Given a signed-in person with alerts ON and SMTP configured, when they call `POST /api/notifications/test`, then a TEST row is queued and the response is 202.
- Given alerts are not ON, then the response is 409 with "Turn on email alerts first."
- Given the last test was less than 5 minutes ago, then the response is 429 with "Wait a few minutes before sending another test email."
- Given the test mail, then it goes only to the person's own address (test).

**NB-13 (C) Housekeeping.** As the team, we want old notification rows removed, so that the table stays small.
- Given `RESCAN_ALL` runs, then `notification` rows older than 30 days are deleted by id (architecture section 2 rule).
- Given the test, then it runs against the database with a fixed clock.

**NB-14 (M) Security review input.** As the team, we want the new parts reviewed before merge, so that tokens and mail cannot be abused.
- Given this feature, then the security-researcher reviews: token signing and purposes, GET versus POST on confirm and unsubscribe, rate limits, header injection in subjects, SMTP secret handling, and per-user isolation of every notification route.
- Given a must-fix finding, then the owning engineer fixes it before merge.

### Frontend [F]

**NF-1 (M) Settings tabs and route.** As a home user, I want Notifications next to Account and Checks, so that I find it under Settings.
- Given I open Settings, then the tabs are Account, Checks and Notifications (not "Household & users", D1).
- Given I open `/settings/notifications`, then the Notifications tab is current.
- Given the sidebar, then it still has no Notifications item (D3 for push and per-device; e-mail lives under Settings).
- Given a width under 800 px, then the tabs scroll sideways inside their row and every tab is at least 44 px high.

**NF-2 (M) Email alerts card.** As a home user, I want one switch that says what it does, so that I can turn mail on or off.
- Given I am signed in and alerts are OFF, then the card shows the switch "Email me about new problems", my address, and "Off. Turn it on and we'll send a link to confirm."
- Given alerts are PENDING_CONFIRM, then the card shows "We sent a link to <address>. Open it to turn on alerts." and "Send the link again" is disabled for 10 minutes.
- Given alerts are ON, then the card shows "On. Sent to <address>."
- Given SMTP is not configured, then the switch is disabled and the card shows "Email alerts aren't set up on this HomeGuard yet. Ask the person who runs it."
- Given any state, then the switch has a text label (not color alone), and the state is read out to a screen reader.

**NF-3 (M) "What we email you" card.** As a home user, I want to know exactly what mail I get, so that I am not surprised.
- Given the card, then it says: "Right away: a new Critical problem on one of your devices." and "Daily summary, 7 am: new Critical and Vulnerable problems, when there are any."
- Given the card, then it says: "We only email about new problems. No email does not mean a device is safe."
- Given the card, then it does not mention push, weekly reports, quiet hours or per-device choices.

**NF-4 (M) Test mail and last-mail status.** As a home user, I want to test the mail and see the last result, so that I trust it works.
- Given alerts are ON, then "Send a test email" is enabled; when pressed it shows "Sent to <address>. Check your inbox."
- Given alerts are not ON or SMTP is not set up, then the button is disabled with the reason as text.
- Given the test is rate-limited (429), then the page shows the API text.
- Given the last mail was sent, then the card shows "Last email sent 2 hours ago." (relative time).
- Given the last mail failed, then the card shows an error icon and "Last email couldn't be sent. We'll try again with the next daily summary."

**NF-5 (M) Confirm and unsubscribe pages.** As a home user, I want the link in the mail to show a clear page, so that I know what the button does.
- Given `/notifications/confirm?token=...` (no sign-in needed), then the page shows "Turn on email alerts for <address>?" and a "Turn on email alerts" button; after success it shows "Email alerts are on." and a link to Settings.
- Given `/notifications/unsubscribe?token=...` (no sign-in needed), then the page shows "Stop email alerts for <address>?" and a "Stop email alerts" button; after success it shows "Email alerts are off. You can turn them on again in Settings."
- Given an invalid or expired token, then the page shows the API text and a link to Settings (no account details shown).
- Given the two routes, then the proxy allows them without a session and the pages do not render any device data.

**NF-6 (C) Mobile check of the card stack.** As a home user on a phone, I want the card to read well, so that I can turn alerts on from my phone.
- Given a phone width, then the switch row stacks, the test button is full width, and no text is cut off.

### UX [U]

**NU-1 (M) Screen spec and copy for Settings > Notifications.** As the team, we want one approved screen and copy before building, so that the page matches the plan.
- Given design `06-settings-notifications`, then the spec keeps the sub-nav, the "This is what an alert looks like" sample, and the visual language, and removes: push switch, weekly report, quiet hours, "Who gets alerts", per-level frequency selects, and "Send a test alert" (replaced by N-D15 wording).
- Given the spec, then every state in NF-2 and NF-4 has its copy, and the copy follows the honesty rules (no "safe" as a claim).
- Given the spec, then the two mail templates (subject and body for INSTANT, DIGEST, CONFIRM, TEST, and the unsubscribe footer) are written in plain words and reviewed against N-D16.
- Given the change, then it is recorded as new rows in `docs/design/v1-changes.md` and in plan section 9.

### End-to-end [E]

**NE-1 (M) Mail sink in the e2e harness.** As the e2e-tester, we want mail captured locally, so that tests read real sent mail without the internet.
- Given `npm run e2e`, then a local SMTP sink starts with the stack, and the worker gets `SMTP_*` values pointing at it.
- Given a test, then it can read the last mail sent to an address and its subject and body.
- Given the run, then no real mail server is contacted (checked by the harness setup).

**NE-2 (M) Happy path: confirm, then a Critical alert.** As a home user, I want to turn on mail and get an alert about a Critical problem, so that the whole flow is proven.
- Given a new account, when I turn on "Email me about new problems", then a confirmation mail arrives in the sink and the page says "We sent a link…".
- Given I open the link and press the button, then the page says "Email alerts are on."
- Given I add a device with the Critical fixture product and version and the check finishes, then one "right away" mail arrives with the device name and the words "needs fixing now" (the exact copy from NU-1).

**NE-3 (M) No spam.** As a home user, I want one mail per problem, so that repeated checks do not flood me.
- Given the same Critical finding, when I press "Check again" twice and then run `RESCAN_ALL`, then the sink holds one mail for that finding.
- Given nothing new since the last summary, when the 07:00 summary is triggered, then no summary mail is sent.

**NE-4 (M) Not set up.** As the person who runs HomeGuard, I want a clear state when mail is off, so that nobody is misled.
- Given the e2e run without `SMTP_HOST`, then the switch is disabled with "Email alerts aren't set up on this HomeGuard yet." and `PUT` returns the error text.
- Given that run, then a Critical check sends nothing and the device page still shows its normal result.

**NE-5 (M) Unsubscribe and isolation.** As a home user, I want to stop mail from the link, and I want nobody else to change my settings.
- Given a mail from NE-2, when I open its unsubscribe link and press the button, then alerts are OFF and a later Critical check sends nothing.
- Given the confirm token of user A, when user B posts it, then user B's state does not change and A's token is refused for B.

**NE-6 (M) Honesty check on mail and page.** As the team, we want no mail or page to claim a device is safe, so that the product stays honest.
- Given every mail captured in NE-2 to NE-5, then no body contains "safe" outside "does not mean a device is safe", nor "all clear", "all good", "good news" or "up to date".
- Given a device that is Not tracked, when checks run, then no mail is sent about it.

**NE-7 (C) Test-mail button.** As a home user, I want the test button to work end to end, so that I can check my mail.
- Given alerts are ON, when I press "Send a test email", then a test mail arrives in the sink and the page shows "Sent to <address>. Check your inbox."
- Given I press it again within 5 minutes, then the page shows the rate-limit text.

---

## Suggested order

1. NU-1 (screen spec and copy) and NB-1 (settings and start check), in parallel.
2. NB-2 (migration and contract freeze, reviewed by frontend and architect). Blocks everything below.
3. NB-3 and NB-4 (pure builder and sender, tested with fixtures and a stub).
4. NB-5 (send job), then NB-6 (right away), NB-7 (daily summary), NB-8 (baseline).
5. NB-9 (state API), NB-10 and NB-11 (confirm and unsubscribe), NB-12 (test mail). Then NB-14 review of this set.
6. NF-1 and NF-2 (once NB-9 is merged), NF-3, NF-4, NF-5. NF-6 and NB-13 are C and can be cut.
7. NE-1, then NE-2 to NE-6. NE-7 is C.

Each backend route PR adds a fixture response so the frontend's fixtures match it (architecture section 6.2).

---

## Definition of done

**Code**
- [ ] Every M story above is done. C stories (NB-13, NF-6, NE-7) may be cut, in that order, with their tests.
- [ ] `cargo test` and `cargo clippy --all-targets -- -D warnings` pass with `REQUIRE_DB_TESTS=1`.
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass in `web/`.
- [ ] The migration drift check passes; contract sync tests cover `SEND_EMAIL`, `SEND_DIGEST` and the new error codes on both sides.
- [ ] `npm run e2e` passes the NE-2 to NE-6 paths on the embedded database, using the mail sink.
- [ ] No test contacts a real mail server, NVD or Trivy.
- [ ] Every route in NB-9 to NB-12 has a cross-user test; every token has a purpose and a forgery test.

**Honesty and wording**
- [ ] No mail or page says a device is "safe" as a claim. The phrase "does not mean a device is safe" is the only use, and it is required in every mail and on the Notifications page.
- [ ] No mail is sent about "Not tracked" devices, and no mail says "all clear".
- [ ] Every risk in mail or on the page has text, not color alone.

**Security**
- [ ] SMTP passwords, tokens and addresses are not logged and not returned by the API beyond the person's own address on their page (NB-1, N-D18).
- [ ] The security-researcher review (NB-14) has no open must-fix items.
- [ ] GET requests never change state on the confirm and unsubscribe routes.

**Docs**
- [ ] `.env.example` lists every `SMTP_*` and `TZ` line with a comment; `docker-compose.yml` passes them to `worker` only.
- [ ] README has a short "Email alerts" section: setting up SMTP, testing it, turning alerts on, and what happens when mail is not set up.
- [ ] Plan sections 1, 9 and 12 are updated; `docs/backlog.md` marks D3 as superseded for e-mail, and removes e-mail from the Later list.
- [ ] `docs/design/v1-changes.md` has the rows from NU-1.
- [ ] An ADR records the mail library and the send-from-worker decision (architect).

**Manual pre-release checklist (the sandbox cannot run these)**
- [ ] Send a real test mail from a compose install through a real provider, with TLS, and confirm it arrives in an inbox (not spam).
- [ ] Check the 07:00 summary fires at the right local time with the compose `TZ`.
- [ ] `linux/arm64` worker image builds with the mail library and starts.
- [ ] Idle worker memory is still within the 512 MB stack budget (P9-5); measured with `docker stats` and noted in the README.
- [ ] Turn off SMTP after alerts were on: the Settings page shows the honest state and nothing crashes.

---

## Questions for the user

Only two. Everything else is decided above and can be changed later.

**Q1. Release timing.** Does e-mail ship in the first V1 release, or as a follow-up release right after it?
- Recommendation: a follow-up release (V1.1) on this branch. The V1 definition of done and its security review are already written for the current scope, and this feature adds a new background job and a public token flow that need their own review.

**Q2. Night-time alerts.** Confirm: no quiet hours in V1, so a "right away" Critical mail can arrive at night, at most once an hour per person.
- Recommendation: yes. Quiet hours needs a settings UI and a clock rule; the hourly cap limits the noise. If you want nothing at night, the simplest change is to hold INSTANT rows until 07:00, and I would add that as a story.
