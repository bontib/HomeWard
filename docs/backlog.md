# Backlog: Home Vulnerability Tracker (V1)

Owner: product-owner. Source: `docs/implementation-plan.md`.

Stories are grouped by phase (section 10) and ordered inside each phase. Each story should fit one PR. Each one maps to a phase.

Priority:
- **M** = must have for V1.
- **C** = could have. Cut first if time is short.

Story format: "As a home user, I want … so that …" for user-facing work. Developer stories say what the team gets. Acceptance criteria are Given / When / Then.

---

## Phase 0: Scaffolding

**P0-1 (M) Web app starts.** As a developer, I want the Next.js app to start with lint and tests, so that the team has a base.
- Given a clean checkout, when I run `npm run dev` in `web/`, then a placeholder page loads on port 3000.
- Given the project, when I run lint and a sample Vitest test, then both pass.

**P0-2 (M) Worker connects to Postgres.** As a developer, I want the worker to connect and log "ready", so that the job loop has a base.
- Given the database is running and `DATABASE_URL` is set, when I run `cargo run`, then the worker logs "ready".
- Given `DATABASE_URL` is missing or wrong, when the worker starts, then it exits with a plain error that names the variable.
- Given the crate, when I run `cargo test` and `cargo clippy -- -D warnings`, then both pass.

**P0-3 (M) Dev database with compose.** As a developer, I want one command to start Postgres, so that web and worker share one database.
- Given Docker is installed, when I run `docker compose up -d db`, then Postgres 17 runs with a named volume and a healthcheck.
- Given `.env.example`, when I copy it to `.env`, then every variable in section 12 is listed with a short comment.

---

## Phase 1: Auth

**P1-1 (M) Sign up.** As a home user, I want to create an account with email and password, so that my devices are private to me.
- Given sign-up is on, when I enter a valid email and a password of at least 12 characters, then my account is created, I am signed in, and I land on My home.
- Given a password under 12 characters, when I submit, then the form says "Use at least 12 characters." and no account is created.
- Given sign-up fails for any reason (including an email already in use), when I submit, then the form says "We couldn't create an account. Try signing in." (same text for all cases, so the page does not reveal which emails exist).

**P1-2 (M) Sign in and out.** As a home user, I want to sign in and out, so that only I can see my devices.
- Given a correct email and password, when I sign in, then I see My home.
- Given a wrong password, when I sign in, then I see "Email or password is wrong." and stay on the page.
- Given I am signed in, when I choose Sign out, then I am sent to `/login`.

**P1-3 (M) Protected pages.** As a home user, I want the app to ask me to sign in first, so that nobody else on my network sees my devices.
- Given I am signed out, when I open `/`, `/devices/new`, `/devices/[id]` or `/settings`, then I am sent to `/login`, and after signing in I go to the page I asked for.
- Given I am signed out, when I call any `/api` route except `/api/health` and the auth routes, then I get a 401 JSON response.

**P1-4 (M) Turn sign-up off.** As the person who runs the app, I want to close sign-up after the family has accounts, so that strangers on the network cannot join.
- Given `ALLOW_SIGNUP=false`, when I open `/signup`, then I see "Sign-up is turned off. Ask the person who runs this app." and the sign-up API refuses new accounts.
- Given `ALLOW_SIGNUP=false`, when an existing user signs in, then sign-in still works.

**P1-5 (M) Sign-in page in the HomeGuard style.** As a home user, I want a clear sign-in page, so that I know where to start.
- Given I open `/login` on desktop, then the split layout from `01-sign-in` is shown in light and dark, with email, password, Sign in and "Create an account".
- Given the page, then there is no passkey button, no "Forgot password?" link, no "Keep me signed in" checkbox and no "Create a household" link (see Decisions D13, D14).
- Given a phone-width screen, then the page stacks into one column.

---

## Phase 2: Data model and UI base

**P2-1 (M) Schema and first migration.** As the team, we want the section 5 data model in Prisma, so that web and worker share one schema.
- Given the Prisma schema, when I run `prisma migrate deploy` on an empty database, then all tables from section 5 are created, including `Device.room` and an index on `Device.userId`.
- Given the worker code, then it contains no migrations and no `CREATE` / `ALTER` statements (checked in review).

