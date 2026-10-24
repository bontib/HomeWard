// Device data access and rules. Every query filters by userId, also through relations.
// Status and counts are written by the worker only (ADR 0004); this file queues checks.
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { enqueueCheck } from "@/lib/jobs";
import {
  compareFindingsWorstFirst,
  type DeviceDetail,
  type DeviceStatus,
  type DeviceSummary,
  type CreateDeviceSchema,
  type UpdateDeviceSchema,
} from "@/lib/contracts";
import type { z } from "zod";
import { AppError, notFound } from "./errors";
import {
  DEVICE_SUMMARY_INCLUDE,
  FINDING_SELECT,
  SBOM_VIEW_SELECT,
  toDeviceFinding,
  toDeviceSummary,
  toSbomView,
} from "./views";

type CreateInput = z.output<typeof CreateDeviceSchema>;
type UpdateInput = z.output<typeof UpdateDeviceSchema>;
type ProductInput = CreateInput["product"];
type Tx = Prisma.TransactionClient;

const STATUS_RANK: Record<DeviceStatus, number> = {
  CRITICAL: 0,
  VULNERABLE: 1,
  UPDATE_AVAILABLE: 2,
  PENDING: 3,
  NOT_TRACKED: 4,
  NO_KNOWN_VULNS: 5,
};

export async function listDevices(userId: string): Promise<DeviceSummary[]> {
  const rows = await getDb().device.findMany({
    where: { userId },
    include: DEVICE_SUMMARY_INCLUDE,
  });
  return rows
    .map(toDeviceSummary)
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name));
}

export async function getDeviceDetail(userId: string, deviceId: string): Promise<DeviceDetail> {
  return readDeviceDetail(getDb(), userId, deviceId);
}

async function readDeviceDetail(
  db: Pick<Tx, "device" | "versionChange">,
  userId: string,
  deviceId: string,
): Promise<DeviceDetail> {
  const device = await db.device.findFirst({
    where: { id: deviceId, userId },
    include: {
      ...DEVICE_SUMMARY_INCLUDE,
      sbom: { select: SBOM_VIEW_SELECT },
      findings: { select: FINDING_SELECT },
    },
  });
  if (!device) throw notFound("That device");

  const manual = device.components[0];
  const history = manual ? await getHistory(db, manual.id) : [];
  const findings = device.findings.map(toDeviceFinding).sort(compareOpenFirst);

  return {
    ...toDeviceSummary(device),
    notes: device.notes,
    createdAt: device.createdAt.toISOString(),
    findings,
    versionHistory: history,
    sbom: device.sbom ? toSbomView(device.sbom) : null,
  };
}

async function getHistory(db: Pick<Tx, "versionChange">, componentId: string) {
  const rows = await db.versionChange.findMany({
    where: { componentId },
    orderBy: { changedAt: "desc" },
    take: 20,
  });
  return rows.map((r) => ({
    id: r.id,
    fromVersion: r.fromVersion,
    toVersion: r.toVersion,
    changedAt: r.changedAt.toISOString(),
  }));
}

function compareOpenFirst(
  a: ReturnType<typeof toDeviceFinding>,
  b: ReturnType<typeof toDeviceFinding>,
): number {
  if (a.state !== b.state) return a.state === "OPEN" ? -1 : 1;
  return compareFindingsWorstFirst(a, b);
}

type ManualFields = { name: string; vendor: string | null; cpe: string | null };

/** Catalog products must come from the search cache, so names and CPEs are never invented. */
async function resolveProduct(
  tx: Tx,
  product: ProductInput,
  deviceName: string,
): Promise<ManualFields> {
  if (product.kind === "other") {
    return { name: product.name || deviceName, vendor: null, cpe: null };
  }
  const known = await tx.cpeProduct.findUnique({ where: { cpe: product.cpe } });
  if (!known) {
    throw new AppError("VALIDATION_FAILED", "Pick a product from the search results.", {
      product: "Pick a product from the search results.",
    });
  }
  return { name: known.title, vendor: known.vendor, cpe: known.cpe };
}

