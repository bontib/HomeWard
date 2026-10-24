import type { JobErrorCode } from "@/lib/contracts";

const TEXT: Record<JobErrorCode, string> = {
  NVD_UNAVAILABLE: "We couldn't reach the vulnerability list. Try again later.",
  TRIVY_FAILED: "We couldn't check this file. Try again.",
  TRIVY_DB_MISSING: "The scanner is still getting ready. Try again in a few minutes.",
  SBOM_INVALID: "We couldn't read this file. Export it again as CycloneDX or SPDX JSON.",
  KEV_UNAVAILABLE: "We couldn't load the list of problems attackers are using. Try again later.",
  TIMEOUT: "The check took too long. Try again.",
  WORKER_LOST: "Something went wrong. Try again.",
  BAD_PAYLOAD: "Something went wrong. Try again.",
  INTERNAL: "Something went wrong. Try again.",
};

export function jobErrorText(code: JobErrorCode | null): string {
  return code ? TEXT[code] : "Something went wrong. Try again.";
}
