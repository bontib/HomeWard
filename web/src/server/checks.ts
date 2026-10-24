import type { ChecksStatus, DataSourceId, RecentCheck, SourceView } from "@/lib/contracts";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { enqueueRescan } from "@/lib/jobs";

const WORKER_ALIVE_MS = 2 * 60 * 1000;
const RECENT_LIMIT = 10;
const DATA_SOURCES: DataSourceId[] = ["NVD", "TRIVY_DB", "KEV"];

/** A rescan of my devices, or the scheduled one that covers everybody. */
const activeRescanWhere = (userId: string): Prisma.JobWhereInput => ({
  type: "RESCAN_ALL",
  status: { in: ["QUEUED", "RUNNING"] },
  OR: [{ userId }, { userId: null }],
});

export async function getChecksStatus(userId: string): Promise<ChecksStatus> {
  const db = getDb();
  const [worker, sources, lastCheck, checking, activeRescan, recent] = await Promise.all([
    db.workerStatus.findUnique({ where: { id: 1 } }),
    db.dataSource.findMany(),
    db.job.findFirst({
      where: { userId, type: "CHECK_DEVICE", status: "DONE" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    db.device.count({ where: { userId, checkState: "CHECKING" } }),
    db.job.findFirst({ where: activeRescanWhere(userId), select: { id: true } }),
    db.job.findMany({
      where: {
        type: { in: ["CHECK_DEVICE", "RESCAN_ALL"] },
        OR: [{ userId }, { userId: null, type: "RESCAN_ALL" }],
      },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
      include: { device: { select: { id: true, name: true } } },
    }),
  ]);

  const sourceViews = Object.fromEntries(
    DATA_SOURCES.map((id): [DataSourceId, SourceView] => {
      const row = sources.find((s) => s.id === id);
      return [
        id,
        {
          lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
          dataUpdatedAt: row?.dataUpdatedAt?.toISOString() ?? null,
          lastErrorCode: row?.lastErrorCode ?? null,
        },
      ];
    }),
  ) as Record<DataSourceId, SourceView>;

  return {
    scanner: {
      on: worker !== null && Date.now() - worker.heartbeatAt.getTime() < WORKER_ALIVE_MS,
      lastCheckAt: lastCheck?.finishedAt?.toISOString() ?? null,
      nextCheckAt: worker?.nextRescanAt?.toISOString() ?? null,
      rescanCron: worker?.rescanCron ?? null,
      nvdApiKeySet: worker?.nvdApiKeySet ?? false,
    },
    sources: sourceViews,
    checkingDeviceCount: checking,
    activeRescanJobId: activeRescan?.id ?? null,
    recent: recent.map((j): RecentCheck => ({
      jobId: j.id,
      type: j.type === "RESCAN_ALL" ? "RESCAN_ALL" : "CHECK_DEVICE",
      status: j.status,
      errorCode: j.errorCode,
      createdAt: j.createdAt.toISOString(),
      finishedAt: j.finishedAt?.toISOString() ?? null,
      device: j.device,
    })),
  };
}

/** "Check all now": queues one rescan of my devices, or returns the one already active. */
export async function runChecks(userId: string): Promise<string> {
  return getDb().$transaction(async (tx) => {
    const active = await tx.job.findFirst({
      where: activeRescanWhere(userId),
      select: { id: true },
    });
    return active?.id ?? enqueueRescan(tx, userId);
  });
}
