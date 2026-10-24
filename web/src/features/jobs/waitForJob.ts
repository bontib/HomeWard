import type { JobView } from "@/lib/contracts";
import type { AppDispatch } from "@/store";
import { jobsApi } from "./jobsApi";
import { isSettled } from "./useJobWatcher";

const POLL_MS = 2000;
const GIVE_UP_MS = 60_000;

/**
 * Polls a job until it ends, without needing a mounted component. Used by mutations
 * (ignore, reopen) whose row may leave the screen before the job is done.
 * Returns null when the job could not be read or took too long.
 */
export async function waitForJob(dispatch: AppDispatch, jobId: string): Promise<JobView | null> {
  const deadline = Date.now() + GIVE_UP_MS;
  while (Date.now() < deadline) {
    const result = await dispatch(
      jobsApi.endpoints.getJob.initiate(jobId, { forceRefetch: true, subscribe: false }),
    );
    if (result.error || !result.data) return null;
    if (isSettled(result.data.job)) return result.data.job;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return null;
}
