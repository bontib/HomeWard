# Architecture V1

Owner: architect. Inputs: `CLAUDE.md`, `docs/implementation-plan.md`, `docs/backlog.md` (decisions D1 to D24 stand).
Decisions behind this document: `docs/adr/0001` to `docs/adr/0006`.

This is the contract between the `backend-engineer` and the `frontend-engineer`. If code and this document disagree, fix one of them in the same PR. Changes to sections 2 to 4 need an architect review.

---

## 1. Summary

- Three containers: `web` (Next.js), `worker` (Rust), `db` (Postgres 17). No other services.
- Web and worker share only Postgres: a `job` row plus `pg_notify('jobs', id)`. The worker claims with `FOR UPDATE SKIP LOCKED`, also polls every 30 s (D17), retries 3 times with 1 min / 5 min waits (D18).
- All NVD, KEV and Trivy calls are in the worker. Product search reads a cache; a miss queues `SEARCH_PRODUCTS` and the browser polls `/api/products` (D6, ADR 0002).
- The worker owns device status and the per-device counts. The web never derives a status; it queues `CHECK_DEVICE` or `RECOMPUTE_STATUS` (ADR 0004).
- Prisma 7 (stable) owns the schema. Tables and columns are snake_case so worker SQL is plain (ADR 0005).
- Cross-boundary contracts (enums, job payloads, risk thresholds) live in one place each and are guarded by tests on both sides (ADR 0003).
- Local work without Docker uses `embedded-postgres` (real Postgres 17 binaries from npm). Checked in this sandbox: PG 17.10 starts, the migration applies, `SKIP LOCKED` and `LISTEN/NOTIFY` work (ADR 0006).

Changes against the plan and backlog (all small, all recorded in ADRs):

| Plan / backlog says | V1 design | Why |
|---|---|---|
| `JobType { SCAN_SBOM MATCH_CPE RESCAN_ALL UPDATE_TRIVY_DB }` | `CHECK_DEVICE RECOMPUTE_STATUS SEARCH_PRODUCTS RESCAN_ALL UPDATE_TRIVY_DB IMPORT_KEV DEV_NOOP` | One device job covers manual + SBOM, so "Check again" is one job and one poll. Stories that say MATCH_CPE / SCAN_SBOM mean `CHECK_DEVICE`. |
| `DeviceStatus` has `SCANNING` and `ERROR` | Status is risk only (+ `PENDING`); progress is `Device.checkState` (`IDLE CHECKING FAILED`) | A failed or running re-check must not hide a known CRITICAL. P6-4 "status ERROR" = `checkState FAILED`. |
| Plan Phase 5: web calls NVD CPE search | Worker only (D6) | One rate limiter, one place for NVD. |
| `Sbom` many per device | One per device (`deviceId @unique`) | D16 says a new upload replaces the SBOM components; old files are not needed. |
| Backend agent file: "open finding → VULNERABLE" | Section 5 status rules | The plan's risk levels (section 9) are the newer rule. |

---

## 2. Data model (Prisma schema, final for V1)

File: `web/prisma/schema.prisma`. Validated with `prisma validate` (Prisma 7.10.1); the init migration was generated offline with `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` and applied to Postgres 17.10.

Notes for both sides:
- IDs of app tables are `gen_random_uuid()::text` in the database, so the worker can insert `job`, `component` and `finding` rows without an ID library. Better Auth makes its own IDs.
- `@updatedAt` is set by Prisma, not by the database. The worker never writes `device.updated_at` (it means "edited by the user").
- `sbom.content` is up to 20 MB. Every Prisma query on `Sbom` uses `select` without `content`; only the worker reads it.
- Reserved words are avoided in SQL names (`app_user`, `reference_urls`), so worker SQL needs no quotes.

