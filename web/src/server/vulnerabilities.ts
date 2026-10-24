import type { z } from "zod";
import type {
  AffectedDevice,
  FindingRow,
  VulnerabilityDetail,
  VulnerabilityListQuerySchema,
} from "@/lib/contracts";
import { compareFindingsWorstFirst, riskLevel } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { notFound } from "./errors";
import { FINDING_SELECT, toDeviceFinding } from "./views";

type ListQuery = z.output<typeof VulnerabilityListQuerySchema>;

export async function listVulnerabilities(
  userId: string,
  query: ListQuery,
): Promise<{ findings: FindingRow[]; notFullyCheckedDeviceCount: number }> {
  const db = getDb();
  const rows = await db.finding.findMany({
    where: {
      state: query.state,
      device: { userId },
      ...(query.deviceId && { deviceId: query.deviceId }),
    },
    select: { ...FINDING_SELECT, device: { select: { id: true, name: true, type: true } } },
  });
  const findings = rows
    .map((row): FindingRow => ({ ...toDeviceFinding(row), device: row.device }))
    .filter((f) => !query.level || riskLevel(f.vulnerability) === query.level)
    .sort(compareFindingsWorstFirst);

  const notFullyCheckedDeviceCount = await db.device.count({
    where: { userId, uncheckedCount: { gt: 0 }, ...(query.deviceId && { id: query.deviceId }) },
  });
  return { findings, notFullyCheckedDeviceCount };
}

export async function getVulnerabilityDetail(
  userId: string,
  cveId: string,
): Promise<{ vulnerability: VulnerabilityDetail; affected: AffectedDevice[] }> {
  const db = getDb();
  const findings = await db.finding.findMany({
    where: { vulnerabilityId: cveId, device: { userId } },
    select: {
      id: true,
      state: true,
      fixedVersion: true,
      component: { select: { name: true, version: true } },
      device: { select: { id: true, name: true, type: true, room: true } },
    },
    orderBy: { device: { name: "asc" } },
  });
  // Not on any of my devices: the same answer as "does not exist".
  const first = findings[0];
  if (!first) throw notFound("That problem");

  const v = await db.vulnerability.findUniqueOrThrow({ where: { id: cveId } });
  const affected = findings.map((f): AffectedDevice => ({
    device: f.device,
    findingId: f.id,
    state: f.state,
    fixedVersion: f.fixedVersion,
    componentName: f.component.name,
    componentVersion: f.component.version,
  }));
  return {
    vulnerability: {
      id: v.id,
      severity: v.severity,
      cvssScore: v.cvssScore,
      exploited: v.exploited,
      summary: v.summary,
      publishedAt: v.publishedAt?.toISOString() ?? null,
      nvdUrl: v.id.startsWith("CVE-") ? `https://nvd.nist.gov/vuln/detail/${v.id}` : null,
      cvssVector: v.cvssVector,
      modifiedAt: v.modifiedAt?.toISOString() ?? null,
      fetchedAt: v.fetchedAt.toISOString(),
      references: referenceUrls(v.references),
      productTitle: first.component.name,
    },
    affected,
  };
}

function referenceUrls(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((u): u is string => typeof u === "string") : [];
}
