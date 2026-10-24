import { describe, expect, it } from "vitest";
import type { DeviceFinding } from "./api";
import type { Severity } from "./enums";
import { compareFindingsWorstFirst, effectiveScore } from "./risk";

function finding(
  id: string,
  cvssScore: number | null,
  severity: Severity,
  exploited = false,
): DeviceFinding {
  return {
    id,
    state: "OPEN",
    ignoredReason: null,
    fixedVersion: null,
    source: "NVD",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    component: { id: "c", name: "x", version: null },
    vulnerability: {
      id,
      severity,
      cvssScore,
      exploited,
      summary: "",
      publishedAt: null,
      nvdUrl: null,
    },
  };
}

describe("effectiveScore", () => {
  it("prefers the CVSS score", () => {
    expect(effectiveScore({ cvssScore: 5.5, severity: "HIGH" })).toBe(5.5);
  });

  it("falls back to the lowest score of the severity band", () => {
    expect(effectiveScore({ cvssScore: null, severity: "HIGH" })).toBe(7.0);
  });

  it("is null for UNKNOWN without a score", () => {
    expect(effectiveScore({ cvssScore: null, severity: "UNKNOWN" })).toBeNull();
  });
});

describe("compareFindingsWorstFirst", () => {
  it("orders by level, exploited, score (missing last), then id", () => {
    const list = [
      finding("CVE-3", null, "UNKNOWN"),
      finding("CVE-2", 5.0, "MEDIUM"),
      finding("CVE-1b", 9.5, "CRITICAL"),
      finding("CVE-4", 1.0, "LOW", true),
      finding("CVE-1a", 9.5, "CRITICAL"),
      finding("CVE-5", 6.0, "MEDIUM"),
    ];
    const ids = list.sort(compareFindingsWorstFirst).map((f) => f.id);
    expect(ids).toEqual(["CVE-4", "CVE-1a", "CVE-1b", "CVE-5", "CVE-2", "CVE-3"]);
  });
});
