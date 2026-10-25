# 0007 E-mail is sent by the worker with lettre; the web app signs the tokens

Status: accepted (V1.1, Phase 11). Date: 2026-10-25. Amends ADR 0001 (adds a third lane). Details: `docs/architecture-notifications.md`.

## Context
E-mail alerts are in scope (backlog N-D1 to N-D22). SMTP is an outside call that can hang. The mail password must reach one service only (N-D3, V1 lesson "secrets per service"). The library must do rustls with the `ring` provider the worker already uses, have timeouts and a stub for tests, build for musl amd64/arm64, and cost no idle memory. Confirm and unsubscribe links need signed tokens, and only the web app holds `BETTER_AUTH_SECRET`.

## Decision
- **Only the worker sends mail.** Only the `worker` service gets the `SMTP_*` variables. The web app inserts `notification` rows and `SEND_EMAIL` jobs through `enqueueJob`. It learns whether mail is set up from `worker_status.smtp_configured`, which the heartbeat writes.
- **Library: `lettre = "0.11.23"`** with `default-features = false` and the features `builder`, `smtp-transport`, `tokio1`, `tokio1-rustls`, `ring`, `rustls-platform-verifier`. Not enabled: `native-tls` (OpenSSL), `pool` (idle sockets), `hostname`, `tracing` (it logs SMTP commands with addresses).
- **Always wrap a send in `tokio::time::timeout(20 s)`.** lettre's own `timeout()` did not cover the server greeting: in a test a silent server held a send for 60 s.
- **Tests:** `AsyncStubTransport` for unit tests. A small loopback SMTP sink, written by us, for worker integration tests and Playwright. Nothing contacts a real server.
- **A third lane, `mail`** (`SEND_EMAIL`, `SEND_DIGEST`), one job at a time. Worker pool size goes from 5 to 6.
- **Tokens:** the web app signs them with HMAC-SHA256, using a key derived by HKDF from `BETTER_AUTH_SECRET`, with the purpose inside the signed data. The worker copies finished tokens out of `notification_pref.unsubscribe_token` and `notification.link_token`. It gets no signing key.

Alternatives considered:
| Option | Why not |
|---|---|
| `mail-send` 0.6 | Smaller user base. It bundles DKIM and its own message builder, which we do not need. Its rustls setup is less flexible than lettre's choice of provider and verifier. |
| `async-smtp` 0.10 | Low-level, no message builder; we would write header encoding ourselves. That is the part where injection bugs live. |
| Hand-written SMTP over `tokio-rustls` | Header encoding, STARTTLS and AUTH are easy to get wrong. lettre is the common Rust choice. |
| Sending from Next.js (nodemailer) | Breaks "outside calls in the worker" and puts the SMTP password in the web container. |
| A mail relay container | A fourth container for a few mails a day. |
| `NOTIFY_TOKEN_SECRET` shared by web and worker | One more secret to set and to leak. Storing tokens signed by the web app is just as strong: anyone who can read the database can already change the pref row. |

Checked in the sandbox (2026-10-25): with these features lettre adds 8 crates to the worker lock file. It shares `rustls`, `tokio` and `rustls-platform-verifier 0.7.1` with reqwest and sqlx, and the worker builds in release mode. Against a loopback sink, a send works with `List-Unsubscribe` headers; 5xx is reported as permanent, 4xx as transient; the outer timeout stops a silent server.

## Consequences
- No new container and no idle cost: one SMTP connection per mail, closed afterwards.
- Pin `0.11.23`. A feature change needs a check of the arm64 musl build in CI (not run here).
- Delivery is at least once. A crash between the server's "250" and the `SENT` update sends the mail twice; we accept that.
- Self-signed LAN relays do not pass certificate checks. They need `SMTP_TLS=off`, which the worker warns about.
- Rotating `BETTER_AUTH_SECRET` breaks the links in mails already sent. Settings still works.