**P2-2 (M) Design tokens and fonts.** As a home user, I want the app to look calm and consistent, so that it feels trustworthy.
- Given `tokens.css` is mapped to Tailwind, when my system is in dark mode, then pages use the dark values; in light mode, the light values (Decision D20).
- Given the app is offline, then Figtree and JetBrains Mono still load (served by the app, via `next/font`).
- Given any component, then no colors are hard-coded (checked in review).

**P2-3 (M) Primitives.** As a developer, I want the shared UI parts from section 9, so that screens are built from one set of parts.
- Given section 9's list, then every primitive exists in `src/components/ui/` and matches the design.
- Given the dev page `/ui`, when I open it in a development build, then every primitive shows in light and dark. In a production build, `/ui` returns 404 (Decision D21).
- Given any focusable control, when it has keyboard focus, then it shows a 2 px brand-colored ring with 2 px offset.

**P2-4 (M) Store and server-data base.** As a developer, I want Redux and RTK Query set up, so that server data is cached and refreshed in one way.
- Given the store, then typed hooks exist and the RTK Query base API defines its tag types.
- Given a query and a mutation that invalidates its tag, when the mutation succeeds, then the query refetches (one Vitest test).

**P2-5 (M) App shell.** As a home user, I want a simple menu, so that I can find My home, Add a device and Settings.
- Given I am signed in on a desktop-width screen, then a 232 px sidebar shows the logo, My home, Add a device, Settings, and a user footer with sign-out.
- Given the design's Scanner and Notifications items, then they are not shown (Scanner lives under Settings > Checks; Notifications is out of V1, D3).
- Given a width under 800 px, then the sidebar becomes a top bar with a menu button, and every target is at least 44 px.

---

## Phase 3: Devices (no scanning yet)

**P3-1 (M) Device API with per-user access.** As the team, we want every device read and write limited to the signed-in user, so that users never see each other's devices.
- Given user A and user B, when B calls GET, PATCH or DELETE on a device owned by A, then the response is 404 (not 403), and A's device never appears in B's lists.
- Given I call the device list, then it returns only my devices with component and open-finding counts.
- Given `src/server/devices.ts`, then Vitest covers the cross-user cases above.

**P3-2 (M) My home device grid.** As a home user, I want to see all my devices at a glance, so that I know what I own.
- Given I have devices, when I open My home, then each device is a DeviceCard showing icon, name, "vendor · product · room", RiskBadge, VersionTag, and the whole card is a link to its detail page.
- Given I have no devices, then I see "No devices yet" and an "Add your first device" button.
- Given a device with status `NOT_TRACKED`, then its card shows the "Not tracked" label with its icon (never a green check).

**P3-3 (C) Search and filter chips.** As a home user, I want to find a device quickly, so that I don't scroll.
- Given devices, when I type in search, then the grid shows devices whose name or room contains the text (case-insensitive).
- Given the chips All, Needs attention, Game consoles, TV & media, Computers, Smart home, when I select one, then the grid filters, `aria-pressed` is true, and the count "Devices · N" updates.
- Groups: Game consoles = CONSOLE; TV & media = TV, SPEAKER; Computers = PC, LAPTOP; Smart home = CAMERA, PLUG, BULB, THERMOSTAT, DOORBELL; Needs attention = CRITICAL and VULNERABLE (D10). Other types appear under All only.

**P3-4 (M) Add a device (free-text product).** As a home user, I want to add a device in under a minute, so that I can start tracking it.
- Given I am on `/devices/new`, when I pick a type, enter a name, optionally a room, a product name and a version, and choose Add device, then the device is saved and I land on its detail page.
- Given I leave the product empty or choose "I don't know", when I save, then the device shows "Not tracked" with the text "We don't have public security data for this device yet."
- Given the name is empty, when I save, then I see "Give your device a name." and nothing is saved.
- Given the version is empty, then the version shows as "version ?" and the device is Not tracked.

**P3-5 (M) Device detail.** As a home user, I want one page per device, so that I can see what it is and its status.
- Given I open `/devices/[id]` for my device, then I see a back link, the large device icon, name, "type · room", RiskBadge, VersionTag, the "checked" time, and an "About this device" list (type, room, vendor, product, added on, notes).
- Given an ID that is not mine or does not exist, then I see "We couldn't find that device." (404 page).

