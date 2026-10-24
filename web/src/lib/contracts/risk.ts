// Risk rules. Source of truth: docs/architecture-v1.md section 5.
// The worker (worker/src/status.rs) writes device.status; this file is for display,
// filters and sorting. Both run contracts/risk-levels.json.
import type { DeviceFinding } from "./api";
import type { Severity } from "./enums";

export type RiskLevel = "critical" | "vulnerable" | "low";

const SCORE_FROM_SEVERITY: Record<Severity, number | null> = {
  CRITICAL: 9.0,
  HIGH: 7.0,
  MEDIUM: 4.0,
  LOW: 0.1,
  UNKNOWN: null,
};

type Scored = { cvssScore: number | null; severity: Severity };

export function effectiveScore(v: Scored): number | null {
  return v.cvssScore ?? SCORE_FROM_SEVERITY[v.severity];
}

export function riskLevel(v: Scored & { exploited: boolean }): RiskLevel {
  const score = effectiveScore(v);
  if (v.exploited || (score !== null && score >= 9.0)) return "critical";
  if (score !== null && score >= 4.0) return "vulnerable";
  return "low";
}

const LEVEL_RANK: Record<RiskLevel, number> = { critical: 0, vulnerable: 1, low: 2 };

/** Worst first: level, then exploited, then score (missing last), then ID. */
export function compareFindingsWorstFirst(a: DeviceFinding, b: DeviceFinding): number {
  const va = a.vulnerability;
  const vb = b.vulnerability;
  const byLevel = LEVEL_RANK[riskLevel(va)] - LEVEL_RANK[riskLevel(vb)];
  if (byLevel !== 0) return byLevel;
  if (va.exploited !== vb.exploited) return va.exploited ? -1 : 1;
  const sa = effectiveScore(va);
  const sb = effectiveScore(vb);
  if (sa !== sb) {
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sb - sa;
  }
  return va.id.localeCompare(vb.id);
}
