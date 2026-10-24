import type { JobErrorCode } from "@/lib/contracts";

const TEXT: Record<JobErrorCode, string> = {
  NVD_UNAVAILABLE: "NVD is busy. We'll try again later.",
  TRIVY_FAILED: "We couldn't check this file. Try again.",
  TRIVY_DB_MISSING: "The scanner is still getting ready. Try again in a few minutes.",
  SBOM_INVALID: "We couldn't read this file. Export it again as CycloneDX or SPDX JSON.",
  KEV_UNAVAILABLE: "We couldn't load the list of problems attackers are using. Try again later.",
  TIMEOUT: "We couldn't check this device. Try again.",
  WORKER_LOST: "We couldn't check this device. Try again.",
  BAD_PAYLOAD: "We couldn't check this device. Try again.",
  INTERNAL: "We couldn't check this device. Try again.",
};

export function jobErrorText(code: JobErrorCode | null): string {
  return code ? TEXT[code] : "We couldn't check this device. Try again.";
}
