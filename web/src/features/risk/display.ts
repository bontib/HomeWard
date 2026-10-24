import type { DeviceStatus, RiskLevel } from "@/lib/contracts";

/** What the UI can show for a device or a vulnerability. Colors and icons come from these keys. */
export type DisplayLevel = "critical" | "vulnerable" | "update" | "safe" | "unknown" | "pending";

// "safe" shows "No known vulnerabilities" and "unknown" shows "Not tracked" on purpose:
// nothing known is not the same as safe (plan section 9, decision D4).
export const LEVEL_LABEL: Record<DisplayLevel, string> = {
  critical: "Critical",
  vulnerable: "Vulnerable",
  update: "Update available",
  safe: "No known vulnerabilities",
  unknown: "Not tracked",
  pending: "Checking…",
};

export function deviceLevel(status: DeviceStatus): DisplayLevel {
  switch (status) {
    case "CRITICAL":
      return "critical";
    case "VULNERABLE":
      return "vulnerable";
    case "UPDATE_AVAILABLE":
      return "update";
    case "NO_KNOWN_VULNS":
      return "safe";
    case "NOT_TRACKED":
      return "unknown";
    case "PENDING":
      return "pending";
  }
}

/** A low-risk CVE uses the "update" color and says "Low". */
export function cveLevel(level: RiskLevel): { level: DisplayLevel; label: string } {
  if (level === "critical") return { level: "critical", label: "Critical" };
  if (level === "vulnerable") return { level: "vulnerable", label: "Vulnerable" };
  return { level: "update", label: "Low" };
}

export function isNeedsAttention(status: DeviceStatus): boolean {
  return status === "CRITICAL" || status === "VULNERABLE";
}
