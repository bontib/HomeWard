import type { FindingState, RiskLevel } from "@/lib/contracts";

export type VulnerabilityFilters = { deviceId?: string; level?: RiskLevel; state: FindingState };

export const LEVELS: RiskLevel[] = ["critical", "vulnerable", "low"];

export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): VulnerabilityFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const level = one(params.level);
  const state = one(params.state);
  return {
    deviceId: one(params.deviceId) || undefined,
    level: LEVELS.find((l) => l === level),
    state: state === "IGNORED" ? "IGNORED" : "OPEN",
  };
}
