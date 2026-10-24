// Job lookups and the small "queue a job for me" actions behind /api/jobs and /api/devices/:id/scan.
import type { Job } from "@/generated/prisma/client";
import type { JobView } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { enqueueCheck, enqueueJob } from "@/lib/jobs";
import { notFound } from "./errors";

export function toJobView(job: Job): JobView {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    errorCode: job.errorCode,
    nextAttemptAt: job.status === "QUEUED" && job.attempts > 0 ? job.runAfter.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

/** Own jobs, plus the scheduled RESCAN_ALL that covers every user. Other system jobs are hidden. */
export async function getJob(userId: string, jobId: string): Promise<JobView> {
  const job = await getDb().job.findFirst({
    where: {
      id: jobId,
      OR: [{ userId }, { userId: null, type: "RESCAN_ALL" }],
    },
  });
  if (!job) throw notFound("That job");
  return toJobView(job);
}

export async function scanDevice(userId: string, deviceId: string): Promise<string> {
  return getDb().$transaction(async (tx) => {
    const device = await tx.device.findFirst({
      where: { id: deviceId, userId },
      select: { id: true },
    });
    if (!device) throw notFound("That device");
    return enqueueCheck(tx, userId, deviceId);
  });
}

/** Dev-only: lets the UI and e2e tests watch a job go through the worker. */
export async function enqueueDevNoop(userId: string, sleepMs: number): Promise<string> {
  return getDb().$transaction((tx) =>
    enqueueJob(tx, { type: "DEV_NOOP", payload: { sleepMs }, userId }),
  );
}
