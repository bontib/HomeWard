// Turns database rows into the API types of src/lib/contracts/api.ts.
// Kept apart from the query code so routes and tests agree on one shape.
import type { Prisma } from "@/generated/prisma/client";
import type {
  DeviceFinding,
  DeviceSummary,
  ManualProduct,
  SbomView,
  VulnerabilitySummary,
} from "@/lib/contracts";

// The sbom `content` column can be 20 MB and only the worker reads it: never select it.
export const SBOM_VIEW_SELECT = {
  fileName: true,
  format: true,
  sizeBytes: true,
  uploadedAt: true,
  parsedAt: true,
} satisfies Prisma.SbomSelect;

export const DEVICE_SUMMARY_INCLUDE = {
  components: { where: { source: "MANUAL" }, take: 1, orderBy: { id: "asc" } },
  sbom: { select: { id: true } },
} satisfies Prisma.DeviceInclude;

export type DeviceSummaryRow = Prisma.DeviceGetPayload<{
  include: typeof DEVICE_SUMMARY_INCLUDE;
}>;

export const VULNERABILITY_SUMMARY_SELECT = {
  id: true,
  severity: true,
  cvssScore: true,
  exploited: true,
  summary: true,
  publishedAt: true,
} satisfies Prisma.VulnerabilitySelect;

export const FINDING_SELECT = {
  id: true,
  state: true,
  ignoredReason: true,
  fixedVersion: true,
  source: true,
  firstSeenAt: true,
  component: { select: { id: true, name: true, version: true } },
  vulnerability: { select: VULNERABILITY_SUMMARY_SELECT },
} satisfies Prisma.FindingSelect;

export type FindingRowData = Prisma.FindingGetPayload<{ select: typeof FINDING_SELECT }>;

export function nvdUrl(id: string): string | null {
  return id.startsWith("CVE-") ? `https://nvd.nist.gov/vuln/detail/${id}` : null;
}

export function toVulnerabilitySummary(v: FindingRowData["vulnerability"]): VulnerabilitySummary {
  return {
    id: v.id,
    severity: v.severity,
    cvssScore: v.cvssScore,
    exploited: v.exploited,
    summary: v.summary,
    publishedAt: v.publishedAt?.toISOString() ?? null,
    nvdUrl: nvdUrl(v.id),
  };
}

export function toDeviceFinding(f: FindingRowData): DeviceFinding {
  return {
    id: f.id,
    state: f.state,
    ignoredReason: f.ignoredReason,
    fixedVersion: f.fixedVersion,
    source: f.source,
    firstSeenAt: f.firstSeenAt.toISOString(),
    component: f.component,
    vulnerability: toVulnerabilitySummary(f.vulnerability),
  };
}

export function toSbomView(
  s: Prisma.SbomGetPayload<{ select: typeof SBOM_VIEW_SELECT }>,
): SbomView {
  return {
    fileName: s.fileName,
    format: s.format,
    sizeBytes: s.sizeBytes,
    uploadedAt: s.uploadedAt.toISOString(),
    parsedAt: s.parsedAt?.toISOString() ?? null,
  };
}

function toManualProduct(
  c: DeviceSummaryRow["components"][number] | undefined,
): ManualProduct | null {
  if (!c) return null;
  return {
    componentId: c.id,
    name: c.name,
    vendor: c.vendor,
    cpe: c.cpe,
    version: c.version,
    check: c.check,
  };
}

// The detail query selects more sbom fields than the list; only its presence matters here.
type SummarySource = Omit<DeviceSummaryRow, "sbom"> & { sbom: object | null };

export function toDeviceSummary(d: SummarySource): DeviceSummary {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    room: d.room,
    product: toManualProduct(d.components[0]),
    status: d.status,
    check: { state: d.checkState, jobId: d.checkJobId, errorCode: d.checkErrorCode },
    targetVersion: d.targetVersion,
    openFindingCount: d.openFindingCount,
    componentCount: d.componentCount,
    uncheckedCount: d.uncheckedCount,
    hasSbom: d.sbom !== null,
    lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
  };
}