**P3-6 (M) Edit device and version history.** As a home user, I want to rename a device and update its version, so that the app knows what is installed.
- Given I change the version and save, then the new version shows and the old version appears in "Version history" with the date it was replaced.
- Given I change only name, room or notes, then no version history entry is added.
- Given I edit the version, then the device status is recalculated (in Phase 3 this is always Not tracked, since there is no product match yet).

**P3-7 (M) Delete device.** As a home user, I want to remove a device I no longer have, so that my list stays accurate.
- Given I choose Remove device and confirm in the dialog, then the device and its components and findings are deleted and I return to My home.
- Given I cancel the dialog, then nothing is deleted.

---

## Phase 4: Worker foundation

**P4-1 (M) Job loop.** As the team, we want the worker to pick up jobs from Postgres, so that heavy work runs outside the web app.
- Given a `Job` row is inserted and `pg_notify('jobs', id)` is sent, when the worker is running, then it claims the job with `FOR UPDATE SKIP LOCKED`, marks it RUNNING, then DONE or FAILED.
- Given a notify was missed, when 30 seconds pass, then the worker still picks up queued jobs (Decision D17).
- Given a job, then every log line for it includes `job_id`.

**P4-2 (M) Retries and timeouts.** As a home user, I want temporary failures to retry on their own, so that I don't have to press buttons twice.
- Given a job fails, when fewer than 3 attempts have run, then it is retried after 1 minute, then after 5 minutes (Decision D18).
- Given a job fails 3 times, then it is FAILED and the error is stored, and users see only plain text (no stack traces).
- Given a job runs longer than 10 minutes, then it is stopped and counted as a failure.

**P4-3 (M) Check again and progress.** As a home user, I want to press "Check again" and see it finish, so that I trust the result is new.
- Given I am on a device page, when I press "Check again", then a job is queued through `enqueueJob` and the device shows "Checking…" with a spinner and text.
- Given a job is running, then the UI polls `/api/jobs/:id` every 2 seconds and stops when the job is DONE or FAILED, then refreshes the device.
- Given a job fails, then the device shows "We couldn't check this device. Try again."
- Given the phase's test job, when it is queued from the UI, then it is shown as done within 1 second. The test job only exists in development builds.

---

## Phase 5: Manual devices to NVD matching

**P5-1 (M) NVD client.** As the team, we want NVD calls to respect its limits, so that we are not blocked.
- Given more requests than the limit (5 per 30 s, or 50 with an API key), then the extra requests wait and do not fail.
- Given NVD returns 403, 429 or 503, then the client backs off and retries; after 3 failures the job fails with "NVD is busy. We'll try again later."
- Given `NVD_API_KEY` is set, then it is sent in the request header and never written to logs.
- Given the tests, then they use recorded fixtures and never call NVD.

**P5-2 (M) Product search.** As a home user, I want to type "xbox" and pick the right product, so that the version can be matched.
- Given I type a product name on Add a device, then up to 8 matching products are shown as radio options with title and vendor, plus "Other (not in the list)".
- Given the product is in the `CpeProduct` cache, then results appear at once, without waiting for NVD.
- Given the product is not cached, then the UI shows "Searching…"; the worker fills the cache through a job (Decision D6). If results take more than about 10 seconds, the UI says "Search is taking longer than usual. Try again in a minute."
- (C) Given NVD lists example versions for a product, then the option shows the latest one as a hint.

**P5-3 (M) Version comparison (`version.rs`).** As the team, we want version checks to be right, so that findings are trustworthy.
- Given versions such as `10.0.26100`, `3.1.2`, `2.0` and `1.2.3-beta`, when compared, then numeric parts are compared in order and a pre-release sorts before its release.
- Given a version that cannot be compared (for example `unknown` or `beta build xyz`), then the component is treated as Not tracked with the text "We can't compare this version."
- Given the unit tests, then every example in the table passes.

**P5-4 (M) CPE range matching (`cpe.rs`).** As the team, we want the NVD configuration rules applied correctly, so that the right CVEs are shown.
- Given a configuration with `versionStartIncluding`, `versionEndExcluding`, `versionEndIncluding` or an exact version, when the device version is inside the range, then the CVE matches; outside, it does not.
- Given a version field of `*`, then it matches any version; `-` matches nothing.
- Given the unit tests, then they run on recorded NVD JSON fixtures.

