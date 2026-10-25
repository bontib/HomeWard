# V1 acceptance review

Reviewer: product-owner. Date: 2026-10-24. Commit reviewed: `b522c98` (main).
Basis: `docs/backlog.md` (all M stories and the V1 definition of done), `docs/implementation-plan.md`, `README.md`, `docker-compose.yml`, `.env.example`, both Dockerfiles, `.github/workflows/`, and the code under `web/` and `worker/`.

**Method limit.** This review was read-only. Tests, lint, builds, `cargo`, and Docker were not run. "Met" means the code and config do what the story says when read. It is not a test result. Everything in "Could not verify here" must be checked on a real Docker host.

---

## Update after fixes (2026-10-24)

Blockers B1 to B6 are closed in code and docs. Q1, Q3, Q4, Q5, Q7, Q8, Q9 and Q10 were answered with the recommended answers (user delegated). Q2 (image owner, v0.1.0 tag) and Q6 stay open: no tag was created and nothing was pushed. Verified here: `cargo test`, `cargo clippy -- -D warnings`, `npm run lint`, `typecheck`, `test` (255 tests), `build`, and the Playwright suite (14 passed, with a fresh build). Docker is not installed here, so the compose build, the entrypoint check and the manual checklist below are still to be run on a Docker host.

| Item | Status | What changed |
|---|---|---|
| B1 | Closed (not run) | `docker-compose.yml` has `build:` for web and worker next to `image:`; README makes `docker compose up -d --build` the install path and pulling tagged images optional. |
| B2 | Closed (not run in Docker) | `web/src/instrumentation.ts` calls `getEnv()` at server start; `docker-entrypoint.sh` checks secret length and `DATABASE_URL` before migrations. `DATABASE_URL` must start with `postgresql://` (test added). |
| B3 | Closed, memory still unmeasured | README: disk need (about 1 GB Trivy data, 2 GB free), restore command, memory claim replaced by "not measured yet". P9-5 stays Missing. |
| B4 | Closed | `docs/security-review-v1.md` states the result, the fix commit `8077a7f`, and that no must-fix is open; two accepted Low residuals named. |
| B5 | Closed | NVD busy, device check failed (`jobs/messages.ts`), "Checked against NVD on <date>. This does not mean the device is safe." (`WhatToDoCard.tsx`), KEV age and Scanner date on Checks (`staleDataNotes`, shown when an update failed or KEV is over 2 days old), empty vulnerabilities state, and "No account with that email." The empty state is "No known vulnerabilities on your devices right now." with "N devices can't be fully checked." and the caveat line when everything is checked. |
| B6 | Closed | `web/src/store/invalidation.test.ts`: creating a device refetches the device list. |
| Q1 | Done | Backlog definition of done reworded. |
| Q4 | Done | No name field; name is the email local part; server limit kept; e2e updated. |
| Q7, Q8 | Done | SBOM help note; tagline now "Plain answers about your devices, not a security console." |
| Q9, Q10 | Recorded | `docs/design/v1-changes.md` rows 22 to 26, plan section 9, `docs/architecture-v1.md` section 10. |
| Q5 | Recorded | Manual compose run is the V1 gate; compose CI job added to Later in the backlog. |
| Q3 | Done | See B2. |

Story statuses after this update: P2-4, P4-3, P5-1, P5-5, P5-6, P6-1, P7-4, P9-4, P9-6 and P10-2 are Met (code and tests; P9-4 and P9-1 to P9-3 still need a Docker run). P9-7 is Met except the measured memory figure. P9-9 is Met. P9-5 is Missing.

---

## Verdict

**Not ready for the user to set up yet. Close.**

Most M stories are built, and the honesty rules are implemented well. "No known vulnerabilities" always carries a "not a promise it is safe" line, "Not tracked" is used for unknown products, and the worker's job, retry, rate-limit and SBOM logic follow the plan. Blockers B1 to B4 below must close before a user can install it, and B5 and B6 must close before release. The fixes are small, except B1, which needs a release tag.

---

## Counts (55 M stories)

