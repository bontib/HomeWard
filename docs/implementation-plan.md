# Implementation plan: Home Vulnerability Tracker

A simple, self-hosted tool for home users. You add the devices in your home (Xbox, PlayStation, PC, TV, smart home gear) with their software version, or upload an SBOM for a PC. The app shows which known vulnerabilities (CVEs) affect them.

Think "OWASP Dependency-Track", but small, friendly and made for a home network. It runs on a NAS with one `docker compose up`.

---

## 1. Goals and non-goals

**Goals**
- Add a device in under a minute: pick a type, name it, find the product, enter the version.
- Upload a CycloneDX or SPDX SBOM to a device and see every component and its vulnerabilities.
- Show clearly per device: *vulnerable*, *no known vulnerabilities*, or *not tracked* (no public data).
- Scan with Trivy. Use NVD for CVE details and for devices without an SBOM.
- Rescan automatically when new CVEs are published.
- Run on a small NAS (amd64 and arm64) with three containers.

**Non-goals (for v1)**
- Network discovery or active scanning of devices.
- Automatic version detection on devices.
- Policies, projects, teams, or audit workflows like Dependency-Track.
- Notifications (email, push). Planned for later.
- Translations. UI text is English, written so it can be translated later.

---

## 2. Architecture

```
            browser
               │
     ┌─────────▼──────────┐        ┌──────────────────────────┐
     │  web (Next.js)     │        │  worker (Rust)           │
     │  UI + API routes   │        │  job runner              │
     │  Better Auth       │        │  ├─ Trivy (SBOM scans)   │
     │  Prisma            │        │  ├─ NVD client (CPE/CVE) │
     └─────────┬──────────┘        │  └─ scheduler            │
               │   jobs table +    └────────────┬─────────────┘
               │   LISTEN/NOTIFY                │
           ┌───▼────────────────────────────────▼───┐
           │             PostgreSQL                 │
           └────────────────────────────────────────┘
```

### Containers (docker compose)
| Service  | Image                       | Purpose                                         |
|----------|-----------------------------|-------------------------------------------------|
| `web`    | Next.js standalone build    | UI, API, auth, runs `prisma migrate deploy` on start |
| `worker` | Rust binary + Trivy binary  | Scans, CVE matching, scheduled jobs             |
| `db`     | `postgres:17-alpine`        | All data                                        |

Volumes: `db-data` (Postgres), `trivy-cache` (Trivy vulnerability DB).
No Redis, no message broker: Postgres is the queue.

### Who does what
- **Next.js** owns the user experience, auth, validation and the database schema (Prisma migrations).
- **Rust worker** does everything slow or heavy: parsing SBOMs, running Trivy, calling NVD, matching versions against CPE ranges, scheduled rescans.
- They talk only through the database. Next.js inserts a row in `Job` and calls `pg_notify('jobs', id)`. The worker listens, claims the job with `SELECT … FOR UPDATE SKIP LOCKED`, and writes results back.

### Why two scan paths
Trivy matches packages by ecosystem (npm, pip, Debian, Windows KB, …). That covers SBOMs. It does **not** know consumer firmware like "Xbox system software 10.0.x".
For those devices we use the **NVD CPE** data: the user picks a product (CPE), enters a version, and the worker checks that version against the CVE configurations in NVD.

| Device input        | Scanner | Match key       |
|---------------------|---------|-----------------|
| SBOM upload         | Trivy   | purl / package  |
| Manual product + version | NVD (in worker) | CPE + version range |

Honest limitation to show in the UI: NVD coverage of consumer devices is thin and vendor version numbers often do not match CPE versions. So "no known vulnerabilities" must never look like "safe". When a product has no CPE, the device is shown as **Not tracked**.

---

## 3. Tech stack