**P5-5 (M) MATCH_CPE job and device status.** As a home user, I want the app to tell me what is wrong with a device, so that I know what to do.
- Given a device with a CPE and a version, when MATCH_CPE runs, then one Finding is written for each matching CVE, the CVE is cached in `Vulnerability`, and the device status follows section 5 (CRITICAL, VULNERABLE, UPDATE_AVAILABLE, NO_KNOWN_VULNS or NOT_TRACKED).
- Given a re-check where a CVE no longer matches, then its finding is removed. Ignored findings keep their state if they still match.
- Given no matching CVEs, then the device shows "No known vulnerabilities" with the line "Checked against NVD on <date>. This does not mean the device is safe."

**P5-6 (M) CISA KEV import.** As a home user, I want to know when a problem is already being used by attackers, so that I can act first.
- Given the CISA Known Exploited Vulnerabilities list is imported, when a cached CVE is on it, then `Vulnerability.exploited` is true and the affected device is CRITICAL.
- Given the import fails, then the previous list is kept and the app shows "Known exploited list is N days old."
- Daily timing is in P8-2.

**P5-7 (M) Result on Add a device.** As a home user, I want to know what happens after I save, so that I'm not surprised.
- Given I have picked a product and entered a version, then the Result card shows the name, product and version with "We'll check this after you save." (no CVE count before saving; Decision D9).
- Given I picked "Other", then the Result card says "Not tracked".
- Given the device is saved and the check finishes, then the device shows its result: "N known problems", "No known vulnerabilities" or "Not tracked".
- Done when: a known vulnerable product and version shows the expected CVEs, and an unknown product shows "Not tracked".

---

## Phase 6: SBOM upload to Trivy

**P6-1 (M) Trivy in the worker.** As the team, we want Trivy to have its vulnerability data, so that SBOM scans work.
- Given the worker starts with an empty `trivy-cache` volume, when it runs, then UPDATE_TRIVY_DB runs once and logs success.
- Given the update fails, then the existing cache is used and the device or settings page shows "Scanner data is from <date>."

**P6-2 (M) SBOM parsing (`sbom.rs`).** As a home user, I want my PC's software list read from its file, so that every part is checked.
- Given a CycloneDX JSON file, when it is parsed, then each component becomes a Component with name, version, vendor and purl.
- Given an SPDX JSON file, when it is parsed, then the same fields are filled, with purl from the external references.
- Given a file that is neither, then the upload is refused with "This isn't a CycloneDX or SPDX file. Export it as JSON and try again."
- Given a file over `MAX_SBOM_MB` (default 20), then it is refused before it is stored: "This file is larger than 20 MB."

**P6-3 (M) Upload on device detail.** As a home user, I want to drop an SBOM file onto a device, so that its software is checked.
- Given the device page, then a "Software on this device" card with FileDrop is shown for any device type (Decision D15).
- Given a valid file is dropped, when upload finishes, then the device shows "Checking…" and a SCAN_SBOM job is queued.
- Given a second file is uploaded, then only the SBOM components are replaced; the manual product match stays (Decision D16).
- Given the device is deleted, then the stored SBOM is deleted too.

**P6-4 (M) Trivy scan and mapping (`trivy.rs`).** As a home user, I want the real problems listed, so that I can fix them.
- Given a SCAN_SBOM job, when `trivy sbom` runs with no DB download, then its JSON output is parsed and each vulnerability becomes a Finding (source `trivy`) with severity and fixed version, and the device status is recalculated.
- Given Trivy finds nothing and every part has a purl and version, then the device shows "No known vulnerabilities" with the "checked" line from P5-5.
- Given Trivy fails, then the device shows "We couldn't check this file. Try again." (status ERROR).
- Given the tests, then they use Trivy JSON fixtures and never run a real scan.

**P6-5 (M) Software list.** As a home user, I want to see each program and its status, so that I know which part is the problem.
- Given a device with components, then the card lists each name, version and status (icon and text).
- Given some parts have no purl or no version, then the card shows "N parts not checked" with a plain reason (Decision D7).

**P6-6 (M) How to make an SBOM help panel.** As a home user, I want a simple guide for making the file, so that I can do it without help.
- Given the SBOM card, when I open "How do I make this file?", then a static panel shows the steps for Windows, macOS and Linux, with one command each for syft, and a link to syft's docs.
- Given the panel, then it is text only: the app does not run syft (Decision D5).
- Given the copy, then the title and steps use plain words and the ux-designer has written the exact commands.