- Met: 41 (of which 3 are "met in code, not run": P9-1, P9-2, P9-3).
- Partial: 12.
- Missing: 2 (P9-5 memory measurement, P9-9 security review record).

C stories: P3-3 met, P5-2 example versions not built, P8-5 missing, P10-1 and P10-3 not evaluated.

---

## Blockers

- **B1. No published images.** There is no release tag in the repo, so `release.yml` has never run. `docker-compose.yml` has no `build:` fallback, so a clean `docker compose up -d` cannot pull `ghcr.io/<owner>/homeward-web`. The owner is also commented out in `.env.example` (line 48). (P9-3 and the V1 "images published" item.)
- **B2. The web container does not refuse to start on a bad secret (P9-4).** `web/src/lib/env.ts:51` exits the process, but only when `getEnv()` first runs, which is the first request. There is no `instrumentation.ts`. The container starts, passes its first check, and then exits on the health check and restarts in a loop. Add a boot-time check that exits with the plain message before the server accepts traffic.
- **B3. README gaps (P9-7) and unmeasured memory (P9-5).** The README has no disk need (about 1 GB for Trivy data, from the plan). Restore has no command ("Restore into an empty database with `psql`"). "About 300 MB while idle" (`README.md:78`) has no `docker stats` source; `docs/architecture-v1.md:1183` lists targets only. Measure on a NAS-class box and record the number and method.
- **B4. No security review record (P9-9).** Commit `8077a7f` says "Apply security review fixes", but `docs/` has no written review or must-fix list. The "no open must-fix items" condition cannot be confirmed.
- **B5. Copy that does not match the stories.** Fix these to the plan wording (details in the table):
  - P4-3 device check failure: "We couldn't check this device. Try again."
  - P5-1 NVD busy: "NVD is busy. We'll try again later."
  - P5-5 no-known line: "Checked against NVD on <date>. This does not mean the device is safe."
  - P5-6 KEV age: "Known exploited list is N days old."
  - P6-1 scanner date: "Scanner data is from <date>."
  - P7-4 empty states: "No known vulnerabilities on your devices right now." and "N devices can't be fully checked."
  - P9-6 unknown email: "No account with that email."
- **B6. Missing test for P2-4.** No Vitest test shows that a mutation's tag invalidation refetches the query, which the story asks for. Invalidation is wired in `devicesApi.ts` and `findingsApi.ts`.

Not blocking, but record for V1: P9-8 end-to-end tests run without Docker and are not in CI (see Q5). The P8-1 deviation (Trivy DB refresh inside RESCAN_ALL, not a separate step) and the P5-5 job rename (CHECK_DEVICE, not MATCH_CPE) are design changes that should be written into the plan.

---

## Meets (fully, from code reading)