| Area             | Choice                                           |
|------------------|--------------------------------------------------|
| Web framework    | Next.js (App Router, latest stable), TypeScript strict |
| Auth             | Better Auth, email + password, Prisma adapter    |
| ORM / DB         | Prisma ORM (latest), PostgreSQL 17               |
| State            | Redux Toolkit + RTK Query                        |
| Validation       | Zod (shared between API routes and forms)        |
| Styling          | Tailwind CSS with design tokens as CSS variables |
| UI primitives    | Radix UI primitives, wrapped in our own components |
| Worker           | Rust (stable), tokio, sqlx, reqwest, serde, tracing, thiserror/anyhow |
| Scanner          | Trivy (binary inside the worker image)           |
| CVE data         | NVD API 2.0 (optional API key for higher rate limits) |
| Tests            | Vitest (web), `cargo test` (worker), Playwright for a few happy paths |

### State management rules
- **Server data** (devices, findings, CVEs, job status) → RTK Query. Mutations invalidate tags; scan status is polled while a job runs.
- **UI state that crosses components** (filters, selected severity, open dialogs) → small Redux slices.
- **Local state** (form inputs, a toggle) → `useState` / form library. Not Redux.
- Pages are thin server components that check the session and render a client feature component.

---

## 4. Repository layout

```
/
├─ CLAUDE.md
├─ docker-compose.yml
├─ .env.example
├─ docs/
│  └─ implementation-plan.md
├─ web/                         Next.js app
│  ├─ prisma/schema.prisma
│  ├─ src/app/
│  │  ├─ (auth)/login, signup
│  │  ├─ (app)/                 protected layout
│  │  │  ├─ page.tsx            dashboard
│  │  │  ├─ devices/            list, new, [id]
│  │  │  ├─ vulnerabilities/    list, [cveId]
│  │  │  └─ settings/
│  │  └─ api/                   route handlers (+ api/auth/[...all])
│  ├─ src/components/ui/        design system: Button, Card, Badge, …
│  ├─ src/features/<feature>/   feature components, slice, RTK Query endpoints
│  ├─ src/store/                store, typed hooks, base api
│  ├─ src/server/               data access + business logic (used by API routes)
│  └─ src/lib/                  auth, db client, jobs, validation schemas
└─ worker/                      Rust crate
   └─ src/
      ├─ main.rs                start up, listen, run loop
      ├─ config.rs
      ├─ db.rs
      ├─ jobs/                  one file per job type
      ├─ trivy.rs               run Trivy, parse JSON
      ├─ nvd.rs                 NVD API client with rate limit
      ├─ sbom.rs                CycloneDX / SPDX parsing
      ├─ cpe.rs                 CPE parse + configuration matching
      └─ version.rs             lenient version compare
```

---

## 5. Data model (Prisma, first version)

Better Auth tables (`User`, `Session`, `Account`, `Verification`) are generated by Better Auth.

```prisma
enum DeviceType   { CONSOLE PC LAPTOP PHONE TABLET TV ROUTER NAS SMART_HOME OTHER }
enum DeviceStatus { VULNERABLE NO_KNOWN_VULNS NOT_TRACKED SCANNING ERROR }
enum Severity     { CRITICAL HIGH MEDIUM LOW UNKNOWN }
enum FindingState { OPEN IGNORED }
enum JobType      { SCAN_SBOM MATCH_CPE RESCAN_ALL UPDATE_TRIVY_DB }
enum JobStatus    { QUEUED RUNNING DONE FAILED }

model Device {
  id          String       @id @default(cuid())
  userId      String
  name        String                     // "Living room Xbox"
  type        DeviceType
  status      DeviceStatus @default(SCANNING)
  notes       String?
  lastScanAt  DateTime?
  components  Component[]
  sboms       Sbom[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}

model Component {                         // a piece of software on a device
  id        String   @id @default(cuid())
  deviceId  String
  name      String
  version   String?
  vendor    String?
  purl      String?                       // from SBOM
  cpe       String?                       // from product search or SBOM
  source    String                        // "manual" | "sbom"
  findings  Finding[]
}

model Sbom {
  id         String   @id @default(cuid())
  deviceId   String
  format     String                       // "cyclonedx" | "spdx"
  fileName   String
  content    Bytes                        // raw file, keeps backups to one volume
  uploadedAt DateTime @default(now())
}

model Vulnerability {                     // cache of CVE details
  id          String    @id               // "CVE-2024-12345"
  severity    Severity
  cvssScore   Float?
  cvssVector  String?
  summary     String
  publishedAt DateTime?
  references  Json
  fetchedAt   DateTime
  findings    Finding[]
}

model Finding {
  id              String       @id @default(cuid())
  componentId     String
  vulnerabilityId String
  fixedVersion    String?
  state           FindingState @default(OPEN)
  source          String                  // "trivy" | "nvd"
  firstSeenAt     DateTime     @default(now())
  @@unique([componentId, vulnerabilityId])
}

model Job {
  id         String    @id @default(cuid())
  type       JobType
  payload    Json
  status     JobStatus @default(QUEUED)
  attempts   Int       @default(0)
  runAfter   DateTime  @default(now())
  error      String?
  createdAt  DateTime  @default(now())
  finishedAt DateTime?
  @@index([status, runAfter])
}

model CpeProduct {                        // cache for the product search
  cpe       String   @id                  // cpe:2.3:o:microsoft:xbox_one_firmware
  vendor    String
  product   String
  title     String
  fetchedAt DateTime
}
```

