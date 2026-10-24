import { ErrorText } from "@/components/ui/ErrorText";
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
    return <ErrorText>{jobErrorText(job.errorCode)}</ErrorText>;
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