| Story | Evidence |
|---|---|
| P0-1 | `web/package.json` scripts `lint`, `test` (Vitest) |
| P0-2 | `worker/src/main.rs` logs "ready"; `worker/src/config.rs` names `DATABASE_URL` in its error |
| P0-3 | `docker-compose.yml` `db` (postgres:17-alpine, `db-data`, healthcheck); `.env.example` covers section 12 |
| P1-1 | `web/src/features/auth/SignupForm.tsx:35` one generic error; `schemas.ts` 12 characters. Extra "Your name" field, see Q4 |
| P1-2 | `LoginForm.tsx` "Email or password is wrong."; `AppShell.tsx` sign-out goes to `/login` |
| P1-3 | `web/src/app/(app)/layout.tsx` `requireSession`; `next` path via `safeNextPath`; API auth via `server/http.ts` `withSession`, tests in `routes.db.test.ts` |
| P1-4 | `web/src/app/(auth)/signup/page.tsx:14-22` exact text; `web/src/lib/auth.ts:30` `disableSignUp`; `e2e/signup-disabled.spec.ts` |
| P1-5 | No passkey, forgot-password, keep-me-signed-in or household text in `web/src`. Layout not checked visually |
| P2-1 | `web/prisma/migrations/0001_init/migration.sql` (`device.room`, `device_user_id_created_at_idx`); CI greps `worker/src` for CREATE/ALTER TABLE. Schema differs from plan section 5 (see ADR 0005) |
| P2-2 | `web/src/app/tokens.css` light, dark and system; fonts from `web/src/app/fonts/*.woff2` via `next/font/local`; no hex colors outside `tokens.css` |
| P2-3 | `web/src/components/ui/` (Select, Checkbox, Switch in `Field.tsx`; IconButton in `Button.tsx`); `/ui` is 404 in production (`web/src/app/ui/page.tsx:8`). Focus ring not checked |
| P2-5 | `AppShell.tsx` 232 px (`w-58`), no Scanner or Notifications. Adds a "Vulnerabilities" item. Top bar switches at `md` (768 px), not 800 px |
| P3-1 | `web/src/server/devices.ts` filters on `userId`; `server/errors.ts` `notFound` returns 404; `server/devices.db.test.ts` "another user's device" |
| P3-2 | `HomeScreen.tsx` empty state; `risk/display.ts` maps `NOT_TRACKED` to "Not tracked" |
| P3-4 | `AddDeviceForm.tsx` (ResultCard, "I don't know the version"); `WhatToDoCard.tsx` "We don't have public security data for this device yet."; `version ?` in `VersionTag.tsx` |
| P3-5 | `DeviceDetailScreen.tsx:46` "We couldn't find that device."; `:138` "About this device"; `:159` "Version history" |
| P3-6 | `EditDeviceDialog.tsx`; `server/devices.ts` writes `versionChange` on version change |
| P3-7 | `RemoveDeviceDialog.tsx`; `ON DELETE CASCADE` on component, sbom and finding in the migration |
| P4-1 | `worker/src/queue.rs` `FOR UPDATE SKIP LOCKED`; `runner.rs` `LISTEN jobs` and a 30 s poll (`runner.rs:22`); job spans carry `job_id` |
| P4-2 | `queue.rs` `backoff_seconds` (60 s, then 300 s); `max_attempts`; `context.rs` `timeout_for` (10 min) |
| P5-3 | `worker/src/version.rs` tests include "unknown" and "beta build xyz" |
| P5-4 | `worker/src/cpe.rs` tests on start and end bounds, using NVD fixtures. `*` and `-` not checked line by line |
| P5-7 | `AddDeviceForm.tsx` ResultCard "We'll check this after you save."; "Other" shows Not tracked; `e2e/devices.spec.ts` covers known and unknown products |
| P6-2 | `worker/src/sbom.rs` (CycloneDX, SPDX, refuse other formats); `web/src/server/sboms.ts` `checkUpload` checks size before storage with the exact messages |
| P6-3 | `SoftwareCard.tsx` (FileDrop); `server/sboms.ts` `saveSbom`; `worker/src/sbom_import.rs` replaces only SBOM rows; cascade on delete |
| P6-4 | `worker/src/trivy.rs:206-209` `sbom --format json --scanners vuln --skip-db-update`; `parse_report` tests; `worker/tests/fixtures/trivy/`; `jobs/messages.ts` "We couldn't check this file. Try again." |
| P6-5 | `SoftwareCard.tsx`; "parts not checked" in `lib/contracts/api.ts:68` and `WhatToDoCard.tsx` |
| P6-6 | `web/src/features/devices/SbomHelp.tsx` (Windows, macOS, Linux, one command each, syft link with `rel="noopener"`). See Q7 |
| P7-1 | `WhatToDoCard.tsx` "Update {name} to {version}"; "Check the maker's website for an update."; "I've updated it"; no green card for devices without findings |
| P7-2 | `DeviceDetailScreen.tsx:106` "Known vulnerabilities · N"; `CveItem.tsx` score, CVE ID, "Exploited in the wild", "No fix known yet", "Fixed in" |
| P7-3 | `VulnerabilityDetailScreen.tsx` "Full details on NVD" (new tab, noopener), "None of your devices has this problem."; two-sentence summary in `common/format.ts` |
| P7-5 | `IgnoreFindingDialog.tsx` "Add a short reason."; `lib/contracts/api.ts:270-274` 1 to 200 characters; `recompute_status` job |
| P7-6 | `NetworkSummary.tsx` headlines match the plan, with the caveat; `HomeScreen.tsx` `WorstDeviceBanner` "Fix now" |
| P8-1 | `worker/src/scheduler.rs` cron and 25 h catch-up; `config.rs` `check_cron` names `RESCAN_CRON`. Trivy DB refresh runs inside `rescan_all.rs` when more than 12 h old (deviation) |
| P8-2 | `worker/src/products.rs` `CVE_CACHE_HOURS = 24` (stricter than 7 days, so more NVD calls, see Q10); KEV every 24 h (`scheduler.rs`); `vulns.rs` overwrites scores |
| P8-3 | `ChangePasswordForm.tsx` "That's not your current password.", `revokeOtherSessions: true`; no household section |
| P8-4 | `ChecksScreen.tsx` "The scanner is on", "Set in .env", API-key status, last 10 jobs, "Check all now" disabled while busy, no pause |
| P10-2 | Checked by reading: the states exist; the copy drift is listed under Partial |