```prisma
// HomeWard V1 schema. Source of truth: docs/architecture-v1.md section 2.
// Prisma owns this schema. The worker reads and writes these tables with sqlx
// but never creates or alters them.
// Tables and columns are snake_case (@@map / @map) so worker SQL needs no quoting.

generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  // Prisma 7: the connection URL lives in web/prisma.config.ts (env DATABASE_URL).
}

// ---------- Enums ----------

enum DeviceType {
  CONSOLE
  PC
  LAPTOP
  PHONE
  TABLET
  TV
  SPEAKER
  CAMERA
  PLUG
  BULB
  THERMOSTAT
  ROUTER
  DOORBELL
  PRINTER
  NAS
  OTHER

  @@map("device_type")
}

// Risk only. Whether a check is running or failed lives in CheckState (ADR 0004).
enum DeviceStatus {
  PENDING // created, first check not finished yet
  CRITICAL
  VULNERABLE
  UPDATE_AVAILABLE
  NO_KNOWN_VULNS
  NOT_TRACKED

  @@map("device_status")
}

enum CheckState {
  IDLE
  CHECKING
  FAILED

  @@map("check_state")
}

enum Severity {
  CRITICAL
  HIGH
  MEDIUM
  LOW
  UNKNOWN

  @@map("severity")
}

enum FindingState {
  OPEN
  IGNORED

  @@map("finding_state")
}

enum FindingSource {
  NVD
  TRIVY

  @@map("finding_source")
}

enum ComponentSource {
  MANUAL
  SBOM

  @@map("component_source")
}

// Why a component was or was not checked (D7, D8). Written by the worker.
enum ComponentCheck {
  PENDING // not looked at yet
  CHECKED // matched against NVD or Trivy data
  NO_IDENTIFIER // no CPE and no purl
  NO_VERSION // no version given
  BAD_VERSION // version cannot be compared ("unknown", "beta build xyz")
  UNSUPPORTED // has a purl, but Trivy does not cover that package type

  @@map("component_check")
}

enum SbomFormat {
  CYCLONEDX
  SPDX

  @@map("sbom_format")
}

enum JobType {
  CHECK_DEVICE
  RECOMPUTE_STATUS
  SEARCH_PRODUCTS
  RESCAN_ALL
  UPDATE_TRIVY_DB
  IMPORT_KEV
  DEV_NOOP

  @@map("job_type")
}

enum JobStatus {
  QUEUED
  RUNNING
  DONE
  FAILED

  @@map("job_status")
}

// Machine codes only. The UI owns the plain-language text for each code.
enum JobErrorCode {
  NVD_UNAVAILABLE // 403/429/5xx or network after retries: "NVD is busy. We'll try again later."
  TRIVY_FAILED
  TRIVY_DB_MISSING
  SBOM_INVALID
  KEV_UNAVAILABLE
  TIMEOUT
  WORKER_LOST // job was RUNNING when its worker died
  BAD_PAYLOAD
  INTERNAL

  @@map("job_error_code")
}

enum ProductSearchStatus {
  PENDING
  READY
  FAILED

  @@map("product_search_status")
}

enum DataSourceId {
  NVD
  TRIVY_DB
  KEV

  @@map("data_source_id")
}

// ---------- Better Auth (core schema, email + password) ----------
// Regenerate with `npx @better-auth/cli generate` when the auth config changes,
// then re-apply the @map/@@map names below.

model User {
  id            String   @id
  name          String
  email         String   @unique
  emailVerified Boolean  @default(false) @map("email_verified")
  image         String?
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  sessions Session[]
  accounts Account[]
  devices  Device[]
  jobs     Job[]

  @@map("app_user") // "user" is reserved in SQL
}

model Session {
  id        String   @id
  expiresAt DateTime @map("expires_at")
  token     String   @unique
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  ipAddress String?  @map("ip_address")
  userAgent String?  @map("user_agent")
  userId    String   @map("user_id")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("session")
}

model Account {
  id                    String    @id
  accountId             String    @map("account_id")
  providerId            String    @map("provider_id")
  userId                String    @map("user_id")
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?   @map("access_token")
  refreshToken          String?   @map("refresh_token")
  idToken               String?   @map("id_token")
  accessTokenExpiresAt  DateTime? @map("access_token_expires_at")
  refreshTokenExpiresAt DateTime? @map("refresh_token_expires_at")
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")

  @@index([userId])
  @@map("account")
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime @map("expires_at")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@index([identifier])
  @@map("verification")
}

// ---------- Devices ----------

model Device {
  id     String     @id @default(dbgenerated("(gen_random_uuid())::text"))
  userId String     @map("user_id")
  user   User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  name   String     @db.VarChar(80)
  type   DeviceType
  room   String?    @db.VarChar(40)
  notes  String?    @db.VarChar(500)

  // Written by the worker in one transaction at the end of every check (ADR 0004).
  status           DeviceStatus @default(PENDING)
  targetVersion    String?      @map("target_version") // highest fixedVersion of open findings on the manual product
  openFindingCount Int          @default(0) @map("open_finding_count")
  componentCount   Int          @default(0) @map("component_count")
  uncheckedCount   Int          @default(0) @map("unchecked_count") // D7 "N parts not checked"
  lastCheckedAt    DateTime?    @map("last_checked_at")

  // Check progress. Web sets CHECKING + checkJobId when it enqueues CHECK_DEVICE;
  // the worker sets IDLE or FAILED when that job ends. checkJobId is not a FK on purpose.
  checkState     CheckState    @default(IDLE) @map("check_state")
  checkJobId     String?       @map("check_job_id")
  checkErrorCode JobErrorCode? @map("check_error_code")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  components Component[]
  findings   Finding[]
  sbom       Sbom?
  jobs       Job[]

  @@index([userId, createdAt])
  @@map("device")
}

model Component {
  id       String          @id @default(dbgenerated("(gen_random_uuid())::text"))
  deviceId String          @map("device_id")
  device   Device          @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  source   ComponentSource
  name     String
  version  String?
  vendor   String?
  purl     String? // SBOM components
  cpe      String? // manual product: base CPE "cpe:2.3:o:microsoft:xbox_one_firmware"
  check    ComponentCheck  @default(PENDING)

  findings       Finding[]
  versionChanges VersionChange[]

  @@index([deviceId, source])
  @@map("component")
}

// One SBOM per device. A new upload replaces the row (D16: only SBOM components are replaced).
model Sbom {
  id         String     @id @default(dbgenerated("(gen_random_uuid())::text"))
  deviceId   String     @unique @map("device_id")
  device     Device     @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  format     SbomFormat
  fileName   String     @map("file_name") @db.VarChar(255)
  sizeBytes  Int        @map("size_bytes")
  sha256     String     @db.Char(64)
  content    Bytes // never select this in list or detail queries
  uploadedAt DateTime   @default(now()) @map("uploaded_at")
  parsedAt   DateTime?  @map("parsed_at") // null = worker must parse it into components

  @@map("sbom")
}

// "Version history" on device detail. Written by web when the user changes the manual version.
model VersionChange {
  id          String    @id @default(dbgenerated("(gen_random_uuid())::text"))
  componentId String    @map("component_id")
  component   Component @relation(fields: [componentId], references: [id], onDelete: Cascade)
  fromVersion String?   @map("from_version")
  toVersion   String?   @map("to_version")
  changedAt   DateTime  @default(now()) @map("changed_at")

  @@index([componentId, changedAt])
  @@map("version_change")
}

// ---------- Vulnerability data (global cache, not per user) ----------

model Vulnerability {
  id                String        @id // "CVE-2024-12345", or "GHSA-…" from Trivy
  severity          Severity
  cvssScore         Float?        @map("cvss_score")
  cvssVector        String?       @map("cvss_vector")
  exploited         Boolean       @default(false) // in CISA KEV
  summary           String
  publishedAt       DateTime?     @map("published_at")
  modifiedAt        DateTime?     @map("modified_at")
  references        Json          @default("[]") @map("reference_urls") // string[] of URLs
  nvdConfigurations Json?         @map("nvd_configurations") // raw NVD "configurations", NVD path only
  detailsSource     FindingSource @map("details_source")
  fetchedAt         DateTime      @map("fetched_at")

  findings Finding[]
  products CpeProductCve[]

  @@map("vulnerability")
}

model Finding {
  id              String        @id @default(dbgenerated("(gen_random_uuid())::text"))
  deviceId        String        @map("device_id") // denormalized from component for per-user filters
  device          Device        @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  componentId     String        @map("component_id")
  component       Component     @relation(fields: [componentId], references: [id], onDelete: Cascade)
  vulnerabilityId String        @map("vulnerability_id")
  vulnerability   Vulnerability @relation(fields: [vulnerabilityId], references: [id], onDelete: Restrict)
  source          FindingSource
  fixedVersion    String?       @map("fixed_version")
  state           FindingState  @default(OPEN)
  ignoredReason   String?       @map("ignored_reason") @db.VarChar(200)
  ignoredAt       DateTime?     @map("ignored_at")
  firstSeenAt     DateTime      @default(now()) @map("first_seen_at")
  lastSeenAt      DateTime      @default(now()) @map("last_seen_at")

  @@unique([componentId, vulnerabilityId])
  @@index([deviceId, state])
  @@index([vulnerabilityId])
  @@map("finding")
}

// Product search cache (D6). One row per NVD product, without version.
model CpeProduct {
  cpe           String    @id // "cpe:2.3:o:microsoft:xbox_one_firmware"
  part          String    @db.Char(1) // a, o, h
  vendor        String
  product       String
  title         String
  latestVersion String?   @map("latest_version") // hint only (P5-2, could)
  fetchedAt     DateTime  @map("fetched_at")
  cvesFetchedAt DateTime? @map("cves_fetched_at") // null = never fetched; refetch after 7 days

  cves CpeProductCve[]

  @@map("cpe_product")
}

model CpeProductCve {
  cpe             String
  product         CpeProduct    @relation(fields: [cpe], references: [cpe], onDelete: Cascade)
  vulnerabilityId String        @map("vulnerability_id")
  vulnerability   Vulnerability @relation(fields: [vulnerabilityId], references: [id], onDelete: Cascade)

  @@id([cpe, vulnerabilityId])
  @@index([vulnerabilityId])
  @@map("cpe_product_cve")
}

// One row per normalized search text. Results are the ordered CPE list NVD returned.
model ProductSearch {
  query       String              @id @db.VarChar(60) // trimmed, lower-case, single spaces
  status      ProductSearchStatus
  cpes        String[]            @default([])
  jobId       String?             @map("job_id")
  requestedAt DateTime            @default(now()) @map("requested_at")
  fetchedAt   DateTime?           @map("fetched_at")

  @@map("product_search")
}

model KevEntry {
  cveId      String   @id @map("cve_id")
  dateAdded  DateTime @map("date_added") @db.Date
  importedAt DateTime @map("imported_at")

  @@map("kev_entry")
}

// ---------- Jobs and worker state ----------

model Job {
  id          String        @id @default(dbgenerated("(gen_random_uuid())::text"))
  type        JobType
  payload     Json // shape per type: docs/architecture-v1.md section 4, web/src/lib/contracts/jobs.ts
  status      JobStatus     @default(QUEUED)
  priority    Int           @default(0) // higher runs first: 20 interactive, 10 user check, 0 scheduled
  attempts    Int           @default(0) // incremented at claim time
  maxAttempts Int           @default(3) @map("max_attempts")
  runAfter    DateTime      @default(now()) @map("run_after")
  startedAt   DateTime?     @map("started_at")
  finishedAt  DateTime?     @map("finished_at")
  lockedBy    String?       @map("locked_by") // worker instance id
  errorCode   JobErrorCode? @map("error_code")
  error       String? // internal detail for logs and admins, never shown in the UI
  userId      String?       @map("user_id") // null = system job
  user        User?         @relation(fields: [userId], references: [id], onDelete: Cascade)
  deviceId    String?       @map("device_id")
  device      Device?       @relation(fields: [deviceId], references: [id], onDelete: SetNull)
  createdAt   DateTime      @default(now()) @map("created_at")

  @@index([status, priority(sort: Desc), runAfter])
  @@index([userId, createdAt(sort: Desc)])
  @@index([deviceId])
  @@index([type, createdAt(sort: Desc)])
  @@map("job")
}

// Freshness of each outside data source, for Settings > Checks and stale notes.
model DataSource {
  id            DataSourceId  @id
  lastAttemptAt DateTime?     @map("last_attempt_at")
  lastSuccessAt DateTime?     @map("last_success_at")
  dataUpdatedAt DateTime?     @map("data_updated_at") // e.g. Trivy DB UpdatedAt, KEV dateReleased
  lastErrorCode JobErrorCode? @map("last_error_code")

  @@map("data_source")
}

// Single row (id = 1), upserted by the worker every 30 s.
model WorkerStatus {
  id           Int       @id @default(1)
  startedAt    DateTime  @map("started_at")
  heartbeatAt  DateTime  @map("heartbeat_at")
  version      String
  rescanCron   String    @map("rescan_cron")
  nextRescanAt DateTime? @map("next_rescan_at")
  nvdApiKeySet Boolean   @map("nvd_api_key_set")

  @@map("worker_status")
}
```

`web/prisma.config.ts` (Prisma 7):

```ts
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
```