---

## Phase 7: Vulnerability views and dashboard

**P7-1 (M) "What to do" card.** As a home user, I want one clear next step per device, so that I know what to do.
- Given a device with open findings, then a card with a border in the risk color says "Update <device> to <fixed version>" when a fixed version is known, otherwise "Check the maker's website for an update."
- Given the card, then it shows generic steps for the device type, and an "I've updated it" button.
- Given "I've updated it", then the version edit dialog opens, and after save a Check again runs.
- Given a device with no findings, then the card says "No known vulnerabilities" (or "Not tracked"), never a green "safe" card.

**P7-2 (M) Known vulnerabilities list.** As a home user, I want the problems on one device listed worst first, so that I can see the risk.
- Given a device with findings, then "Known vulnerabilities · N" lists them worst first (CVSS, then exploited first).
- Each item shows the score square, the CVE ID (mono), RiskBadge, an "Exploited in the wild" badge if KEV, a plain title, a short summary and "Fixed in <version>" or "No fix known yet."
- Each item links to its CVE page.

**P7-3 (M) CVE detail page.** As a home user, I want to read about one problem, so that I can decide what to do.
- Given `/vulnerabilities/CVE-…` for a CVE on my devices, then the page shows the title "Security problem in <product>", score, exploited badge, the first two sentences of the NVD summary, affected devices (links), the fixed version, and "Full details on NVD" (opens in a new tab with `rel="noopener"`) (Decision D11).
- Given a CVE that is not on any of my devices, then I see "None of your devices has this problem." (404 style).

**P7-4 (M) Vulnerabilities list.** As a home user, I want all open problems in one table, so that I can work through them.
- Given `/vulnerabilities`, then a table of open findings across my devices is shown, worst first, with device, problem, RiskBadge and fixed version.
- Given I filter by device or level, then the table filters and the filters stay in the URL.
- Given no open findings, then the page says "No known vulnerabilities on your devices right now." and, if any device is Not tracked or not fully checked, "N devices can't be fully checked."
- On a phone, the table scrolls inside its box.

**P7-5 (M) Ignore and reopen a finding.** As a home user, I want to mark a problem as not relevant to me, so that my status is accurate.
- Given an open finding, when I choose Ignore and enter a reason of 1 to 200 characters (for example "Not exposed to the internet"), then the finding moves to Ignored with the reason and the device status is recalculated without it.
- Given an empty reason, then the Ignore button is disabled with "Add a short reason."
- Given an ignored finding, when I choose Reopen, then it returns to open and the status is recalculated.

**P7-6 (M) My home summary and worst-device banner.** As a home user, I want the first screen to tell me if I need to act, so that I don't have to read every device.
- Given my devices, then NetworkSummary shows one headline, a stacked bar with counts per level, and "checked N hours ago" (latest check).
- Headlines: "1 device needs fixing now" (critical), "N devices are vulnerable", "Some updates are waiting" (update), "No known problems on your devices" (none), with "N devices can't be fully checked" when that applies. The word "safe" is not used (Decision D4).
- Given at least one critical device, then a critical Banner names the worst one with "Fix now" linking to its detail page.

---

## Phase 8: Scheduling and settings

**P8-1 (M) Daily scanner update and rescan.** As a home user, I want new problems found without any action, so that I'm protected while I'm not looking.
- Given `RESCAN_CRON` (default `0 3 * * *`) fires, then UPDATE_TRIVY_DB runs and then RESCAN_ALL queues a check for every device.
- Given a device whose result did not change, then its status stays and its "checked" time updates.
- Given an invalid `RESCAN_CRON`, then the worker refuses to start and logs a plain message naming the variable.

**P8-2 (M) Refresh CVE details and KEV.** As a home user, I want CVE details kept current, so that scores and fixes are right.
- Given a cached CVE is older than 7 days, when a check runs, then its NVD details are fetched again within the rate limit.
- Given the KEV list is imported daily, when a CVE becomes exploited, then affected devices are recalculated.
- Given a CVE score changes, then the affected device's level changes at the next check.