---

## Partial and missing

| Story | Status | Evidence and gap |
|---|---|---|
| P2-4 | Partial | Store and tags exist (`store/api.ts`). No test for refetch after invalidation (B6) |
| P4-3 | Partial | Polls every 2 s (`useJobWatcher.ts:6`), "Checking…" shows. Failure text is generic per code (`jobs/messages.ts`), not "We couldn't check this device. Try again." (B5) |
| P5-1 | Partial | `worker/src/nvd.rs`: 403, 429 and 5xx retried, 3 tries (6 s, 30 s); key sent as `apiKey` header and not logged; `limiter.rs` 5 or 50 per 30 s; `nvd_client.rs` tests on fixtures. Failure text is "We couldn't reach the vulnerability list. Try again later." (`messages.ts:4`) (B5) |
| P5-5 | Partial | `worker/src/status.rs` `risk_level` matches the thresholds. Job is `CHECK_DEVICE`, not `MATCH_CPE` (design change). `WhatToDoCard.tsx:107-110` says "That is not a promise it is safe" and the date is in the header, but not the exact "Checked against NVD on <date>" line (B5) |
| P5-6 | Partial | `worker/src/jobs/import_kev.rs` keeps the old list on failure and sets `exploited`; `kev.rs` rejects an empty list. Missing "Known exploited list is N days old." (B5) |
| P6-1 | Partial | `scheduler.rs` bootstrap queues the Trivy DB update when missing; `rescan_all.rs` keeps old data on failure. Missing "Scanner data is from <date>." Only an "Updated" column on Checks (`ChecksScreen.tsx:29`) (B5) |
| P7-4 | Partial | Table, sorting and URL filters work (`VulnerabilitiesScreen.tsx`). Empty-state copy differs: "No known problems at the last check." and "N devices not checked yet or not tracked, so this list may be incomplete." (`:109-117`) (B5) |
| P9-4 | Partial | `/api/health` returns 503 when the DB is down (`api/health/route.ts`). Secret check is lazy (`env.ts:51`), no boot check (B2) |
| P9-6 | Partial | `web/scripts/reset-password.mjs` deletes sessions, hidden prompt, `--generate`, 12 characters. Unknown-email text is "No account found for <email>." (B5) |
| P9-7 | Partial | `README.md` covers install, update, reset, NVD key and sign-up off. Missing disk need, restore command and measured memory (B3) |
| P9-8 | Partial | `web/e2e/`: auth, known and unknown product, SBOM, isolation, sign-up off, all with mock NVD and embedded Postgres (`e2e/global-setup.ts`). Not run against compose; no Playwright job in `.github/workflows/ci.yml` (see Q5) |
| P10-2 | Partial | The copy drift above (P4-3, P5-1, P5-5, P5-6, P7-4, P9-6) |
| P5-2 (partly) | Met, wording | `ProductSearch.tsx` 1 s poll and 10 s "Search is taking longer than usual. Try again in a minute."; 8 results. Radio label reads "Add it as Other", not "Other (not in the list)" |
| P1-1 (extra) | Met, scope | Required "Your name" field (Q4) |
| P9-1 | Met, code only | `web/Dockerfile` standalone output, `USER node`, `docker-entrypoint.sh` runs `migrate deploy` with `set -eu`, multi-arch via `$BUILDPLATFORM`. Not built |
| P9-2 | Met, code only | `worker/Dockerfile` musl build with `cargo-zigbuild` for amd64 and arm64, Trivy 0.76.1 copied in, user 10001. Not built (is `zig` in the Alpine repo? unverified) |
| P9-3 | Met, code only | `docker-compose.yml` three services, healthchecks, `restart: unless-stopped`, named volumes. Images must be published first (B1) |
| P9-5 | Missing | No `docker stats` figure recorded (B3) |
| P9-9 | Missing (evidence) | Commit `8077a7f` exists; no review record (B4) |
| P8-5 (C) | Missing | No "Last checked N days ago" or "Couldn't reach NVD" text. Could-have, cut first |