Runtime client (`web/src/lib/db.ts`): `new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 5 }) })`, one instance per process (global in dev).

### Index review

| Query | Index |
|---|---|
| Device list / detail for a user | `device(user_id, created_at)`; detail is by PK plus `user_id` check |
| Findings of a device, open first | `finding(device_id, state)` |
| CVE detail: affected devices | `finding(vulnerability_id)` |
| Components of a device | `component(device_id, source)` |
| Claim next job | `job(status, priority DESC, run_after)` (checked with `EXPLAIN`: index scan + incremental sort) |
| Recent checks for a user | `job(user_id, created_at DESC)` |
| Last scheduled `RESCAN_ALL`, queued searches | `job(type, created_at DESC)` |
| Product to CVEs | `cpe_product_cve` PK `(cpe, vulnerability_id)`, plus `(vulnerability_id)` for KEV updates |
| Version history | `version_change(component_id, changed_at)` |

Every FK column used in a join or cascade has an index. Tables are small (a home has tens of devices, a few thousand components at most), so no partial or trigram indexes in V1.

### Retention
The worker deletes `DONE`/`FAILED` jobs older than 30 days and `product_search` rows older than 30 days during `RESCAN_ALL` (section 4.7).

---

## 3. API contract

### 3.1 Shared rules

- Every route under `/api` except `/api/health` and `/api/auth/*` needs a session. No session: `401`.
- Handler shape: `withSession(req)` → Zod parse → one `src/server/*` function → `NextResponse.json`. Helpers live in `web/src/server/http.ts`.
- Anything owned by another user, or missing: `404` (never `403`, P3-1).
- Dates are ISO 8601 strings in UTC. IDs are strings.
- Responses are not cached (`Cache-Control: no-store`).

Error body, for every non-2xx response:

```ts
// web/src/lib/contracts/api.ts
export type ApiErrorCode =
  | "VALIDATION_FAILED"   // 400
  | "UNAUTHORIZED"        // 401
  | "NOT_FOUND"           // 404
  | "PAYLOAD_TOO_LARGE"   // 413
  | "UNSUPPORTED_FILE"    // 415
  | "RATE_LIMITED"        // 429
  | "INTERNAL";           // 500, message is always "Something went wrong. Try again."

export type ApiError = {
  error: {
    code: ApiErrorCode;
    message: string;                 // plain text, safe to show
    fields?: Record<string, string>; // Zod field path -> message, for 400 only
  };
};
```

Zod messages are written for users ("Give your device a name.") because forms show them as-is. Server errors never contain stack traces or SQL.

### 3.2 Shared types

All of this lives in `web/src/lib/contracts/` and is imported by route handlers, `src/server/`, RTK Query endpoints and forms. Enum lists are Zod enums; a Vitest test checks they equal the Prisma enums (ADR 0003).

```ts
// web/src/lib/contracts/enums.ts
import { z } from "zod";

export const DeviceTypeSchema = z.enum(["CONSOLE","PC","LAPTOP","PHONE","TABLET","TV","SPEAKER","CAMERA","PLUG","BULB","THERMOSTAT","ROUTER","DOORBELL","PRINTER","NAS","OTHER"]);
export const DeviceStatusSchema = z.enum(["PENDING","CRITICAL","VULNERABLE","UPDATE_AVAILABLE","NO_KNOWN_VULNS","NOT_TRACKED"]);
export const CheckStateSchema = z.enum(["IDLE","CHECKING","FAILED"]);
export const SeveritySchema = z.enum(["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"]);
export const FindingStateSchema = z.enum(["OPEN","IGNORED"]);
export const FindingSourceSchema = z.enum(["NVD","TRIVY"]);
export const ComponentSourceSchema = z.enum(["MANUAL","SBOM"]);
export const ComponentCheckSchema = z.enum(["PENDING","CHECKED","NO_IDENTIFIER","NO_VERSION","BAD_VERSION","UNSUPPORTED"]);
export const SbomFormatSchema = z.enum(["CYCLONEDX","SPDX"]);
export const JobTypeSchema = z.enum(["CHECK_DEVICE","RECOMPUTE_STATUS","SEARCH_PRODUCTS","RESCAN_ALL","UPDATE_TRIVY_DB","IMPORT_KEV","DEV_NOOP"]);
export const JobStatusSchema = z.enum(["QUEUED","RUNNING","DONE","FAILED"]);
export const JobErrorCodeSchema = z.enum(["NVD_UNAVAILABLE","TRIVY_FAILED","TRIVY_DB_MISSING","SBOM_INVALID","KEV_UNAVAILABLE","TIMEOUT","WORKER_LOST","BAD_PAYLOAD","INTERNAL"]);
export const DataSourceIdSchema = z.enum(["NVD","TRIVY_DB","KEV"]);
// One TS type per schema: export type DeviceType = z.infer<typeof DeviceTypeSchema>; etc.
```

```ts
// web/src/lib/contracts/api.ts (response types)
export type IsoDate = string;

export type DeviceCheck = {
  state: CheckState;                 // CHECKING -> show "Checking…" and poll jobId
  jobId: string | null;
  errorCode: JobErrorCode | null;    // set when state = FAILED; UI maps to text
};

export type ManualProduct = {
  componentId: string;
  name: string;                      // CPE title, or the free text the user typed
  vendor: string | null;
  cpe: string | null;                // null = "Other" / free text = not tracked
  version: string | null;            // null = "version ?"
  check: ComponentCheck;             // BAD_VERSION -> "We can't compare this version."
};

export type DeviceSummary = {
  id: string;
  name: string;
  type: DeviceType;
  room: string | null;
  product: ManualProduct | null;     // null only for SBOM-only devices
  status: DeviceStatus;
  check: DeviceCheck;
  targetVersion: string | null;      // "Update to <targetVersion>"; null hides the arrow
  openFindingCount: number;
  componentCount: number;
  uncheckedCount: number;            // D7: "N parts not checked"
  hasSbom: boolean;
  lastCheckedAt: IsoDate | null;
};

export type VulnerabilitySummary = {
  id: string;                        // "CVE-2024-1234" or "GHSA-…"
  severity: Severity;
  cvssScore: number | null;
  exploited: boolean;
  summary: string;                   // full NVD text; UI shows the first two sentences (D11)
  publishedAt: IsoDate | null;
  nvdUrl: string | null;             // only for CVE-* ids
};

export type DeviceFinding = {
  id: string;
  state: FindingState;
  ignoredReason: string | null;
  fixedVersion: string | null;       // null -> "No fix known yet."
  source: FindingSource;
  firstSeenAt: IsoDate;
  component: { id: string; name: string; version: string | null };
  vulnerability: VulnerabilitySummary;
};

export type VersionChangeView = {
  id: string;
  fromVersion: string | null;
  toVersion: string | null;
  changedAt: IsoDate;
};

export type SbomView = {
  fileName: string;
  format: SbomFormat;
  sizeBytes: number;
  uploadedAt: IsoDate;
  parsedAt: IsoDate | null;
};

export type DeviceDetail = DeviceSummary & {
  notes: string | null;
  createdAt: IsoDate;
  findings: DeviceFinding[];         // OPEN first, then IGNORED; each group worst first (section 5)
  versionHistory: VersionChangeView[]; // newest first
  sbom: SbomView | null;
};

export type ComponentView = {
  id: string;
  name: string;
  version: string | null;
  vendor: string | null;
  source: ComponentSource;
  check: ComponentCheck;
  openFindingCount: number;
  worstLevel: RiskLevel | null;      // null when no open findings
};

export type ProductOption = {
  cpe: string;                       // base CPE, no version
  title: string;
  vendor: string;
  latestVersion: string | null;      // hint, may be null
};

export type ProductSearchResponse = {
  query: string;                     // normalized
  status: "READY" | "PENDING" | "FAILED";
  products: ProductOption[];         // max 8; may be non-empty while PENDING (stale refresh)
};

export type FindingRow = DeviceFinding & {
  device: { id: string; name: string; type: DeviceType };
};

export type AffectedDevice = {
  device: { id: string; name: string; type: DeviceType; room: string | null };
  findingId: string;
  state: FindingState;
  fixedVersion: string | null;
  componentName: string;
  componentVersion: string | null;
};

export type VulnerabilityDetail = VulnerabilitySummary & {
  cvssVector: string | null;
  modifiedAt: IsoDate | null;
  fetchedAt: IsoDate;
  references: string[];
  productTitle: string | null;       // "Security problem in <productTitle>" (D11)
};

export type JobView = {
  id: string;
  type: JobType;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  errorCode: JobErrorCode | null;
  nextAttemptAt: IsoDate | null;     // set when QUEUED after a failed attempt
  createdAt: IsoDate;
  startedAt: IsoDate | null;
  finishedAt: IsoDate | null;
};

export type SourceView = {
  lastSuccessAt: IsoDate | null;
  dataUpdatedAt: IsoDate | null;
  lastErrorCode: JobErrorCode | null;
};

export type RecentCheck = {
  jobId: string;
  type: "CHECK_DEVICE" | "RESCAN_ALL";
  status: JobStatus;
  errorCode: JobErrorCode | null;
  createdAt: IsoDate;
  finishedAt: IsoDate | null;
  device: { id: string; name: string } | null; // null + type RESCAN_ALL = "All devices"; null + CHECK_DEVICE = "Removed device"
};

export type ChecksStatus = {
  scanner: {
    on: boolean;                     // worker heartbeat younger than 2 minutes
    lastCheckAt: IsoDate | null;     // newest finished CHECK_DEVICE of this user
    nextCheckAt: IsoDate | null;
    rescanCron: string | null;       // read-only, "Set in .env" (D12)
    nvdApiKeySet: boolean;
  };
  sources: Record<DataSourceId, SourceView>;
  checkingDeviceCount: number;       // "Check all now" is disabled while > 0 or activeRescanJobId != null
  activeRescanJobId: string | null;
  recent: RecentCheck[];             // last 10
};
```

