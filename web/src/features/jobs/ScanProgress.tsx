import type { JobView } from "@/lib/contracts";
import { Spinner } from "@/components/ui/Spinner";
import { jobErrorText } from "./messages";

/** One line of status for a running or failed check. */
export function ScanProgress({
  job,
  label = "Checking for known vulnerabilities…",
}: {
  job: JobView | undefined;
  label?: string;
}) {
  if (job?.status === "FAILED") {
    return (
      <p role="alert" className="t-label text-critical">
        {jobErrorText(job.errorCode)}
      </p>
    );
  }
  const retrying = job?.status === "QUEUED" && job.attempts > 0;
  return (
    <div className="flex items-center gap-3">
      <Spinner label="Checking" />
      <p className="t-body">
        {retrying ? "We couldn't reach the vulnerability list. Trying again soon…" : label}
      </p>
    </div>
  );
}