---

## Wording problems

No text in `web/src` or `worker/src` uses "Up to date" or claims a device is "safe". The word "safe" appears only as an internal name (`level="safe"`) or in the caveats "That is not a promise it is safe" (`WhatToDoCard.tsx:108`) and "does not mean a device is safe" (`NetworkSummary.tsx:112-117`). Those are the intended honesty lines.

- **The definition of done contradicts itself (line 422 of `docs/backlog.md`).** It says "safe" appears nowhere in the UI. The P5-5 story and the caveat require the words "does not mean the device is safe". See Q1.
- **Watch:** the headline "No known problems on your devices" (`NetworkSummary.tsx:49`) reads like a verdict. Its caveat sits right underneath, so keep both.
- **Watch:** "we check again every day" (`WhatToDoCard.tsx:109`) is hard-coded. It is false if `RESCAN_CRON` is changed.
- **Watch:** "Made for households, not security teams." (`AuthShell.tsx:37`) suggests household accounts. D1 says accounts are per person. See Q8.
- Copy drift from the stories is listed under B5. None of it makes a device look safer than it is, but P5-5 and P7-4 are honesty stories, so fix them.

---

## Could not verify here (manual pre-release checklist)

Run on a Docker host, on amd64 and then arm64. Tick each item and note the result in the release.

1. Publish images: tag, wait for `release.yml`, then `docker manifest inspect` for `homeward-web` and `homeward-worker` on both architectures.
2. Clean install: copy `.env.example`, set the secret, `docker compose up -d`. All three services healthy within 2 minutes; sign-in page at `:3000`.
3. Bad secret: set `BETTER_AUTH_SECRET` to 10 characters. The web container should refuse to start with the plain message. Right now it will restart in a loop. Record the logs.
4. Bad config for the worker: missing `DATABASE_URL` and invalid `RESCAN_CRON` both give plain messages that name the variable.
5. Memory: `docker stats` after 10 idle minutes, then during a Trivy DB update and a check. Record idle figure (target under 512 MB) in the README.
6. First start: Trivy DB downloads into `trivy-cache`; KEV list imports; "Checks" shows both sources.
7. SBOM with the real Trivy: a CycloneDX file from a test PC and an SPDX file. Findings appear. A non-SBOM file and a file over 20 MB show the plain messages.
8. Real NVD: a known vulnerable product and version shows CVEs; an unknown product shows "Not tracked". Test with and without `NVD_API_KEY`.
9. Reset password: `docker compose exec web node /app/tools/scripts/reset-password.mjs <email> --generate`. Sign in with the new password; old sessions are gone; an unknown email gets the right message.
10. Restarts: `docker compose restart worker`, `docker kill` one container (restart policy), `docker compose down` then `up -d` (data kept).
11. Backup and restore: run the README `pg_dump`. Restore into an empty database with `psql` and confirm the restore command is written down.
12. Update: `docker compose pull && docker compose up -d`; migrations run; web waits for the DB.
13. Sign-up off: `ALLOW_SIGNUP=false`, restart; `/signup` text and API refusal; existing users still sign in.
14. Two accounts: user B cannot see or open user A's device in the UI or by URL (404).
15. Ignore and reopen a finding; device status updates. "Check again" shows "Checking…" then a result. "Check all now" is disabled while it runs.
16. Visual check against `docs/design/homeward/screens/`: light, dark (system setting), 390 px phone width, sidebar switch point.
17. Keyboard: focus ring is visible on every control. Quick screen-reader pass (no automated accessibility check exists in CI).
18. Run `cargo test`, `cargo clippy -- -D warnings`, `npm run typecheck`, `npm run lint`, `npm test`. Run the Playwright suite against the compose stack (see Q5).
19. Security review record exists, and every must-fix item is closed (B4).
20. README followed by someone who did not write it, on a clean machine (DoD).
21. Syft commands in `SbomHelp.tsx` work on Windows, macOS and Linux, and the output uploads. Note how long `syft dir:/` takes (Q7).
22. Time zone: "checked N ago" and the next-check time match `TZ`.