```ts
// web/src/lib/contracts/risk.ts (pure; used by src/server and the UI)
export type RiskLevel = "critical" | "vulnerable" | "low";
export function effectiveScore(v: { cvssScore: number | null; severity: Severity }): number | null;
export function riskLevel(v: { cvssScore: number | null; severity: Severity; exploited: boolean }): RiskLevel;
export function compareFindingsWorstFirst(a: DeviceFinding, b: DeviceFinding): number;
```

Request schemas (same file, used by forms and handlers):

```ts
const name = z.string().trim().min(1, "Give your device a name.").max(80, "Use 80 characters or fewer.");
const optionalText = (max: number) =>
  z.string().trim().max(max).transform((s) => (s === "" ? null : s)).nullable().optional();
const version = z.string().trim().max(64).transform((s) => (s === "" ? null : s)).nullable(); // null = "I don't know"
export const BaseCpeSchema = z.string().regex(/^cpe:2\.3:[aho]:[^:*]+:[^:*]+$/);

export const ProductInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("catalog"), cpe: BaseCpeSchema }),               // Phase 5+
  z.object({ kind: z.literal("other"), name: z.string().trim().max(120) }),  // free text; "" = I don't know
]);

export const CreateDeviceSchema = z.object({
  type: DeviceTypeSchema,
  name,
  room: optionalText(40),
  notes: optionalText(500),
  product: ProductInputSchema,
  version,
});

export const UpdateDeviceSchema = z
  .object({
    name: name.optional(),
    room: optionalText(40),
    notes: optionalText(500),
    product: ProductInputSchema.optional(),
    version: version.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Change at least one field.");

export const ProductSearchQuerySchema = z.object({
  q: z.string().trim().toLowerCase().transform((s) => s.replace(/\s+/g, " "))
    .pipe(z.string().min(2, "Type at least 2 letters.").max(60)),
});

export const VulnerabilityListQuerySchema = z.object({
  deviceId: z.string().optional(),
  level: z.enum(["critical", "vulnerable", "low"]).optional(),
  state: FindingStateSchema.default("OPEN"),
});

export const UpdateFindingSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("IGNORED"), reason: z.string().trim().min(1, "Add a short reason.").max(200, "Use 200 characters or fewer.") }),
  z.object({ state: z.literal("OPEN") }),
]);
```

### 3.3 Routes

| Method, path | Request | 2xx response | Errors |
|---|---|---|---|
| `GET /api/health` | none, no auth | `200 { status: "ok" }` (runs `SELECT 1`) | `503 { status: "db_down" }` |
| `GET /api/devices` | none | `200 { devices: DeviceSummary[] }` worst first, then name | 401 |
| `POST /api/devices` | `CreateDeviceSchema` | `201 { device: DeviceDetail, jobId: string \| null }` | 400 (also: catalog CPE not in `cpe_product`), 401 |
| `GET /api/devices/:id` | none | `200 { device: DeviceDetail }` | 401, 404 |
| `PATCH /api/devices/:id` | `UpdateDeviceSchema` | `200 { device: DeviceDetail, jobId: string \| null }`; `jobId` set when product or version changed | 400, 401, 404 |
| `DELETE /api/devices/:id` | none | `204` | 401, 404 |
| `GET /api/devices/:id/components` | none | `200 { components: ComponentView[] }` worst first, then not-checked, then name | 401, 404 |
| `POST /api/devices/:id/sbom` | `multipart/form-data`, field `file` | `202 { device: DeviceDetail, jobId: string }` | 400 no file, 401, 404, 413 (`"This file is larger than 20 MB."`, uses `MAX_SBOM_MB`), 415 (`"This isn't a CycloneDX or SPDX file. Export it as JSON and try again."`) |
| `POST /api/devices/:id/scan` | none | `202 { jobId: string }` (returns the queued job if one exists) | 401, 404 |
| `GET /api/products?q=` | `ProductSearchQuerySchema` | `200 ProductSearchResponse` | 400, 401, 429 (too many searches queued: `"Search is busy. Try again in a minute."`) |
| `GET /api/vulnerabilities` | `VulnerabilityListQuerySchema` (query string) | `200 { findings: FindingRow[], notFullyCheckedDeviceCount: number }` worst first | 400, 401 |
| `GET /api/vulnerabilities/:cveId` | none | `200 { vulnerability: VulnerabilityDetail, affected: AffectedDevice[] }` (only my devices) | 401, 404 when none of my devices has it |
| `PATCH /api/findings/:id` | `UpdateFindingSchema` | `200 { finding: DeviceFinding, jobId: string }` (`RECOMPUTE_STATUS`) | 400, 401, 404 |
| `GET /api/jobs/:id` | none | `200 { job: JobView }` | 401, 404 (not my job; system jobs other than `RESCAN_ALL` are never visible) |
| `GET /api/checks` | none | `200 ChecksStatus` | 401 |
| `POST /api/checks/run` | none | `202 { jobId: string }` (`RESCAN_ALL { userId: me }`; returns the active one if any) | 401 |
| `POST /api/dev/jobs` | none | `202 { jobId }` (`DEV_NOOP`) | 404 when `NODE_ENV=production` |
| `/api/auth/*` | Better Auth | Better Auth | Better Auth |

Auth notes (backend):
- Better Auth: `emailAndPassword: { enabled: true, minPasswordLength: 12, disableSignUp: env.ALLOW_SIGNUP === "false" }`. Change password uses the Better Auth client `changePassword({ revokeOtherSessions: true })`, so no own route.
- `web/src/proxy.ts` (Next 16 name for middleware) does only the cookie check and redirects to `/login?next=<path>`. The real check is in `(app)/layout.tsx` and in `withSession`.
- `web/scripts/reset-password.mjs <email> <password>` for P9-6 uses Better Auth's own password hasher and deletes the user's sessions.

Upload notes (backend):
- Refuse on `Content-Length` > `MAX_SBOM_MB` before reading the body. Read the file, check size again, then sniff only the first 64 KB: CycloneDX = `"bomFormat"` with `"CycloneDX"`; SPDX = `"spdxVersion"`. No full JSON parse in Next.js; the worker does that.
- One transaction: upsert `sbom` (replace content, `parsed_at = null`), then `enqueueCheck`.

### 3.4 RTK Query tags (frontend)

Tag types in `web/src/store/api.ts`: `Device` (id), `DeviceList`, `Components` (deviceId), `Findings`, `Vulnerability` (id), `Checks`.

| Mutation | Invalidates now | When its `jobId` reaches DONE or FAILED |
|---|---|---|
| create / update device | `DeviceList`, `Device:id` | `Device:id`, `DeviceList`, `Components:id`, `Findings` |
| delete device | `DeviceList`, `Findings`, `Checks` | |
| upload SBOM, scan | `Device:id` | same as create |
| ignore / reopen | `Device:id`, `Findings`, `Vulnerability:*` | `Device:id`, `DeviceList` |
| check all now | `Checks` | `Checks`, `DeviceList` |