**P8-3 (M) Settings: Account.** As a home user, I want to change my password, so that I stay in control of my account.
- Given I open Settings, then Account shows my email and a "Change password" form (current password, new password of 12+ characters).
- Given a wrong current password, then I see "That's not your current password."
- Given a successful change, then my other sessions are signed out.
- Then no Household or Users section is shown (Decision D1).

**P8-4 (M) Settings: Checks.** As a home user, I want to see when the scanner last ran and run it now, so that I trust the results.
- Given I open Settings > Checks, then a status card shows "The scanner is on", the last check, the next check, the age of the scanner data, and NVD status ("Using an API key" or "No API key (slower)").
- Given the schedule and API key are set in `.env`, then the page shows them as read-only with the text "Set in .env" (Decision D12).
- Given the recent checks, then a table shows the last 10 jobs: time, what (device name or "All devices") and result (icon and text).
- Given "Check all now", then RESCAN_ALL is queued and the button is disabled while it runs.
- Then there is no pause button and no network scanner (Decision D2).

**P8-5 (C) Stale data notes.** As a home user, I want to know when results are old, so that I don't rely on them.
- Given a device or CVE page with data older than 7 days, then it shows "Last checked N days ago. Check again to update."
- Given NVD cannot be reached, then the app keeps the last results and shows "Couldn't reach NVD. Showing results from <date>."

---

## Phase 9: Packaging for the NAS

**P9-1 (M) Web image.** As the person who runs the app, I want one image that just works, so that setup is short.
- Given the Dockerfile, when built, then the image runs from Next.js standalone output for `linux/amd64` and `linux/arm64`, and runs as a non-root user.
- Given the container starts, then `prisma migrate deploy` runs before the server accepts traffic; if it fails, the container exits with the error.

**P9-2 (M) Worker image.** As the person who runs the app, I want the scanner built in, so that I don't install anything else.
- Given the Dockerfile, then the worker is a static musl build with the Trivy binary, for `linux/amd64` and `linux/arm64`.
- Given the container starts, then it logs "ready".

**P9-3 (M) Compose file.** As the person who runs the app, I want `docker compose up -d` to be the whole install, so that setup is one step.
- Given a clean machine and a filled `.env`, when I run `docker compose up -d`, then all three services are healthy within 2 minutes and the sign-in page opens on port 3000.
- Given a container stops, then Docker restarts it (`restart: unless-stopped`).
- Given `docker compose down` (without `-v`), then `db-data` and `trivy-cache` are kept.

**P9-4 (M) Health and config checks.** As the person who runs the app, I want clear errors when config is wrong, so that I can fix it quickly.
- Given `/api/health`, then it returns 200 only when the database answers; compose uses it for the healthcheck.
- Given `BETTER_AUTH_SECRET` is missing or shorter than 32 characters, then the web container refuses to start and says so in plain words.

**P9-5 (M) Memory budget.** As the person who runs the app, I want it to fit a small NAS, so that other things keep running.
- Given the stack is idle with no check running, then total memory use is under 512 MB, measured with `docker stats` and noted in the README.

**P9-6 (M) Reset password from the host.** As the person who runs the app, I want to reset a forgotten password, so that I'm not locked out.
- Given the README, when I run the documented command with an email on the NAS, then that account's password is set to the new value and its sessions are signed out.
- Given an email with no account, then the command says "No account with that email."
- Then the sign-in page has no "Forgot password?" link (Decision D13).

**P9-7 (M) README.** As the person who runs the app, I want written steps, so that I can install, update and back up without help.
- Covers: install, update (pull and `up -d`; migrations run on start), backup and restore (`pg_dump`), reset password (P9-6), disk need (about 1 GB for the Trivy data), optional NVD key, and how to turn off sign-up.
- Done when: someone who did not write it follows it on a clean machine.

**P9-8 (M) End-to-end happy paths.** As the team, we want the main flows tested on the real stack, so that releases are safe.
- Playwright, run against `docker compose`:
  1. Sign up, add a device with a known vulnerable product and version, see the CVEs.
  2. Upload a CycloneDX SBOM, see the components and findings.
  3. Add a device with an unknown product, see "Not tracked".
  4. A second user cannot see the first user's devices.
- No real NVD or Trivy DB calls: fixtures or a stub.