export async function createDevice(
  userId: string,
  input: CreateInput,
): Promise<{ device: DeviceDetail; jobId: string | null }> {
  return getDb().$transaction(async (tx) => {
    const manual = await resolveProduct(tx, input.product, input.name);
    const created = await tx.device.create({
      data: {
        userId,
        name: input.name,
        type: input.type,
        room: input.room ?? null,
        notes: input.notes ?? null,
        components: { create: { source: "MANUAL", version: input.version, ...manual } },
      },
      select: { id: true },
    });
    const jobId = await enqueueCheck(tx, userId, created.id);
    return { device: await readDeviceDetail(tx, userId, created.id), jobId };
  });
}

export async function deleteDevice(userId: string, deviceId: string): Promise<void> {
  const { count } = await getDb().device.deleteMany({ where: { id: deviceId, userId } });
  if (count === 0) throw notFound("That device");
}

type ManualComponent = { id: string; name: string; cpe: string | null; version: string | null };

function sameProduct(current: ManualComponent, next: ManualFields): boolean {
  return current.cpe === next.cpe && (next.cpe !== null || current.name === next.name);
}

/** Edits a device. A changed product or version queues a new check. */
export async function updateDevice(
  userId: string,
  deviceId: string,
  input: UpdateInput,
): Promise<{ device: DeviceDetail; jobId: string | null }> {
  return getDb().$transaction(async (tx) => {
    const device = await tx.device.findFirst({
      where: { id: deviceId, userId },
      include: { components: { where: { source: "MANUAL" }, take: 1 } },
    });
    if (!device) throw notFound("That device");

    const name = input.name ?? device.name;
    await tx.device.update({
      where: { id: device.id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.room !== undefined && { room: input.room }),
        ...(input.notes !== undefined && { notes: input.notes }),
      },
    });

    const checkNeeded = await applyProductChange(tx, device, device.components[0], input, name);
    const jobId = checkNeeded ? await enqueueCheck(tx, userId, device.id) : null;
    return { device: await readDeviceDetail(tx, userId, device.id), jobId };
  });
}

/** Returns true when the product or version really changed. */
async function applyProductChange(
  tx: Tx,
  device: { id: string },
  current: ManualComponent | undefined,
  input: UpdateInput,
  deviceName: string,
): Promise<boolean> {
  if (input.product === undefined && input.version === undefined) return false;

  const next = input.product
    ? await resolveProduct(tx, input.product, deviceName)
    : current
      ? { name: current.name, vendor: null, cpe: current.cpe }
      : { name: deviceName, vendor: null, cpe: null };
  const nextVersion = input.version !== undefined ? input.version : (current?.version ?? null);

  if (!current) {
    await tx.component.create({
      data: { deviceId: device.id, source: "MANUAL", version: nextVersion, ...next },
    });
    return true;
  }
  if (!sameProduct(current, next)) {
    return replaceProduct(tx, device.id, current, next, nextVersion);
  }
  if (nextVersion === current.version) return false;
  await recordVersionChange(tx, current, nextVersion);
  return true;
}

async function recordVersionChange(
  tx: Tx,
  current: ManualComponent,
  nextVersion: string | null,
): Promise<void> {
  await tx.component.update({
    where: { id: current.id },
    data: { version: nextVersion, check: "PENDING" },
  });
  await tx.versionChange.create({
    data: { componentId: current.id, fromVersion: current.version, toVersion: nextVersion },
  });
}

/** A different product has different CVEs, so the old component and its findings go. */
async function replaceProduct(
  tx: Tx,
  deviceId: string,
  current: ManualComponent,
  next: ManualFields,
  version: string | null,
): Promise<boolean> {
  await tx.component.delete({ where: { id: current.id } });
  await tx.component.create({ data: { deviceId, source: "MANUAL", version, ...next } });
  // Raw so Prisma does not mark this as a user edit; the old findings are gone with the component.
  await tx.$executeRaw`
    UPDATE device SET status = 'PENDING', open_finding_count = 0, target_version = NULL
    WHERE id = ${deviceId}`;
  return true;
}