Polling:
- Job: `GET /api/jobs/:id` every 2 s while `QUEUED` or `RUNNING` (P4-3). One hook, `useJobWatcher(jobId, onSettled)`, in `src/features/jobs/`, used by checks, uploads, ignore and check-all.
- Device pages and My home: when any device has `check.state = CHECKING` after a reload, poll that device's `check.jobId` the same way.
- Product search: debounce 300 ms, min 2 letters, then poll `/api/products?q=` every 1 s while `PENDING`; after 10 s show "Search is taking longer than usual. Try again in a minute." and stop polling (P5-2).
- Settings > Checks: poll `/api/checks` every 5 s while `checkingDeviceCount > 0` or `activeRescanJobId` is set.

---

## 4. Job protocol (web ↔ worker)

Full reasoning: ADR 0001 (queue) and ADR 0002 (NVD and product search).

### 4.1 Job types and payloads

Payloads are JSON objects with camelCase keys. They carry IDs only, never user content other than the search text. Zod schemas in `web/src/lib/contracts/jobs.ts`; serde structs in `worker/src/contract.rs`; one example per type in `contracts/jobs/<TYPE>.json`, parsed by tests on both sides.

| Type | Payload | Queued by | Lane | Priority | Max attempts | Timeout | Job columns |
|---|---|---|---|---|---|---|---|
| `CHECK_DEVICE` | `{ "deviceId": string }` | web: create, product/version change, SBOM upload, Check again; worker: `RESCAN_ALL` | slow | 10 (user), 0 (rescan) | 3 | 10 min | `user_id`, `device_id` |
| `RECOMPUTE_STATUS` | `{ "deviceId": string }` | web: ignore / reopen; worker: `IMPORT_KEV` | fast | 20 | 3 | 30 s | `user_id`, `device_id` |
| `SEARCH_PRODUCTS` | `{ "query": string }` (normalized, 2 to 60 chars) | web: `/api/products` miss | fast | 20 | 1 | 60 s | none |
| `RESCAN_ALL` | `{ "userId": string \| null }` (null = all users, scheduled) | worker scheduler; web: Check all now | slow | 5 | 3 | 10 min | `user_id` when set |
| `UPDATE_TRIVY_DB` | `{}` | worker at start when the DB is missing | slow | 5 | 3 | 10 min | none |
| `IMPORT_KEV` | `{}` | worker at start when KEV is empty or older than 24 h | slow | 5 | 3 | 2 min | none |
| `DEV_NOOP` | `{ "sleepMs"?: number }` (0 to 5000) | web dev route only | fast | 20 | 1 | 30 s | `user_id` |

```ts
// web/src/lib/contracts/jobs.ts
export const JobPayloadSchemas = {
  CHECK_DEVICE: z.object({ deviceId: z.string().min(1) }),
  RECOMPUTE_STATUS: z.object({ deviceId: z.string().min(1) }),
  SEARCH_PRODUCTS: z.object({ query: z.string().min(2).max(60) }),
  RESCAN_ALL: z.object({ userId: z.string().nullable() }),
  UPDATE_TRIVY_DB: z.object({}),
  IMPORT_KEV: z.object({}),
  DEV_NOOP: z.object({ sleepMs: z.number().int().min(0).max(5000).optional() }),
} satisfies Record<JobType, z.ZodType>;
export type JobPayload<T extends JobType> = z.infer<(typeof JobPayloadSchemas)[T]>;
```

```rust
// worker/src/contract.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, serde::Deserialize)]
#[sqlx(type_name = "job_type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum JobType { CheckDevice, RecomputeStatus, SearchProducts, RescanAll, UpdateTrivyDb, ImportKev, DevNoop }

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePayload { pub device_id: String }          // CHECK_DEVICE, RECOMPUTE_STATUS

#[derive(Debug, serde::Deserialize)]
pub struct SearchProductsPayload { pub query: String }

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RescanAllPayload { pub user_id: Option<String> }

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevNoopPayload { pub sleep_ms: Option<u64> }
// UPDATE_TRIVY_DB and IMPORT_KEV take no payload fields.
// Same pattern (sqlx::Type, SCREAMING_SNAKE_CASE) for JobStatus, JobErrorCode,
// DeviceStatus, CheckState, ComponentCheck, Severity, FindingSource, FindingState.
```

A payload the worker cannot parse fails at once with `BAD_PAYLOAD` (no retry).

### 4.2 Enqueue (web)

`web/src/lib/jobs.ts`, used only from `src/server/`:

```ts
export async function enqueueJob<T extends JobType>(
  tx: Prisma.TransactionClient,
  job: { type: T; payload: JobPayload<T>; userId?: string; deviceId?: string; priority?: number; maxAttempts?: number },
): Promise<string>; // validates payload with JobPayloadSchemas[type], inserts, then SELECT pg_notify('jobs', id)

export async function enqueueCheck(tx: Prisma.TransactionClient, userId: string, deviceId: string): Promise<string>;
```

- Always called inside the transaction that writes the data the job belongs to. `pg_notify` inside a transaction is sent on commit, so the worker never wakes up before the row is visible.
- `enqueueCheck` locks the device row (`SELECT … FOR UPDATE`). If `check_job_id` points at a `QUEUED` job, it returns that ID (button spam and "edit then upload" fold into one job). Otherwise it inserts a new `CHECK_DEVICE` (priority 10) and sets `check_state = CHECKING`, `check_job_id = <new id>`, `check_error_code = null`.
- `RECOMPUTE_STATUS` and `RESCAN_ALL` follow the same "reuse the queued one" rule.

### 4.3 Worker loop

```
main
 ├─ listener task: PgListener LISTEN jobs  → wake both lanes (tokio::sync::Notify)
 ├─ lane "fast": SEARCH_PRODUCTS, RECOMPUTE_STATUS, DEV_NOOP   (one job at a time)
 ├─ lane "slow": CHECK_DEVICE, RESCAN_ALL, UPDATE_TRIVY_DB, IMPORT_KEV (one job at a time)
 ├─ scheduler task: RESCAN_CRON
 └─ heartbeat task: every 30 s upsert worker_status, reap stuck jobs
```

Each lane: claim until nothing is due, then wait for a notify or 30 s (D17), then claim again. Two lanes keep product search fast while a long check runs; one job per lane keeps memory low (only one Trivy process at a time). The NVD rate limiter is one shared instance across lanes.

Claim (checked on Postgres 17.10):

```sql
UPDATE job
SET status = 'RUNNING', attempts = attempts + 1, started_at = now(), locked_by = $2
WHERE id = (
  SELECT id FROM job
  WHERE status = 'QUEUED' AND run_after <= now() AND type = ANY($1::job_type[])
  ORDER BY priority DESC, run_after, created_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING id, type, payload, attempts, max_attempts, user_id, device_id;
```

`$2` is the instance ID (`<hostname>-<random>` at start). `attempts` counts at claim time, so a job that crashes the worker still runs out of attempts.

Run: every job runs in `tracing::info_span!("job", job_id, job_type)` under `tokio::time::timeout(<type timeout>)`. Trivy runs with `Command::new(trivy_path).args([...]).kill_on_drop(true)`, so a timeout also kills the child.

Finish (all guarded with `WHERE id = $1 AND status = 'RUNNING' AND locked_by = $2`; zero rows means the job was reaped, so the result is dropped and logged):

| Outcome | SQL effect |
|---|---|
| Ok | `status = 'DONE', finished_at = now(), error_code = null` |
| Retryable error, `attempts < max_attempts` | `status = 'QUEUED', run_after = now() + backoff(attempts), error_code, error, locked_by = null` where backoff(1) = 1 min, backoff(2) = 5 min (D18) |
| Retryable error, last attempt; or non-retryable | `status = 'FAILED', finished_at = now(), error_code, error` then the type's `on_failed` hook |

Non-retryable codes: `SBOM_INVALID`, `BAD_PAYLOAD`. Everything else is retryable. `error` holds internal text for logs; the API returns only `errorCode`, and the UI maps codes to plain text.

`on_failed` hooks:
- `CHECK_DEVICE`: `UPDATE device SET check_state = 'FAILED', check_error_code = $code WHERE id = $device AND check_job_id = $job`. Status and findings stay as they were.
- `SEARCH_PRODUCTS`: `product_search.status = 'FAILED'`.
- Others: only `data_source.last_error_code`.

While a `CHECK_DEVICE` waits for a retry, the device stays `CHECKING`; the UI can show `JobView.nextAttemptAt`.

### 4.4 Stuck `RUNNING` jobs

- At start: the worker reaps every `RUNNING` job whose `locked_by` is not its own ID. V1 runs exactly one worker; this is written in the README and compose has one `worker` service.
- Every 30 s (heartbeat task): reap `RUNNING` jobs with `started_at < now() - interval '15 minutes'` (timeout is 10 min, so these are from a dead process).

