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
│  ├─ implementation-plan.md
│  └─ design/homeguard/         official designs: screens/*.png + source/ (tokens, markup)
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
enum DeviceType   { CONSOLE PC LAPTOP PHONE TABLET TV SPEAKER CAMERA PLUG BULB THERMOSTAT ROUTER DOORBELL PRINTER NAS OTHER }  // icons from the design
enum DeviceStatus { CRITICAL VULNERABLE UPDATE_AVAILABLE NO_KNOWN_VULNS NOT_TRACKED SCANNING ERROR }  // risk levels, section 9
enum Severity     { CRITICAL HIGH MEDIUM LOW UNKNOWN }
enum FindingState { OPEN IGNORED }
enum JobType      { SCAN_SBOM MATCH_CPE RESCAN_ALL UPDATE_TRIVY_DB }
enum JobStatus    { QUEUED RUNNING DONE FAILED }

model Device {
  id          String       @id @default(cuid())
  userId      String
  name        String                     // "Living room Xbox"
  type        DeviceType
  room        String?                    // "Living room"
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
  exploited   Boolean   @default(false)  // in the CISA KEV list
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

model VersionChange {                     // "Version history" on device detail
  id          String   @id @default(cuid())
  componentId String
  version     String
  changedAt   DateTime @default(now())
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
- Device `status` is derived by the worker after each scan, worst wins: open finding with CVSS ≥ 9.0 or `exploited` → `CRITICAL`; CVSS 4.0–8.9 → `VULNERABLE`; only lower or unscored findings → `UPDATE_AVAILABLE`; components without a CPE or purl, or without a version → `NOT_TRACKED`; otherwise `NO_KNOWN_VULNS`.

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

Layout, components and copy follow section 9 and the screenshots in `docs/design/homeguard/screens/`.

| Page                  | Route | Content                                                       |
|-----------------------|-------|---------------------------------------------------------------|
| Sign in / Sign up     | `/login`, `/signup` | Split layout from `01-sign-in`. Email + password. Sign up can be disabled with `ALLOW_SIGNUP=false`. |
| My home               | `/` | `02-my-home`: summary, critical banner, device grid with search and filter chips. Replaces the separate dashboard and device list. |
| Add device            | `/devices/new` | `04-add-device`: type → product → version → name & room, live result card. SBOM path added in Phase 6. |
| Device detail         | `/devices/[id]` | `03-device-detail`: "What to do", known vulnerabilities, facts, version history, software list + SBOM upload, check again. |
| Vulnerabilities       | `/vulnerabilities` | Not designed. Table of open findings, worst first, filter by device/level. |
| Vulnerability detail  | `/vulnerabilities/[cveId]` | Not designed. Plain summary, score, affected devices, fixed version, NVD link. |
| Settings              | `/settings/…` | Sub-nav like `05`–`07`: **Account** (replaces household & users in v1), **Checks** (from `07-settings-scanner`: rescan time, catalogue sources and age, NVD API key, Trivy DB date, recent checks). |

Wording: short and plain. "Update to 10.0.26100 to fix this" instead of jargon. Always link to the NVD page for the full detail.

---

## 9. Design system: "HomeGuard"

The official designs are in. Source: the design canvas "HomeGuard home network app" (https://claude.ai/artifact/SAvjn46s7smodZVMViweQj), copied into the repo:

| Path | What |
|------|------|
| `docs/design/homeguard/screens/*.png` | Screenshots of every screen: light (1280 wide), `-dark`, `-mobile` (390 wide) |
| `docs/design/homeguard/source/*.dc.html` | Screen markup (exact copy, spacing and wording) |
| `docs/design/homeguard/source/ds/homeguard/tokens.json` | Token spec with a usage note per token |
| `docs/design/homeguard/source/tokens.css` | Same tokens as CSS variables, light + dark |
| `docs/design/homeguard/source/app.css` | App shell, forms, switch, chips, tables, steps, sub-nav |
| `docs/design/homeguard/source/ds/homeguard/components/bundle.{js,css}` | Reference React components and their icon paths |

The designs show how the screens could look; they are not a strict spec. When they conflict with this plan, the plan wins, and the `ux-designer` agent adjusts the design and records the change here.

The `.dc.html` files are design references, not code to copy into `web/`. Rebuild them as our own components with Tailwind + tokens.

### Tokens
Copy `tokens.css` into `web/src/app/tokens.css` as-is and map them in the Tailwind theme. Light on `:root`, dark on `:root[data-theme="dark"]`; also follow `prefers-color-scheme` when the user has not chosen.

| Group | Tokens (light / dark) |
|-------|-----------------------|
| Surfaces | `surface-0` page `#f6f4ef`/`#121614`, `surface-100` cards `#ffffff`/`#1b201e`, `surface-200` subtle fills `#eeebe4`/`#242a27` |
| Lines | `line` hairlines `#dcd7cc`/`#333a37`, `line-strong` control borders (3:1) `#7f8780`/`#6d7672` |
| Text | `ink` `#1d2422`/`#edf0ee`, `ink-muted` `#5a6360`/`#a3aca8` |
| Brand (teal) | `brand` `#0e6b62`/`#4fc4b4`, `brand-hover`, `on-brand`, `brand-tint` `#dcefeb`/`#17322e` |
| Risk | `safe` `#1b7038`, `update` `#8a5a00`, `vulnerable` `#a8410c`, `critical` `#b3192b` (+ dark values), each with a `-tint` background; `on-critical`; `unknown` = `ink-muted` |
| Spacing | `space-1` 4, `space-2` 8, `space-3` 12, `space-4` 16, `space-6` 24, `space-8` 32 px |
| Radius | `radius-sm` 6 (inputs, version tag), `radius-md` 10 (buttons, icons, rows), `radius-lg` 16 (cards), `radius-pill` |
| Shadow | `shadow-card` (resting card), `shadow-raised` (hover, popovers) |

**Type:** Figtree (400/500/600/700) for text, JetBrains Mono 500 for versions, CVE IDs, scores and IPs (never for sentences). Self-host both with `next/font` so the NAS works offline.

| Style | Size / line height / weight | Use |
|-------|-----------------------------|-----|
| `display` | 32/38/700, -0.02em | One per screen: the network headline |
| `title` | 22/28/700, -0.01em (page h1 uses 28/34) | Screen titles, device name on detail |
| `heading` | 17/24/600 | Section headings, device name on cards |
| `body` | 15/22/400 | Default text |
| `label` | 13/18/600 | Buttons, badges, form labels |
| `caption` | 12/16/500, `ink-muted` | Metadata, timestamps, vendor |
| `mono` | 13/18/500 | Data only |

**Icons:** inline stroke SVG, 24×24 viewBox, 1.75 stroke, round caps and joins. Device and risk icon paths are in `bundle.js` (`DEVICE`, `RISK`); copy them into `DeviceIcon` / `RiskBadge`.

**Rules from the design:** touch targets ≥ 44 px (nav rows, inputs, icon buttons, checkbox rows); focus ring `2px solid brand`, offset 2; risk always shows icon + text; `critical` is used sparingly so it stays alarming.

### Risk levels (replaces the old severity/status badges)
The UI shows one of five risk levels per device and per CVE:

| Level | Label | Icon | Meaning in our data |
|-------|-------|------|---------------------|
| `critical` | Critical | octagon ! | An open finding with CVSS ≥ 9.0 or in the CISA KEV list |
| `vulnerable` | Vulnerable | triangle ! | An open finding with CVSS 4.0–8.9 |
| `update` | Update available | circle ↑ | A newer version is known, no open finding ≥ 4.0 |
| `safe` | Up to date → **we show "No known vulnerabilities"** | shield ✓ | `NO_KNOWN_VULNS` |
| `unknown` | Not checked → **we show "Not tracked"** | circle ? | `NOT_TRACKED` (no CPE/purl, or no version) |

We change the `safe` and `unknown` labels on purpose: "no known vulnerabilities" is not "safe" (see section 2). The colors and icons stay. Device risk = worst level of its open findings. CVE level from score: ≥ 9 critical, ≥ 4 vulnerable, below 4 `update` color with label "Low".

### Components
**Primitives** (`src/components/ui/`): `Button` (primary, secondary, quiet, danger; `sm` size), `IconButton`, `Input` (44 px, optional leading icon), `Select`, `Checkbox`, `Switch`, `RadioCards` (`.option`), `Segmented` (`.seg`), `Chips` (filter, `aria-pressed`), `Card`, `Banner` (info, critical), `Pill`, `Table` (scrolls in a box on mobile), `Steps`, `SubNav`, `FactList` (`dl.facts`), `Avatar`, `Dialog`, `Tooltip`, `Spinner`, `EmptyState`, `FileDrop`.

**Domain components** (`src/features/…`), names from the design bundle:
- `RiskBadge` — pill with icon + label per level; optional custom text ("1 new critical").
- `VersionTag` — mono, `v3.1.0 → 3.1.2`; latest in `brand`; "version ?" when unknown.
- `DeviceIcon` — 44 px (56 px `lg`) rounded square, 15 types.
- `DeviceCard` — icon, name, "vendor · product · room", RiskBadge + VersionTag, footer "N known vulnerabilities" (in risk color) + checked time. Whole card is a link. Grid `minmax(260px, 1fr)`, gap 12.
- `CveItem` — 48 px score square in risk tint, CVE ID (mono, muted), RiskBadge, "Exploited in the wild" badge, plain-language title, summary, "Fixed in x".
- `NetworkSummary` — "11 devices · checked 2 hours ago", display headline ("1 device needs fixing now" / "N devices are vulnerable" / "Safe, with updates waiting" / "No known problems on your devices"), stacked bar per level, legend with counts.
- `DeviceTypePicker` — grid of 104 px icon tiles, selected = `brand-tint` + `brand` border.
- `AddDeviceTile` — dashed tile at the end of the device grid.
- Plus: `AppShell` (sidebar), `ProductSearch`, `ScanProgress`, `FindingRow`.

### App shell
Left sidebar (232 px, `surface-100`, right border) with logo (36 px teal square + shield), nav: My home (red count = devices needing attention), Add a device, Scanner, Notifications, Settings; footer with avatar, name, sign-out icon button. Main area padding 32, content max 1040 px (settings 880, add device 760). Below ~800 px the sidebar stacks above the content (flex-wrap); on phones turn it into a top bar + menu.

### Screens (see `docs/design/homeguard/screens/`)
1. **Sign in** (`01-sign-in`) — split: left `brand-tint` panel with pitch "See which devices in your home need an update", the four risk badges and a sample DeviceCard; right form (email, password + "Forgot password?", "Keep me signed in", Sign in, passkey button, "Create a household" link).
2. **My home** (`02-my-home`) — greeting header with "Scan my network" + "Add a device"; NetworkSummary; critical Banner for the worst device with "Fix now"; "Devices · 11" with search; filter chips (All, Needs attention, Game consoles, TV & media, Computers, Smart home); DeviceCard grid ending with AddDeviceTile. This replaces the separate Dashboard and Devices pages.
3. **Device detail** (`03-device-detail`) — back link, large icon, name, meta, RiskBadge + VersionTag + checked time, "Edit device" / "Check again". Main column: "What to do" card (border in risk color; title "Update the camera to v3.1.2", steps, "I've updated it", vendor link, info banner with a stop-gap tip) and "Known vulnerabilities · 2, worst first" list of CveItems. Side column: "About this device" facts, version history, alert switch, "Remove device".
4. **Add a device** (`04-add-device`) — one page with four numbered card sections and a step indicator: type (DeviceTypePicker), brand & model (catalogue search + radio list showing latest version, "Add it as Other" fallback), version (mono input, "where do I find this" help per product, "I don't know" checkbox), name & room. A live "Result" DeviceCard shows the outcome before saving. Footer Cancel / Add device.
5. **Settings – Household & users** (`05-settings-users`), **Notifications** (`06-…`), **Vulnerability scanner** (`07-…`) — sub-nav tabs. Scanner tab: status card ("The scanner is on", last scan, next scan, catalogue age, Pause / Scan now), schedule, scan depth, catalogue sources (NVD, known exploited, vendor notices), network range, recent scans table.

### Wording from the design (use it)
Plain, second person, one action: "Front door camera needs an update now", "Someone on your Wi‑Fi could watch the camera feed", "Updating to v3.1.2 fixes it and takes about five minutes", "Good news: this version has no known vulnerabilities. We'll let you know if that changes." CVE titles are rewritten in plain words; the raw NVD description goes behind a "Full details on NVD" link.

### Design vs. v1 scope
The designs show more than v1 includes. Until decided otherwise:

| In the design | v1 decision |
|---------------|-------------|
| Rooms, vendor/model/room meta, catalogue search, version help | **In.** Add `room` to `Device`; product search is the CPE search. "Where do I find this" help is a small static list per device type. |
| Update available / latest version, VersionTag `→ latest` | **In, partly.** Show `fixedVersion` of open findings as the target. A real "latest version" needs a source we don't have; hide the arrow when unknown. |
| "What to do" steps per vendor | **Partly.** Generic steps per device type + fixed version. Vendor-specific steps later. |
| "I've updated it" | **In.** Opens the version edit, then rescans. |
| Known exploited (KEV) badge, "Exploited in the wild" | **In.** Worker imports the CISA KEV list (small JSON, daily). New `Vulnerability.exploited Boolean`. |
| Version history | **In, simple.** Store previous versions when the user changes one. |
| Network scanner (discover devices, IP, scan depth, ports, default passwords, "Scan my network") | **Out (non-goal).** Scanner tab shows only: schedule, catalogue sources/age, recent scans, "Check all now". Hide "Scan my network", "Found by", IP, "found devices" banner. |
| Notifications (push, email, quiet hours, per-device alerts) | **Out (non-goal).** Hide the Notifications nav item and per-device alert switch. Keep the design for later. |
| Household with several people and roles (Owner/Admin/Member/Viewer), invites, 2-step for admins | **Out / open question** (see section 13). v1 is per-user. Settings shows Account instead. |
| Passkey sign-in | **Later.** Better Auth has a passkey plugin; easy follow-up. |
| SBOM upload | **Not in the design.** Add it ourselves in the same style: on device detail ("Software on this device" card with FileDrop) and as a fifth device type option "PC with an SBOM file". |
| Vulnerabilities list / CVE detail pages | **Not in the design.** Build them from the same parts (CveItem, Table, FactList). |

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
- `(auth)` pages (styled after `01-sign-in`, without the passkey button), protected `(app)` layout, sign-out.
- `ALLOW_SIGNUP` env flag.
- **Done when:** a user can sign up, log in, log out; `(app)` routes redirect when signed out.

### Phase 2: Data model and UI base
- Prisma schema from section 5, first migration.
- HomeGuard tokens (light + dark), Figtree + JetBrains Mono via `next/font`, Tailwind theme mapping.
- Primitives from section 9, styled to the design from the start.
- Redux store, typed hooks, RTK Query base api.
- App shell from the design: sidebar with logo, nav, user footer; stacks on mobile.
- **Done when:** the app shell renders with nav in light and dark, and primitives render on a dev-only `/ui` page that matches the design.

### Phase 3: Devices (no scanning yet)
- `src/server/devices.ts`, API routes, RTK Query endpoints.
- Domain components: `DeviceIcon`, `RiskBadge`, `VersionTag`, `DeviceCard`, `AddDeviceTile`, `DeviceTypePicker`.
- My home (device grid, search, filter chips), add device (type, free-text product, version, name & room), device detail (header, facts, version history), edit, delete.
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
- `MATCH_CPE` job writes findings and device status (risk levels from section 9).
- CISA KEV import sets `Vulnerability.exploited`.
- Product search UI as the radio list in `04-add-device`; live result card.
- **Done when:** adding a known vulnerable product + version shows the expected CVEs; an unknown product shows "Not tracked".

### Phase 6: SBOM upload → Trivy
- Worker image includes Trivy; `UPDATE_TRIVY_DB` job; cache volume.
- `sbom.rs`: parse CycloneDX and SPDX JSON into components.
- `trivy.rs`: run Trivy, parse JSON, map to findings + vulnerabilities.
- Upload UI with `FileDrop`, size and format checks, in the HomeGuard style (not in the designs; see section 9).
- **Done when:** uploading a CycloneDX SBOM of a test PC lists its components and vulnerabilities.

### Phase 7: Vulnerability views and dashboard
- `CveItem`, `NetworkSummary`, critical `Banner`; "What to do" card on device detail.
- My home: summary bar and "Fix now" banner for the worst device.
- Vulnerabilities list + detail, ignore/reopen finding.
- **Done when:** a user can go from dashboard → device → CVE → NVD link in three clicks.

### Phase 8: Scheduling and settings
- Daily Trivy DB update + rescan; NVD detail refresh.
- Settings with sub-nav: Account; Checks (styled after `07-settings-scanner`: status card, schedule, catalogue sources and age, NVD API key, Trivy DB date, recent checks table).
- **Done when:** new CVEs appear without user action after a rescan.

### Phase 9: Packaging for the NAS
- Multi-stage Dockerfiles for `web` (standalone output) and `worker` (static musl build + Trivy).
- Multi-arch images: `linux/amd64` and `linux/arm64`.
- Full `docker-compose.yml` with healthchecks, restart policies, volumes, one `.env`.
- README: install, update, backup (`pg_dump`), reset password.
- **Done when:** `docker compose up -d` on a clean machine gives a working app on port 3000; memory use stays under ~512 MB idle total.

### Phase 10: Design polish
The designs arrived before building, so each phase builds to them directly. This phase is a final pass:
- Compare every screen with `docs/design/homeguard/screens/` (light, dark, mobile).
- Empty, loading and error states (not in the designs), in the same style and wording.
- Accessibility check: contrast, focus, 44 px targets, icon + text on every risk.

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
| `TZ`                  | `UTC`            | Time zone for `RESCAN_CRON` (worker) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `homeguard` | Compose `db` service credentials; must match `DATABASE_URL` |
| `DB_PORT`             | `5432`           | Host port for the database (127.0.0.1 only) |

Test-only, not in the install steps: `NVD_BASE_URL`, `KEV_URL`, `TRIVY_PATH` (point the worker at a stub or a fake Trivy), `TEST_DATABASE_URL` (database for DB tests; must have "test" in its name), `DEV_DB_PORT` (port for `npm run db:dev`, default 54329).

---

## 13. Risks and open questions

- **Consumer device coverage in NVD is thin.** Mitigated by the clear "Not tracked" status and honest wording. Later: allow adding vendor security advisories.
- **Version strings differ** between what a console shows and what NVD uses. The product search should show example versions from NVD where possible.
- **NVD rate limits / outages.** Everything is cached; the app works with stale data and shows "last updated".
- **Trivy DB size** (~1 GB unpacked over time) on small NAS disks. Document it.
- **Decided (v1): one account per person.** Devices are per user; no household, roles or invites. Settings shows Account only. See `docs/backlog.md` → Decisions D1.
- **Decided (v1): network discovery and notifications are out.** Both are in "Later" in `docs/backlog.md`. Hide their nav items and switches. See Decisions D2 and D3.
- **Decided (v1): honest wording.** We show "No known vulnerabilities" and "Not tracked", never "Up to date" or "safe". The ux-designer records the design change. See Decisions D4.
- **Decided (v1): SBOM how-to.** A static, text-only help panel on the SBOM card in Phase 6 (story P6-6). The app does not run syft. See Decisions D5.
- Other decisions made while writing the backlog (NVD calls only in the worker, device status with unchecked parts, and others) are listed in `docs/backlog.md` → Decisions D6 to D24.
