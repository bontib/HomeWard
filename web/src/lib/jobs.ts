// Enqueue helpers (architecture section 4.2). Always call inside the transaction that
// writes the data the job belongs to: pg_notify inside a transaction is sent on commit,
// so the worker never wakes up before the job row is visible.
import type { Prisma } from "@/generated/prisma/client";
import { JobPayloadSchemas, type JobPayload, type JobType } from "@/lib/contracts";

type Tx = Prisma.TransactionClient;

const DEFAULTS: Record<JobType, { priority: number; maxAttempts: number }> = {
  CHECK_DEVICE: { priority: 10, maxAttempts: 3 },
  RECOMPUTE_STATUS: { priority: 20, maxAttempts: 3 },
  SEARCH_PRODUCTS: { priority: 20, maxAttempts: 1 },
  RESCAN_ALL: { priority: 5, maxAttempts: 3 },
  UPDATE_TRIVY_DB: { priority: 5, maxAttempts: 3 },
  IMPORT_KEV: { priority: 5, maxAttempts: 3 },
  DEV_NOOP: { priority: 20, maxAttempts: 1 },
  SEND_EMAIL: { priority: 20, maxAttempts: 3 },
  SEND_DIGEST: { priority: 0, maxAttempts: 3 },
};

type NewJob<T extends JobType> = {
  type: T;
  payload: JobPayload<T>;
  userId?: string;
  deviceId?: string;
  priority?: number;
  maxAttempts?: number;
};

export async function enqueueJob<T extends JobType>(tx: Tx, job: NewJob<T>): Promise<string> {
  const payload = JobPayloadSchemas[job.type].parse(job.payload);
  const defaults = DEFAULTS[job.type];
  const row = await tx.job.create({
    data: {
      type: job.type,
      payload,
      userId: job.userId ?? null,
      deviceId: job.deviceId ?? null,
      priority: job.priority ?? defaults.priority,
      maxAttempts: job.maxAttempts ?? defaults.maxAttempts,
    },
    select: { id: true },
  });
  await tx.$executeRaw`SELECT pg_notify('jobs', ${row.id})`;
  return row.id;
}

/**
 * Queues CHECK_DEVICE for a device of this user and marks the device CHECKING.
 * If a check is already waiting in the queue, that job is reused, so button spam
 * and "edit, then upload" end up as one job.
 */
export async function enqueueCheck(tx: Tx, userId: string, deviceId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ check_job_id: string | null }[]>`
    SELECT check_job_id FROM device WHERE id = ${deviceId} AND user_id = ${userId} FOR UPDATE`;
  const device = rows[0];
  if (!device) throw new Error("enqueueCheck: device not found for this user");

  if (device.check_job_id) {
    const waiting = await tx.job.findFirst({
      where: { id: device.check_job_id, status: "QUEUED" },
      select: { id: true },
    });
    if (waiting) return waiting.id;
  }

  const jobId = await enqueueJob(tx, {
    type: "CHECK_DEVICE",
    payload: { deviceId },
    userId,
    deviceId,
  });
  // Raw on purpose: Prisma's @updatedAt would mark the device as "edited by the user".
  await tx.$executeRaw`
    UPDATE device SET check_state = 'CHECKING', check_job_id = ${jobId}, check_error_code = NULL
    WHERE id = ${deviceId}`;
  return jobId;
}

/** Queues RECOMPUTE_STATUS for one device, reusing a queued one. */
export async function enqueueRecompute(tx: Tx, userId: string, deviceId: string): Promise<string> {
  const waiting = await tx.job.findFirst({
    where: { type: "RECOMPUTE_STATUS", status: "QUEUED", deviceId },
    select: { id: true },
  });
  if (waiting) return waiting.id;
  return enqueueJob(tx, { type: "RECOMPUTE_STATUS", payload: { deviceId }, userId, deviceId });
}

/** Queues RESCAN_ALL for one user (or everyone when userId is null), reusing an active one. */
export async function enqueueRescan(tx: Tx, userId: string | null): Promise<string> {
  const active = await tx.job.findFirst({
    where: { type: "RESCAN_ALL", status: { in: ["QUEUED", "RUNNING"] }, userId },
    select: { id: true },
  });
  if (active) return active.id;
  return enqueueJob(tx, {
    type: "RESCAN_ALL",
    payload: { userId },
    ...(userId && { userId }),
  });
}