```sql
UPDATE job
SET status     = CASE WHEN attempts >= max_attempts THEN 'FAILED'::job_status ELSE 'QUEUED'::job_status END,
    run_after  = now() + interval '1 minute',
    finished_at = CASE WHEN attempts >= max_attempts THEN now() END,
    error_code = 'WORKER_LOST', locked_by = NULL
WHERE status = 'RUNNING' AND (started_at < now() - interval '15 minutes' OR locked_by <> $1)
RETURNING id, type, status, device_id;
```

The start-up variant drops the time condition; the periodic one drops `locked_by <> $1`. Rows that come back `FAILED` get their `on_failed` hook.

### 4.5 Idempotency per job type

Every handler is safe to run twice. Rule: do the slow outside calls first, outside any transaction; then write all results for one device in one short transaction that starts with `SELECT … FROM device WHERE id = $1 FOR UPDATE`. A missing device means the user deleted it: finish `DONE`, write nothing.

| Type | Steps | Why rerun is safe |
|---|---|---|
| `CHECK_DEVICE` | 1. If `sbom.parsed_at IS NULL`: parse (`sbom.rs`), replace all `SBOM` components, set `parsed_at` (own tx). 2. Manual component with CPE + comparable version: make sure the product's CVEs are cached (`cpe_product.cves_fetched_at` older than 7 days → NVD fetch by `virtualMatchString`, upsert `vulnerability` + `cpe_product_cve`); match with `cpe.rs` / `version.rs`. 3. If SBOM components exist: write content to a temp file, run Trivy, map by purl. 4. Tx: set each component's `check`, upsert findings on `(component_id, vulnerability_id)` (keep `state` and `ignored_reason`, set `last_seen_at`), delete findings of this device not seen in this run, recompute status (section 5), write counts, `last_checked_at = now()`, and if `check_job_id = this job`: `check_state = IDLE`. | Replace semantics keyed on the unique constraint; the parse step is skipped once `parsed_at` is set. |
| `RECOMPUTE_STATUS` | Tx: lock device, recompute status and counts from current rows. | Pure function of the rows. |
| `SEARCH_PRODUCTS` | NVD CPE `keywordSearch`; drop deprecated; group by `part:vendor:product`; upsert `cpe_product`; set `product_search` `READY`, `cpes` (max 8, NVD order), `fetched_at`. | Upserts only. |
| `RESCAN_ALL` | 1. Trivy DB update if older than 12 h (failure is logged in `data_source`, not fatal, D23). 2. KEV import if older than 12 h (same). 3. Housekeeping deletes (section 2). 4. One `INSERT … SELECT` of `CHECK_DEVICE` (priority 0) for every device (or the user's) without a queued check, plus the matching `device` update, then one `pg_notify`. | Steps 1 to 2 are freshness-gated; step 4 skips devices that already have a queued check. |
| `UPDATE_TRIVY_DB` | `trivy image --download-db-only --cache-dir /var/cache/trivy`; read `db/metadata.json` `UpdatedAt` into `data_source.data_updated_at`. | Trivy replaces its DB atomically. |
| `IMPORT_KEV` | Download the CISA KEV JSON; in one tx replace `kev_entry`; `UPDATE vulnerability SET exploited = (id IN kev)`; queue `RECOMPUTE_STATUS` for devices with open findings whose `exploited` changed. If download or parse fails, keep the old list (P5-6). | Full replace in one tx. |
| `DEV_NOOP` | Sleep `sleepMs`, then done. | Nothing written. |

Vulnerability rows are global. `exploited` is always set from `kev_entry` when a row is written, so the order of KEV import and CVE fetch does not matter.

### 4.6 NVD and Trivy inside the worker

- `nvd.rs`: one client, one limiter (sliding window: 5 per 30 s, or 50 per 30 s with `NVD_API_KEY`). Waits, never fails, on its own limit. On 403/429/503/network error: retry after 6 s, then 30 s; the third failure returns `NVD_UNAVAILABLE` (P5-1). The key goes in the `apiKey` header and is never logged (redact it in the `Debug` impl of the config). Base URL comes from `NVD_BASE_URL` (default `https://services.nvd.nist.gov`) so tests and e2e use a stub.
- Every success updates `data_source NVD`. Every final failure sets its `last_error_code` (P8-5).
- `trivy.rs`: `trivy sbom --format json --scanners vuln --list-all-pkgs --skip-db-update --offline-scan --quiet --cache-dir <dir> <file>`. A component counts as `CHECKED` only when Trivy lists it among the packages it understood (`--list-all-pkgs`); other components with a purl are `UNSUPPORTED`. Without this, Trivy's silence on, say, Windows apps would read as "No known vulnerabilities".
- `kev.rs`: `KEV_URL` (default the CISA JSON feed).
- Trivy binary path from `TRIVY_PATH` (default `trivy`) so e2e can use a fake script that prints a fixture.

### 4.7 Scheduler

- `RESCAN_CRON` (5 fields, default `0 3 * * *`) is parsed at start with the `croner` crate, in the container's local time (`TZ` env; image has `tzdata`). Invalid: the worker exits with "RESCAN_CRON is not a valid schedule: <value>" (P8-1).
- The scheduler task computes the next time, writes it to `worker_status.next_rescan_at`, sleeps in steps of at most 60 s (survives clock changes), and at the time inserts `RESCAN_ALL { userId: null }` unless one is `QUEUED` or `RUNNING`.
- Catch-up at start: if the newest `RESCAN_ALL` with `user_id IS NULL` is older than 25 hours and at least one device exists, queue one now (the NAS was off at 03:00).
- Bootstrap at start: queue `UPDATE_TRIVY_DB` if `/var/cache/trivy/db/trivy.db` is missing; queue `IMPORT_KEV` if `kev_entry` is empty or older than 24 hours. Same "unless already queued" rule.

### 4.8 Product search end to end (D6)

1. Browser: `GET /api/products?q=xbox` (after debounce).
2. `src/server/products.ts` normalizes `q` and runs one statement that decides whether a fetch is needed:

```sql
INSERT INTO product_search (query, status, requested_at)
VALUES ($1, 'PENDING', now())
ON CONFLICT (query) DO UPDATE
  SET status = 'PENDING', requested_at = now()
  WHERE (product_search.status = 'READY'   AND product_search.fetched_at   < now() - interval '30 days')
     OR (product_search.status = 'FAILED'  AND product_search.requested_at < now() - interval '1 minute')
     OR (product_search.status = 'PENDING' AND product_search.requested_at < now() - interval '2 minutes')
RETURNING query;
```

   A returned row means "this request must queue the job": in the same transaction, refuse with 429 if more than 10 `SEARCH_PRODUCTS` jobs are `QUEUED`, else `enqueueJob(SEARCH_PRODUCTS)` and store `job_id`. Two tabs typing the same word queue one job.
3. Read the row (and the `cpe_product` rows for `cpes`, in order) and answer `READY`, `PENDING` (with stale products when refreshing) or `FAILED`.
4. The worker fills the cache. The browser polls the same URL every 1 s; the cache hit is a PK lookup plus one `IN` query.

The product cache is global (not user data). It only stores public NVD data.

### 4.9 Contract test fixtures

```
contracts/
├─ jobs/CHECK_DEVICE.json … DEV_NOOP.json   one valid payload per JobType
├─ jobs/invalid/*.json                      payloads both sides must reject
└─ risk-levels.json                         [{ cvssScore, severity, exploited, level }] and device-status cases
```

- Web: `web/src/lib/contracts/contracts.test.ts` parses every file with `JobPayloadSchemas`, checks `risk.ts` against `risk-levels.json`, and checks every Zod enum against the Prisma generated enums.
- Worker: `worker/tests/contract.rs` parses the same files with serde, checks `status.rs` against `risk-levels.json`, and parses the `enum` blocks out of `../web/prisma/schema.prisma` to check the Rust enums have the same variants.

---

## 5. Risk and status rules (one definition, two implementations)

Implemented in `worker/src/status.rs` (writes `device.status`) and `web/src/lib/contracts/risk.ts` (filters and labels). Both are tested against `contracts/risk-levels.json`.

Per vulnerability:
- `effectiveScore = cvssScore ?? { CRITICAL: 9.0, HIGH: 7.0, MEDIUM: 4.0, LOW: 0.1, UNKNOWN: null }[severity]`.
- Level: `exploited` or score ≥ 9.0 → `critical`; score ≥ 4.0 → `vulnerable`; otherwise (also null) → `low` (shown in the `update` color with label "Low").
- Worst first: level, then `exploited`, then score (nulls last), then ID.

Per device (open findings only, D7, D8):

| Condition, first match wins | `status` |
|---|---|
| Any open finding at `critical` | `CRITICAL` |
| Any open finding at `vulnerable` | `VULNERABLE` |
| Any open finding | `UPDATE_AVAILABLE` |
| No component is `CHECKED` | `NOT_TRACKED` |
| Otherwise | `NO_KNOWN_VULNS` (UI adds "N parts not checked" when `uncheckedCount > 0`) |

`PENDING` exists only between create and the first finished check. Counts written together with status: `componentCount`, `uncheckedCount` (components not `CHECKED`), `openFindingCount`, and `targetVersion` (highest `fixedVersion` among open findings on the manual component, compared with `version.rs`; null if none or not comparable).

Component `check` values set by the worker: no CPE and no purl → `NO_IDENTIFIER`; no version → `NO_VERSION`; version `version.rs` cannot parse → `BAD_VERSION`; purl not understood by Trivy → `UNSUPPORTED`; otherwise `CHECKED`.

---

## 6. File ownership and order of work

### 6.1 Who owns what

| Path | Owner | Notes |
|---|---|---|
| `web/prisma/**`, `web/prisma.config.ts` | backend | |
| `web/src/lib/contracts/**` | backend | Frontend must review every change. Frontend imports, never edits. |
| `web/src/lib/{db,env,auth,auth-client,jobs}.ts` | backend | `auth-client.ts` is the Better Auth React client the pages use. |
| `web/src/server/**` | backend | One file per area: `devices.ts`, `components.ts`, `sboms.ts`, `products.ts`, `vulnerabilities.ts`, `findings.ts`, `jobs.ts`, `checks.ts`, `http.ts`. |
| `web/src/app/api/**`, `web/src/proxy.ts` | backend | |
| `web/scripts/**` | backend | `dev-db.mjs`, `reset-password.mjs`, `docker-entrypoint.sh` |
| `worker/**` | backend | |
| `contracts/**` | backend | Fixtures only, no code. |
| `docker-compose.yml`, `.env.example`, `web/Dockerfile`, `worker/Dockerfile`, `.github/workflows/**` | backend | |
| `web/src/app/(auth)/**`, `web/src/app/(app)/**`, `web/src/app/layout.tsx`, `web/src/app/globals.css`, `web/src/app/tokens.css`, fonts | frontend | Pages stay thin; the server component calls `requireSession()` from `src/lib/auth.ts`. |
| `web/src/components/ui/**`, `web/src/features/**`, `web/src/store/**` | frontend | RTK Query endpoints per feature with `injectEndpoints` on `src/store/api.ts`. Fixtures typed with contract types live in `src/features/<f>/fixtures.ts`. |
| `web/e2e/**`, `web/playwright.config.ts` | e2e-tester | |
| `web/package.json`, lockfile | both | One dependency change per PR, rebase before merge. Do not reformat. |
| `web/next.config.ts`, `web/eslint.config.mjs`, `web/vitest.config.ts` | backend | Frontend asks for changes. |

Rule of thumb: frontend never writes under `src/app/api`, `src/server` or `src/lib`; backend never writes under `src/components`, `src/features` or `src/store`. The only shared surface is `src/lib/contracts/`, and it changes through a PR the other side reviews.

### 6.2 Order

Wave 0, backend, short and sequential (blocks everyone):
1. `PR-00 web scaffold`: Next 16, TS strict, ESLint, Prettier, Tailwind, Vitest, `scripts/dev-db.mjs`, `.env.example`, `src/lib/env.ts` (Zod over `process.env`; `BETTER_AUTH_SECRET` ≥ 32 chars or exit).
2. `PR-01 worker scaffold`: crate, config, connect with retry, schema check, log "ready", clippy, fmt.
3. `PR-02 CI`: workflow from section 7.3 on the two scaffolds; `docker-compose.yml` with `db` only.

Wave 1, the contract freeze (backend, one PR, reviewed by frontend and architect):
4. `PR-03 schema + contracts`: `schema.prisma` from section 2, `prisma/migrations/0001_init`, `prisma.config.ts`, `src/lib/db.ts`, `src/lib/contracts/{enums,api,jobs,risk}.ts` (types and schemas from sections 3 to 5, `risk.ts` implemented with tests), `contracts/` fixtures, `worker/src/contract.rs`, sync tests on both sides.

From here both tracks run in parallel.

| Phase | Backend track | Frontend track |
|---|---|---|
| 2 (can start after PR-00, does not need PR-03) | | tokens + fonts, Tailwind mapping; primitives + `/ui` (dev only); store + base api + typed hooks; app shell |
| 1 | Better Auth config, `/api/auth/[...all]`, `auth-client.ts`, `requireSession`, `withSession`, `proxy.ts`, `ALLOW_SIGNUP` | login and signup pages, `(app)` layout with sign-out (after backend auth PR) |
| 3 | `src/server/devices.ts` + routes (`GET/POST/PATCH/DELETE`), cross-user tests; Phase 3 sets `NOT_TRACKED` on create, no jobs | `DeviceIcon`, `RiskBadge`, `VersionTag`, `DeviceCard`, `AddDeviceTile`, `DeviceTypePicker` (with fixtures); then My home, add device (product `kind: "other"`), detail, edit, delete |
| 4 | worker job loop, reaper, retries; `enqueueJob`/`enqueueCheck`; `/api/jobs/:id`, `/api/devices/:id/scan`, `/api/dev/jobs` | `useJobWatcher`, `ScanProgress`, Check again |
| 5 | `nvd.rs`, `version.rs`, `cpe.rs`, `status.rs`, `jobs/check_device.rs` (manual part), `jobs/search_products.rs`, `jobs/recompute_status.rs`, `jobs/import_kev.rs`; `/api/products`; web switches create/edit to `enqueueCheck` | `ProductSearch` radio list with polling, result card (D9), "Not tracked" texts |
| 6 | `sbom.rs`, `trivy.rs`, `jobs/update_trivy_db.rs`, SBOM part of `check_device.rs`; upload route; `/api/devices/:id/components` | SBOM card with `FileDrop`, help panel, software list with "N parts not checked" |
| 7 | `/api/vulnerabilities`, `/api/vulnerabilities/:cveId`, `PATCH /api/findings/:id` | `CveItem`, What to do card, NetworkSummary, banner, vulnerabilities list + detail, ignore dialog |
| 8 | scheduler, `jobs/rescan_all.rs`, heartbeat, `/api/checks`, `/api/checks/run`, change password config | Settings: Account, Checks |
| 9 | Dockerfiles, full compose, release workflow, README, reset-password script | none (e2e-tester: Playwright against compose) |

The frontend never waits on a route to build a component: components take contract types as props and are tested with the fixtures. Wiring a page to RTK Query waits for the matching backend route PR. Each backend route PR adds a `fixtures.ts`-compatible example response in its test so both sides agree on the shape.

---

## 7. Docker, compose, CI, local verification

ADR 0006 has the reasoning.

### 7.1 Images (Phase 9)

`web/Dockerfile`:
- Build on `$BUILDPLATFORM` (`node:22-alpine`): `npm ci`, `prisma generate`, `next build` with `output: "standalone"` and `images: { unoptimized: true }` (no `sharp`). Prisma 7 with `@prisma/adapter-pg` has no native engine, so the JS output is the same for amd64 and arm64.
- Runtime `node:22-alpine` for `$TARGETPLATFORM`, user `node`: standalone output, `prisma/` (schema + migrations), `prisma.config.ts`, the `prisma` CLI package, `scripts/`. `NODE_OPTIONS=--max-old-space-size=192`.
- Entrypoint `scripts/docker-entrypoint.sh`: `prisma migrate deploy` (exit on failure, P9-1), then `exec node server.js`.

`worker/Dockerfile`:
- Build on `$BUILDPLATFORM` with `cargo-zigbuild` for `x86_64-unknown-linux-musl` or `aarch64-unknown-linux-musl` (no QEMU for Rust). `reqwest` with `rustls`, no OpenSSL.
- Runtime `alpine:3.22` + `ca-certificates` + `tzdata`, Trivy binary copied from a pinned multi-arch `aquasec/trivy:<version>` image, user `10001`, `VOLUME /var/cache/trivy`.
- `worker healthcheck` subcommand: exit 0 when `worker_status.heartbeat_at` is younger than 90 s.

### 7.2 Compose

| Service | Image | Healthcheck | Depends on | Notes |
|---|---|---|---|---|
| `db` | `postgres:17-alpine` | `pg_isready` | | `-c shared_buffers=64MB -c max_connections=30 -c work_mem=4MB`; volume `db-data`; port only on `127.0.0.1:${DB_PORT:-5432}` for dev and `pg_dump` |
| `web` | `ghcr.io/<owner>/homeward-web:<tag>` | `node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"` | `db` healthy | port `3000`; migrations on start |
| `worker` | `ghcr.io/<owner>/homeward-worker:<tag>` | `["CMD", "/app/worker", "healthcheck"]` | `db` healthy, `web` healthy (migrations done) | volume `trivy-cache`; one replica only |

All three: `restart: unless-stopped`, `env_file: .env`. Same image tag for web and worker; they are released together. Connection pools: web 5, worker 5 (listener, two lanes, scheduler, spare).

Memory target (P9-5), idle: db ~80 MB, web ~150 MB, worker ~20 MB. Trivy adds a few hundred MB only while a scan or DB update runs; that is outside the idle budget and stated in the README.

New env vars (add to `.env.example` and plan section 12): `TZ` (schedule time zone), `DB_PORT`. Test-only, not in the README install steps: `NVD_BASE_URL`, `KEV_URL`, `TRIVY_PATH`.

### 7.3 CI (`.github/workflows/ci.yml`, on every PR)

- `web` job (Node 22, Postgres 17 service): `npm ci`, `prisma validate`, drift check `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` (shadow DB = the service), `tsc --noEmit`, `eslint`, `vitest run` (unit + DB tests), `next build`.
- `worker` job (stable Rust, same Postgres service): `cargo fmt --check`, `cargo clippy -- -D warnings`, apply migrations with `prisma migrate deploy` from `web/`, `cargo test` with `TEST_DATABASE_URL` and `REQUIRE_DB_TESTS=1`.
- `grep` guard: fail if `worker/src` contains `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE` or `sqlx::migrate` (P2-1).
- `release.yml` (on tag `v*`): buildx for `linux/amd64,linux/arm64`, push both images, then the Playwright happy paths against `docker compose` with the NVD/KEV stub and fake Trivy (P9-8).

### 7.4 Verifying without Docker (this sandbox: Node 22, cargo, no Docker, no Postgres)

- Database: `web/scripts/dev-db.mjs` uses the `embedded-postgres` dev dependency (pinned `17.x`, real Postgres binaries for linux x64/arm64 and macOS from npm). It starts Postgres on `127.0.0.1:54329`, data in `web/.devdb/` (gitignored), and prints the `DATABASE_URL`. `npm run db:dev` runs it. Verified here: Postgres 17.10 starts, `0001_init` applies, the claim SQL and `LISTEN/NOTIFY` work.
- Schema without any database: `prisma validate`, `prisma generate`, and new migrations with `prisma migrate diff --from-migrations … --to-schema … --script` (against the embedded DB as shadow) or `prisma migrate dev` against the embedded DB.
- Web tests: plain unit tests need nothing. Files named `*.db.test.ts` use a Vitest `globalSetup` that starts `embedded-postgres` on a free port, runs `prisma migrate deploy`, and truncates tables between tests. Same tests in CI against the service container.
- Worker: `sqlx::query` / `query_as` (runtime, no `query!` macros), so it builds without a database. Pure modules (`version`, `cpe`, `sbom`, `trivy` parsing, `status`, `contract`) are unit tests with fixtures. DB tests read `TEST_DATABASE_URL` (point it at the embedded DB) and skip with a printed note when it is unset, unless `REQUIRE_DB_TESTS=1`.
- Full local run: `npm run db:dev`, `npx prisma migrate deploy`, `npm run dev`, `cargo run` in `worker/` with the same `DATABASE_URL` and `TRIVY_PATH` pointing at the fake script. Trivy itself is not installed in the sandbox; Trivy parsing is covered by fixtures.
- Not verifiable here: Dockerfiles, compose, multi-arch builds, memory budget. These are covered only by CI and the Phase 9 checks.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Rust enums or payloads drift from Prisma | Sync tests in both CI jobs (section 4.9). |
| Trivy's silence read as "no vulnerabilities" | `--list-all-pkgs`; only understood packages are `CHECKED` (section 4.6). |
| Product search burns the NVD budget | Debounce, min 2 letters, one job per normalized query, max 10 queued, 30-day cache, `maxAttempts = 1`. |
| A long check blocks search | Separate fast lane. |
| NVD slow without a key during `RESCAN_ALL` | 7-day product CVE cache; the limiter waits; 10-minute timeout per device, not per rescan. |
| Worker crash leaves `RUNNING` jobs or `CHECKING` devices | Reaper at start and every 30 s; `on_failed` resets the device. |
| 20 MB uploads in Next.js memory | `Content-Length` check first; one upload is ~40 MB peak; `MAX_SBOM_MB` is the cap. |
| `sbom.content` pulled into list queries | Review rule: `select` without `content`; a Vitest test on `src/server/devices.ts` asserts the shape. |
| Two workers started by mistake | Claims stay safe with `SKIP LOCKED`; start-up reaping could retry the other worker's job once. Documented: run one worker. |
| Prisma 8 becomes stable mid-project | Stay on 7.10 for V1 (ADR 0005). |

## 9. Tests (minimum per area)

- Web unit: every Zod schema (good and bad inputs, messages), `risk.ts` against `contracts/risk-levels.json`, upload sniffing, query normalization.
- Web DB (`*.db.test.ts`): cross-user 404s for every device, finding, vulnerability and job function (P3-1); `enqueueCheck` reuse of a queued job; version change writes `version_change` and queues a check; product search insert-or-refresh SQL (fresh, stale, failed, stuck cases); `select` never returns `content`.
- Worker unit: `version.rs` table (P5-3), `cpe.rs` on NVD fixtures (P5-4), `sbom.rs` on CycloneDX and SPDX fixtures (P6-2), `trivy.rs` on Trivy JSON fixtures (P6-4), `status.rs` on `risk-levels.json`, NVD limiter timing with a mock clock, contract sync.
- Worker DB: claim order and `SKIP LOCKED` with two connections, retry backoff, final failure hook, reaper, `CHECK_DEVICE` twice gives the same rows, ignored finding keeps its state on rerun, deleted device finishes `DONE`.
- E2E: P9-8 paths, with the NVD/KEV stub and fake Trivy.


---

## 10. Deviations made while building (backend track)

- `component."check"`: `check` is a reserved SQL word. Worker SQL must quote it (`"check"`). Prisma already does.
- Prisma columns are `timestamp(3)` (no zone, UTC, millisecond precision). The worker opens every session with `TimeZone=UTC`, casts to `timestamptz` when it reads, and never compares rows by time: stale findings are removed by id (a `last_seen_at < now()` rule deleted fresh rows when rounding went down).
- Product CVE cache lifetime is 24 hours, not 7 days, so the nightly rescan sees new CVEs. If NVD is down and an older list exists, the check uses the old list and `data_source` shows the error.
- SBOM components with a CPE but no purl are `UNSUPPORTED` (NVD matching is for the manual product only). A new SBOM upload keeps component rows (and ignored findings) that are unchanged.
- `TRUSTED_ORIGINS` (env, optional) lists extra origins for Better Auth. `TRIVY_CACHE_DIR` sets the Trivy cache.
- `prisma` and `dotenv` moved to `dependencies` in `web/package.json` (the image runs `prisma migrate deploy`). Tools (migration CLI, scripts) live in `/app/tools` of the web image; reset password: `node /app/tools/scripts/reset-password.mjs`.
- SBOM upload also refuses JSON nested deeper than 128 levels (same limit as the worker's parser) and reads the body in a capped stream.
- Compose picks images with `HOMEWARD_OWNER` and `HOMEWARD_TAG`. `release.yml` builds and pushes both images; the Playwright run against compose (P9-8) is not in it yet.
- Dockerfiles, compose and the release workflow could not be built or run here (no Docker).
- Compose has `build:` contexts for `web` and `worker` next to `image:`, so `docker compose up -d --build` works without published images. The web container checks `BETTER_AUTH_SECRET` and `DATABASE_URL` at start (`docker-entrypoint.sh`, `src/instrumentation.ts`) and exits with a plain message. Memory targets (under 512 MB idle) are not measured yet.
- The Playwright suite is the V1 gate on embedded Postgres and a mock NVD; a manual `docker compose` run is the release gate. A compose CI job is on the Later list.