---

## Questions for the user

Each question has my recommended answer. Please reply with yes or with a change for each.

❓ **Q1** - **"Safe" in the definition of done**: The done list (backlog line 422) says the word "safe" appears nowhere in the UI. P5-5 and the caveat require "does not mean the device is safe". Should the rule be "'safe' is never used as a claim, and the caveat is required"?

➡️ Yes. Reword the done item to: "'safe' is never used as a claim. Every 'No known vulnerabilities' carries the 'does not mean the device is safe' line."

---

❓ **Q2** - **Image owner and first release**: Compose pulls `ghcr.io/${HOMEWARD_OWNER}/…`. `.env.example` comments the variable out, and the README says to set it. Which GitHub owner publishes the images? Should I cut `v0.1.0` after the blockers close?

➡️ Use the GitHub account that owns this repository (the git user here is `bontib`, please confirm). Make `HOMEWARD_OWNER` required in `.env.example`. Tag `v0.1.0` after B1 to B6 are closed and CI is green.

---

❓ **Q3** - **Boot-time secret check in V1**: P9-4 says the web container refuses to start when `BETTER_AUTH_SECRET` is missing or short. Today the check runs on the first request. Should this be fixed before V1?

➡️ Yes. The web app checks its environment before it accepts traffic and exits with the plain message.

---

❓ **Q4** - **"Your name" on sign-up**: P1-1 asks only for email and password. The form requires a name. Keep it or drop it?

➡️ Drop it for V1. Fewer fields for a home user, and it matches the plan. Add it later if needed.

---

❓ **Q5** - **Gate for the end-to-end tests**: P9-8 says the happy paths run against `docker compose`. They run today on embedded Postgres with a mock NVD, and CI does not run them. Should V1 be gated by a manual compose run, or should a compose job be added before the first tag?

➡️ Manual compose run as the V1 gate, with the result noted in the release. Add a CI job to the Later list.

---

❓ **Q6** - **Security review (P9-9)**: Commit `8077a7f` applied security-review fixes, but there is no written review in `docs/`. Was that the P9-9 review, and are any must-fix items open?

➡️ Yes, it was the review and nothing is open. If you cannot confirm that, the security-researcher writes a short review record before the tag. Owners fix anything found.

---

❓ **Q7** - **Whole-disk syft commands**: `SbomHelp.tsx` tells users to run `syft dir:/` and `syft dir:C:\`. Those scan the whole disk, can take a long time, and may need administrator rights. Keep them as they are?

➡️ Keep them, and add one line saying the scan can take a long time and may need an administrator.

---

❓ **Q8** - **"Made for households" tagline**: `AuthShell.tsx:37` suggests household accounts, but D1 says per person. Change it?

➡️ Yes. The ux-designer proposes a replacement line that does not mention households.

---

❓ **Q9** - **"Vulnerabilities" in the sidebar**: It is not in the design. P7-4 needs a route, and this is the simplest way to reach it. Keep it?

➡️ Keep it, and record the addition in `docs/design/v1-changes.md` and plan section 9.

---

❓ **Q10** - **CVE refresh every 24 hours, not 7 days**: `CVE_CACHE_HOURS = 24` is stricter than P8-2, so it uses more NVD requests. Keep it?

➡️ Keep it. Revisit if NVD limits are hit in practice.

---

## Backlog status

`docs/backlog.md` has no status field per story, so no statuses were changed. This file is the status record for V1.
