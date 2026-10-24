// HTTP API types and request schemas. Source of truth: docs/architecture-v1.md section 3.
// Shared by route handlers, src/server/, RTK Query endpoints and forms.
import { z } from "zod";
import type {
  CheckState,
  ComponentCheck,
  ComponentSource,
  DataSourceId,
  DeviceStatus,
  DeviceType,
  FindingSource,
  FindingState,
  JobErrorCode,
  JobStatus,
  JobType,
  SbomFormat,
  Severity,
} from "./enums";
import { DeviceTypeSchema, FindingStateSchema } from "./enums";
import type { RiskLevel } from "./risk";

export type ApiErrorCode =
  | "VALIDATION_FAILED" // 400
  | "UNAUTHORIZED" // 401
  | "FORBIDDEN" // 403, request came from another site
  | "NOT_FOUND" // 404
  | "PAYLOAD_TOO_LARGE" // 413
  | "UNSUPPORTED_FILE" // 415
  | "RATE_LIMITED" // 429
  | "INTERNAL"; // 500, message is always "Something went wrong. Try again."

export type ApiError = {
  error: {
    code: ApiErrorCode;
    message: string; // plain text, safe to show
    fields?: Record<string, string>; // Zod field path -> message, for 400 only
  };
};

export type IsoDate = string;

export type DeviceCheck = {
  state: CheckState; // CHECKING -> show "Checking…" and poll jobId
  jobId: string | null;
  errorCode: JobErrorCode | null; // set when state = FAILED; UI maps to text
};

export type ManualProduct = {
  componentId: string;
  name: string; // CPE title, or the free text the user typed
  vendor: string | null;
  cpe: string | null; // null = "Other" / free text = not tracked
  version: string | null; // null = "version ?"
  check: ComponentCheck; // BAD_VERSION -> "We can't compare this version."
};

export type DeviceSummary = {
  id: string;
  name: string;
  type: DeviceType;
  room: string | null;
  product: ManualProduct | null; // null only for SBOM-only devices
  status: DeviceStatus;
  check: DeviceCheck;
  targetVersion: string | null; // "Update to <targetVersion>"; null hides the arrow
  openFindingCount: number;
  componentCount: number;
  uncheckedCount: number; // D7: "N parts not checked"
  hasSbom: boolean;
  lastCheckedAt: IsoDate | null;
};

export type VulnerabilitySummary = {
  id: string; // "CVE-2024-1234" or "GHSA-…"
  severity: Severity;
  cvssScore: number | null;
  exploited: boolean;
  summary: string; // full NVD text; UI shows the first two sentences (D11)
  publishedAt: IsoDate | null;
  nvdUrl: string | null; // only for CVE-* ids
};

export type DeviceFinding = {
  id: string;
  state: FindingState;
  ignoredReason: string | null;
  fixedVersion: string | null; // null -> "No fix known yet."
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
  findings: DeviceFinding[]; // OPEN first, then IGNORED; each group worst first (section 5)
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
  worstLevel: RiskLevel | null; // null when no open findings
};

export type ProductOption = {
  cpe: string; // base CPE, no version
  title: string;
  vendor: string;
  latestVersion: string | null; // hint, may be null
};

export type ProductSearchResponse = {
  query: string; // normalized
  status: "READY" | "PENDING" | "FAILED";
  products: ProductOption[]; // max 8; may be non-empty while PENDING (stale refresh)
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
  productTitle: string | null; // "Security problem in <productTitle>" (D11)
};

export type JobView = {
  id: string;
  type: JobType;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  errorCode: JobErrorCode | null;
  nextAttemptAt: IsoDate | null; // set when QUEUED after a failed attempt
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
    on: boolean; // worker heartbeat younger than 2 minutes
    lastCheckAt: IsoDate | null; // newest finished CHECK_DEVICE of this user
    nextCheckAt: IsoDate | null;
    rescanCron: string | null; // read-only, "Set in .env" (D12)
    nvdApiKeySet: boolean;
  };
  sources: Record<DataSourceId, SourceView>;
  checkingDeviceCount: number; // "Check all now" is disabled while > 0 or activeRescanJobId != null
  activeRescanJobId: string | null;
  recent: RecentCheck[]; // last 10
};

// ---------- Request schemas ----------

const deviceName = z
  .string()
  .trim()
  .min(1, "Give your device a name.")
  .max(80, "Use 80 characters or fewer.");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional();
const version = z
  .string()
  .trim()
  .max(64)
  .transform((s) => (s === "" ? null : s))
  .nullable(); // null = "I don't know"
export const BaseCpeSchema = z.string().regex(/^cpe:2\.3:[aho]:[^:*]+:[^:*]+$/);

export const ProductInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("catalog"), cpe: BaseCpeSchema }), // Phase 5+
  z.object({ kind: z.literal("other"), name: z.string().trim().max(120) }), // free text; "" = I don't know
]);

export const CreateDeviceSchema = z.object({
  type: DeviceTypeSchema,
  name: deviceName,
  room: optionalText(40),
  notes: optionalText(500),
  product: ProductInputSchema,
  version,
});

export const UpdateDeviceSchema = z
  .object({
    name: deviceName.optional(),
    room: optionalText(40),
    notes: optionalText(500),
    product: ProductInputSchema.optional(),
    version: version.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Change at least one field.");

export const ProductSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .toLowerCase()
    .transform((s) => s.replace(/\s+/g, " "))
    .pipe(z.string().min(2, "Type at least 2 letters.").max(60)),
});

export const VulnerabilityListQuerySchema = z.object({
  deviceId: z.string().optional(),
  level: z.enum(["critical", "vulnerable", "low"]).optional(),
  state: FindingStateSchema.default("OPEN"),
});

export const UpdateFindingSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("IGNORED"),
    reason: z
      .string()
      .trim()
      .min(1, "Add a short reason.")
      .max(200, "Use 200 characters or fewer."),
  }),
  z.object({ state: z.literal("OPEN") }),
]);
