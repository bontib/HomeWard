import type { z } from "zod";
import { getDb } from "@/lib/db";
import { enqueueRecompute } from "@/lib/jobs";
import type { DeviceFinding, UpdateFindingSchema } from "@/lib/contracts";
import { notFound } from "./errors";
import { FINDING_SELECT, toDeviceFinding } from "./views";

type UpdateInput = z.output<typeof UpdateFindingSchema>;

/** Ignore or reopen a finding of one of my devices. The worker then recomputes the device status. */
export async function updateFinding(
  userId: string,
  findingId: string,
  input: UpdateInput,
): Promise<{ finding: DeviceFinding; jobId: string }> {
  return getDb().$transaction(async (tx) => {
    const owned = await tx.finding.findFirst({
      where: { id: findingId, device: { userId } },
      select: { id: true, deviceId: true },
    });
    if (!owned) throw notFound("That finding");

    // A finding the person has seen and ignored is never mailed, not even after a reopen (N-D11).
    if (input.state === "IGNORED") {
      await tx.finding.updateMany({
        where: { id: owned.id, notifiedAt: null },
        data: { notifiedAt: new Date() },
      });
    }
    const data =
      input.state === "IGNORED"
        ? { state: "IGNORED" as const, ignoredReason: input.reason, ignoredAt: new Date() }
        : { state: "OPEN" as const, ignoredReason: null, ignoredAt: null };
    const finding = await tx.finding.update({
      where: { id: owned.id },
      data,
      select: FINDING_SELECT,
    });
    const jobId = await enqueueRecompute(tx, userId, owned.deviceId);
    return { finding: toDeviceFinding(finding), jobId };
  });
}