Rules:
- Every device query filters on `userId`. A user only sees their own devices.
- Prisma owns migrations. The worker uses `sqlx` with runtime queries and never changes the schema.
- Device `status` is derived by the worker after each scan: any open finding → `VULNERABLE`; components without a CPE or purl → `NOT_TRACKED`; otherwise `NO_KNOWN_VULNS`.

---

## 6. Main flows

### Add a device manually
1. User picks a device type (big icon buttons), types a name.
2. User searches the product ("xbox"). Web calls `GET /api/products?q=` → served from `CpeProduct` cache, otherwise from NVD CPE API, then cached.
3. User enters the version and saves. If no product fits, they can save it as "not tracked".
4. Web creates `Device` + one `Component`, inserts a `MATCH_CPE` job, notifies.
5. Worker fetches all CVEs for that CPE product (cached per product), checks the version against each configuration range in `cpe.rs` / `version.rs`, and writes `Finding` + `Vulnerability` rows.

### Upload an SBOM
1. On a device page, user drops a CycloneDX/SPDX JSON file (max size from env, default 20 MB).
2. Web checks format with a quick sniff, stores `Sbom`, inserts a `SCAN_SBOM` job.
3. Worker parses the SBOM into `Component` rows (replaces old SBOM components of that device), runs
   `trivy sbom --format json --scanners vuln --skip-db-update --quiet <file>`, maps results to findings.
4. UI polls job status and refreshes the device when done.

### Keep results fresh
- `UPDATE_TRIVY_DB` daily (`trivy image --download-db-only`), then `RESCAN_ALL`.
- `RESCAN_ALL` queues a scan for every device. Time is configurable (default 03:00).
- Worker re-fetches NVD details for CVEs older than 7 days, respecting NVD rate limits (5 req / 30 s without key, 50 with key).

### Findings
- User can **ignore** a finding with a short reason ("Not exposed to the internet"). Ignored findings do not count towards the device status.

---

## 7. API (route handlers)

| Method | Path                              | Purpose                          |
|--------|-----------------------------------|----------------------------------|
| GET    | `/api/devices`                    | List devices with counts         |
| POST   | `/api/devices`                    | Create manual device             |
| GET    | `/api/devices/:id`                | Device with components + findings |
| PATCH  | `/api/devices/:id`                | Rename, change version, notes    |
| DELETE | `/api/devices/:id`                | Delete device                    |
| POST   | `/api/devices/:id/sbom`           | Upload SBOM                      |
| POST   | `/api/devices/:id/scan`           | Rescan now                       |
| GET    | `/api/products?q=`                | Product (CPE) search             |
| GET    | `/api/vulnerabilities`            | All findings across devices, filterable |
| GET    | `/api/vulnerabilities/:cveId`     | CVE detail + affected devices    |
| PATCH  | `/api/findings/:id`               | Ignore / reopen                  |
| GET    | `/api/jobs/:id`                   | Job status                       |
| GET    | `/api/health`                     | Health check for Docker          |