**P9-9 (M) Security review.** As the team, we want a review before release, so that known holes are fixed first.
- The security-researcher reviews auth, per-user access, upload handling, and job inputs.
- Every must-fix finding is fixed by the owning engineer before the release tag.

---

## Phase 10: Design polish

**P10-1 (C) Design comparison pass.** Compare each screen with `docs/design/homeguard/screens/` (light, dark, mobile). Record deltas in `docs/design/` and plan section 9.

**P10-2 (M) Empty, loading and error states, consistency pass.** Empty, loading and error states are built with each feature (they are in the stories above). This phase only checks that the wording and style match across pages.

**P10-3 (C) Accessibility check.** Contrast, focus, 44 px targets and icon-plus-text on every risk. Run an automated accessibility check on the main pages. (Icon-plus-text and focus rules are already in P2-3 and P3-2, so this is mostly a check.)

---

## Later (not in V1)

- Network discovery, "Scan my network", found devices, IP addresses, default-password checks (non-goal, plan section 1).
- Notifications: email, push, quiet hours, per-device alerts, the Notifications page (non-goal).
- Household with several people, roles (Owner, Admin, Member, Viewer), invites, 2-step sign-in for admins.
- Passkey sign-in.
- Forgot password by email (needs email sending).
- Automatic version detection on devices.
- Vendor-specific "What to do" steps.
- Vendor security advisories as another source.
- A "latest version" source for the arrow in VersionTag.
- Dark mode toggle (V1 follows the system).
- Editing the rescan schedule and the NVD key in the UI (V1 uses `.env`).
- Pausing scans.
- Hand-written plain titles for each CVE.
- Translations.
- Policies, projects, teams and audit workflows (non-goal).

---

## Decisions

Decisions for V1 made by the product owner under the user's delegation. Each one is a one-line why. Plan section 13 points here.

| ID | Question | Decision | Why |
|----|----------|----------|-----|
| D1 | One shared household account or one account per person? | Per user. No household, roles or invites in V1. Every device query filters by `userId`. | Roles are a permission model nobody needs yet; keeps the access rule simple. |
| D2 | Network discovery in V1? | No. Later. | Non-goal (section 1); needs network access and scanning rights, and the core value does not need it. |
| D3 | Notifications in V1? | No. Hide the nav item and the per-device alert switch. | Non-goal (section 1); needs email or push services. |
| D4 | Design says "Up to date" and "Not checked"; plan says "No known vulnerabilities" and "Not tracked". Which? | Plan wording. The green level never says "safe" or "Up to date"; the headline "Safe, with updates waiting" becomes "Some updates are waiting". The ux-designer records the change in `docs/design/`. | NVD data cannot prove a device is safe. |
| D5 | Offer an SBOM how-to in the UI? | Yes. A text-only help panel on the SBOM card (P6-6). The app does not run syft. | The user needs help making the file; a generator would be another tool to maintain. |
| D6 | Who calls NVD for product search? | Only the worker. Search reads the `CpeProduct` cache; a miss queues a worker job and the UI polls. This overrides plan section 10 Phase 5 ("web calls NVD directly"). | CLAUDE.md says NVD calls stay in the worker; one place to respect rate limits. Architect to confirm the wait in an ADR. |
| D7 | A device with some parts checked and some not (SBOM). | Status can be "No known vulnerabilities", with the line "N parts not checked". "Not tracked" only when no part can be checked. | "Not tracked" for every PC would be useless; a bare "No known vulnerabilities" would hide gaps. |
| D8 | A version we cannot compare (e.g. "unknown"). | That component is Not tracked, with "We can't compare this version." | Never guess a version match. |
| D9 | Live Result card on Add a device. | Shows the entered data and "We'll check this after you save." No CVE count before save. Design change for the ux-designer. | Checks run in the worker, not in the request. |
| D10 | Which levels are "Needs attention"? | Critical and Vulnerable. | These are the levels that say "fix this now" in the plan. |
| D11 | CVE titles "rewritten in plain words" (section 9). | Not hand-written. Show "Security problem in <product>" and the first two sentences of the NVD summary; full text behind the NVD link. Supersedes section 9. | Writing copy for every CVE is not possible for a small team. |
| D12 | Rescan schedule, NVD key and pause in the UI. | Schedule and key are `.env` only, shown read-only in Settings > Checks. No pause button. | No secrets in the database; one less UI to build. |
| D13 | Forgot password. | No link in V1. Reset with a host command (P9-6). | No email sending in V1. |
| D14 | Passkey and "Keep me signed in". | Hidden in V1. | Passkey is planned later (section 9); session length is the default. |
| D15 | "PC with an SBOM file" as a fifth device type (section 9). | No. Keep the 15 `DeviceType` values. The SBOM card is on any device's page. Supersedes the section 9 row. | An SBOM is a way of giving data, not a kind of device. |
| D16 | SBOM upload and the manual product match. | An upload replaces only SBOM components; the manual product stays. | Keeps the CPE match; upload does not lose data. |
| D17 | How do jobs get picked up? | LISTEN plus a 30 second poll. | A missed notify must not leave a check stuck. |
| D18 | Retries and timeouts. | Max 3 attempts; wait 1 minute, then 5 minutes; job timeout 10 minutes. | Simple, and gentle on NVD. |
| D19 | Password rules and error text. | Minimum 12 characters. Sign-in and sign-up errors are generic. | No email recovery in V1, so a stronger minimum; generic errors do not reveal accounts. |
| D20 | Dark mode. | Follows the system setting; no toggle in V1. | Tokens already support it; a toggle is extra UI. |
| D21 | The `/ui` dev page. | Development builds only (404 in production). | Keeps dev pages out of the NAS install. |
| D22 | Ignore reason length. | 1 to 200 characters, required. | A short reason is the plan's intent; long text is not needed. |
| D23 | Scanner data when the update fails. | Keep the old data and show its date. | Works on a NAS with flaky internet. |
| D24 | Worker timing and schedule. | Daily update and rescan at `RESCAN_CRON` (03:00 by default). | Matches the plan; one daily window keeps NVD calls low. |

