"use client";
import { useEffect, useRef } from "react";
import type { JobView } from "@/lib/contracts";
import { useGetJobQuery } from "./jobsApi";

const POLL_MS = 2000;

export function isSettled(job: JobView | undefined): boolean {
  return job?.status === "DONE" || job?.status === "FAILED";
}

/**
 * Polls GET /api/jobs/:id every 2 s while the job is QUEUED or RUNNING, and calls
 * `onSettled` once when it ends. Pass `null` to watch nothing.
 */
export function useJobWatcher(jobId: string | null, onSettled?: (job: JobView) => void) {
  const { data, error, refetch, fulfilledTimeStamp } = useGetJobQuery(jobId ?? "", {
    skip: !jobId,
  });
  const job = data?.job;
  const running = Boolean(jobId) && !error && !isSettled(job);

  // Keep the newest callback without re-running the effects below.
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  });

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => void refetch(), POLL_MS);
    return () => clearTimeout(timer);
  }, [running, refetch, fulfilledTimeStamp]);

  const notifiedFor = useRef<string | null>(null);
  useEffect(() => {
    if (job && isSettled(job) && notifiedFor.current !== job.id) {
      notifiedFor.current = job.id;
      onSettledRef.current?.(job);
    }
  }, [job]);

  return { job, running, failed: job?.status === "FAILED" };
}