Every handler: check session → validate input with Zod → call a function in `src/server/` → return JSON. No business logic in route files.

---

## 8. Pages

| Page                  | Content                                                       |
|-----------------------|---------------------------------------------------------------|
| Login / Sign up       | Email + password. Sign up can be disabled with `ALLOW_SIGNUP=false`. |
| Dashboard             | Counts by severity, devices that need attention, last scan time. |
| Devices               | Grid of device cards with icon, name, version, status badge. Filter by type/status. |
| Add device            | Two tabs: "Enter version" and "Upload SBOM".                  |
| Device detail         | Header with status, list of software, list of vulnerabilities, rescan button. |
| Vulnerabilities       | Table of all open findings, sorted by severity, filter by device/severity. |
| Vulnerability detail  | Plain-language summary, score, affected devices, fixed version, link to NVD. |
| Settings              | Account, NVD API key, rescan time, Trivy DB status.           |

Wording: short and plain. "Update to 10.0.26100 to fix this" instead of jargon. Always link to the NVD page for the full detail.

---

## 9. Design system (placeholder until designs arrive)

Build components against tokens, so the final designs mostly change token values.

- **Tokens** (CSS variables on `:root`, dark mode under `[data-theme="dark"]`): colors (background, surface, text, muted, border, accent), severity colors (critical, high, medium, low, unknown, none), radius, spacing scale, font sizes.
- **Primitives** (`src/components/ui/`): `Button`, `IconButton`, `Input`, `Select`, `Combobox`, `Textarea`, `Card`, `Badge`, `Table`, `Tabs`, `Dialog`, `Tooltip`, `Spinner`, `EmptyState`, `PageHeader`, `FileDrop`.
- **Domain components**: `SeverityBadge`, `DeviceStatusBadge`, `DeviceIcon`, `DeviceCard`, `StatCard`, `FindingRow`, `ProductSearch`, `ScanProgress`.
- Status always uses color **and** an icon + text (accessible, colorblind-safe).

---

## 10. Phases

Each phase ends with something that runs. Keep PRs small.

### Phase 0: Scaffolding
- `web/`: Next.js + TypeScript strict, ESLint, Prettier, Tailwind, Vitest.
- `worker/`: cargo crate, clippy + rustfmt, tracing.
- `docker-compose.yml` with `db` only (for development) + `.env.example`.
- **Done when:** `npm run dev` shows a page, `cargo run` connects to the database and logs "ready".

### Phase 1: Auth
- Better Auth with Prisma adapter, email + password.
- `(auth)` pages, protected `(app)` layout, sign-out.
- `ALLOW_SIGNUP` env flag.
- **Done when:** a user can sign up, log in, log out; `(app)` routes redirect when signed out.

### Phase 2: Data model and UI base
- Prisma schema from section 5, first migration.
- Tokens + primitives from section 9 (simple placeholder styling).
- Redux store, typed hooks, RTK Query base api.
- App shell: sidebar/top nav, page header.
- **Done when:** the app shell renders with nav, and primitives render on a dev-only `/ui` page.

### Phase 3: Devices (no scanning yet)
- `src/server/devices.ts`, API routes, RTK Query endpoints.
- Devices list, add device (manual, free-text product), device detail, edit, delete.
- **Done when:** a user can manage devices and never sees another user's devices (test).

### Phase 4: Worker foundation
- Job claim loop with `SKIP LOCKED`, `LISTEN jobs`, retry with backoff (max 3 attempts), job timeout.
- `src/lib/jobs.ts` in web: `enqueueJob(type, payload)`.
- `/api/jobs/:id` + `ScanProgress` component that polls.
- **Done when:** a dummy job queued from the UI is picked up within a second and shown as done.