Open items from plan section 13 are all decided above (D1 to D5). Plan section 9 rows changed here (D4, D11, D15) are to be recorded by the ux-designer.

---

## V1 definition of done

A user can set up the app with `docker compose up -d` and use it.

**Install and run**
- [ ] On a clean `linux/amd64` machine, and on `linux/arm64`, `docker compose up -d` gives a working sign-in page on port 3000 within 2 minutes.
- [ ] Idle memory use is under 512 MB (recorded in the README).
- [ ] The README was followed by someone who did not write it.

**Account**
- [ ] The first account can be created; with `ALLOW_SIGNUP=false` no new account can be created.
- [ ] Sign in, sign out, and protected pages redirect when signed out.
- [ ] A second user cannot see or change the first user's devices.
- [ ] The password can be reset from the host.

**Devices and checks**
- [ ] Add a device with a known vulnerable product and version: the expected CVEs appear with a plain level.
- [ ] Add a device with an unknown product: it shows "Not tracked", never a green level.
- [ ] Upload a CycloneDX SBOM and an SPDX SBOM: the components and findings appear.
- [ ] Device, then CVE, then the NVD link, in three clicks.
- [ ] Ignore and reopen a finding: the device status updates.
- [ ] "Check again" and "Check all now" work and show progress.
- [ ] The daily Trivy data update and CVE refresh run on schedule.

**Honesty and wording**
- [ ] The word "safe" and the label "Up to date" appear nowhere in the UI.
- [ ] Every "No known vulnerabilities" also shows when it was checked and that it does not mean "safe".
- [ ] Every risk shows an icon and text.

**Quality**
- [ ] `cargo test` and `cargo clippy -- -D warnings` pass; Vitest passes; the Playwright happy paths pass against `docker compose`.
- [ ] No real NVD or Trivy calls happen in tests.
- [ ] The security review has no open must-fix items.
- [ ] Images for `amd64` and `arm64` are published with a version tag.

### Minimum cut if time is short
- **Must (ship):** every M story in phases 0 to 9. This includes the security review (P9-9) and the README (P9-7).
- **Could (cut first, in this order):** P10-1 (design comparison), P10-3 (accessibility check beyond the rules built into P2-3 and P3-2), P8-5 (stale-data notes), P3-3 (search chips; keep plain search), P5-2 example versions.
- **Do not cut:** the "Not tracked" wording and the "No known vulnerabilities" caveat. They are the product's honesty guarantee.
- **Note:** the empty, loading and error states are built into each feature story, so P10-2 is only a consistency check. If the team cuts a feature, cut its states with it.