### Phase 5: Manual devices → NVD matching
- `nvd.rs`: client with rate limiter, optional API key, CPE search + CVE search by `virtualMatchString`.
- `/api/products` with `CpeProduct` cache. Web calls the NVD CPE search directly for this one lightweight, interactive lookup; all CVE work stays in the worker.
- `cpe.rs` + `version.rs`: match a version against configuration nodes (`versionStartIncluding`, `versionEndExcluding`, …). Heavily unit tested.
- `MATCH_CPE` job writes findings and device status.
- **Done when:** adding a known vulnerable product + version shows the expected CVEs; an unknown product shows "Not tracked".

### Phase 6: SBOM upload → Trivy
- Worker image includes Trivy; `UPDATE_TRIVY_DB` job; cache volume.
- `sbom.rs`: parse CycloneDX and SPDX JSON into components.
- `trivy.rs`: run Trivy, parse JSON, map to findings + vulnerabilities.
- Upload UI with `FileDrop`, size and format checks.
- **Done when:** uploading a CycloneDX SBOM of a test PC lists its components and vulnerabilities.

### Phase 7: Vulnerability views and dashboard
- Vulnerabilities list + detail, ignore/reopen finding.
- Dashboard with severity counts and "needs attention" list.
- **Done when:** a user can go from dashboard → device → CVE → NVD link in three clicks.

### Phase 8: Scheduling and settings
- Daily Trivy DB update + rescan; NVD detail refresh.
- Settings page: NVD API key, rescan time, Trivy DB date.
- **Done when:** new CVEs appear without user action after a rescan.

### Phase 9: Packaging for the NAS
- Multi-stage Dockerfiles for `web` (standalone output) and `worker` (static musl build + Trivy).
- Multi-arch images: `linux/amd64` and `linux/arm64`.
- Full `docker-compose.yml` with healthchecks, restart policies, volumes, one `.env`.
- README: install, update, backup (`pg_dump`), reset password.
- **Done when:** `docker compose up -d` on a clean machine gives a working app on port 3000; memory use stays under ~512 MB idle total.

### Phase 10: Apply final designs
- Map design tokens, restyle primitives and domain components, polish empty states and copy.

---

## 11. Testing

- **Worker:** unit tests for `version.rs`, `cpe.rs`, `sbom.rs`, Trivy JSON parsing (fixtures in `worker/tests/fixtures/`). Integration test against a test database for the job loop.
- **Web:** Vitest for `src/server/` functions and Zod schemas; component tests for domain components.
- **E2E (Playwright):** sign up → add device → see result; upload SBOM → see components.
- No real NVD calls in tests: use recorded fixtures.

---

## 12. Configuration (`.env`)

| Variable              | Default          | Meaning                              |
|-----------------------|------------------|--------------------------------------|
| `DATABASE_URL`        | —                | Postgres connection                  |
| `BETTER_AUTH_SECRET`  | —                | Required, random 32+ chars           |
| `BETTER_AUTH_URL`     | `http://localhost:3000` | Public URL of the app         |
| `ALLOW_SIGNUP`        | `true`           | Disable after creating accounts      |
| `NVD_API_KEY`         | empty            | Optional, raises NVD rate limit      |
| `RESCAN_CRON`         | `0 3 * * *`      | Daily rescan time                    |
| `MAX_SBOM_MB`         | `20`             | Upload size limit                    |

---

## 13. Risks and open questions

- **Consumer device coverage in NVD is thin.** Mitigated by the clear "Not tracked" status and honest wording. Later: allow adding vendor security advisories.
- **Version strings differ** between what a console shows and what NVD uses. The product search should show example versions from NVD where possible.
- **NVD rate limits / outages.** Everything is cached; the app works with stale data and shows "last updated".
- **Trivy DB size** (~1 GB unpacked over time) on small NAS disks. Document it.
- **Open:** one shared household account vs. one account per person? The plan assumes per-user devices with the option to disable sign-up.
- **Open:** should we offer an SBOM generation how-to (e.g. `syft` on Windows/Linux) in the UI? Probably yes, as a help panel in Phase 6.
