// SBOM upload rules. Next.js never parses the SBOM: it checks size, sniffs the format from
// the first 64 KB, and stores the bytes. The worker parses them (ADR 0001, section 3.3).
import { createHash } from "node:crypto";
import type { SbomFormat } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { enqueueCheck } from "@/lib/jobs";
import { AppError, notFound } from "./errors";
import { getDeviceDetail } from "./devices";

const SNIFF_BYTES = 64 * 1024;
// serde_json in the worker refuses nesting deeper than 128; refuse here too, with a clear message.
export const MAX_JSON_DEPTH = 128;
const MAX_FILE_NAME = 255;
// The upload is a multipart body: a little room on top of the file for boundaries and field names.
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export const UNSUPPORTED_MESSAGE =
  "This isn't a CycloneDX or SPDX file. Export it as JSON and try again.";

export function tooLargeMessage(maxMb: number): string {
  return `This file is larger than ${maxMb} MB.`;
}

export function detectSbomFormat(bytes: Uint8Array): SbomFormat | null {
  const head = Buffer.from(bytes.subarray(0, SNIFF_BYTES)).toString("utf8").replace(/^﻿/, "");
  if (!head.trimStart().startsWith("{")) return null;
  if (/"bomFormat"\s*:\s*"CycloneDX"/.test(head)) return "CYCLONEDX";
  if (/"spdxVersion"\s*:\s*"SPDX-/.test(head)) return "SPDX";
  return null;
}

/** Deepest nesting of `{` and `[` in a JSON text, ignoring brackets inside strings. */
export function jsonDepth(bytes: Uint8Array): number {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  let escaped = false;
  for (const byte of bytes) {
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5c) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) inString = true;
    else if (byte === 0x7b || byte === 0x5b) {
      depth += 1;
      if (depth > deepest) deepest = depth;
    } else if (byte === 0x7d || byte === 0x5d) depth -= 1;
  }
  return deepest;
}

/** Keeps only the last path part, drops control characters, caps the length. Stored for display only. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || "sbom.json").slice(0, MAX_FILE_NAME);
}

export function checkUpload(bytes: Uint8Array, maxMb: number): SbomFormat {
  if (bytes.byteLength > maxMb * 1024 * 1024) {
    throw new AppError("PAYLOAD_TOO_LARGE", tooLargeMessage(maxMb));
  }
  const format = detectSbomFormat(bytes);
  if (!format) throw new AppError("UNSUPPORTED_FILE", UNSUPPORTED_MESSAGE);
  if (jsonDepth(bytes) > MAX_JSON_DEPTH) {
    throw new AppError("UNSUPPORTED_FILE", "This file is nested too deeply to read.");
  }
  return format;
}

export async function assertDeviceOwned(userId: string, deviceId: string): Promise<void> {
  const found = await getDb().device.findFirst({
    where: { id: deviceId, userId },
    select: { id: true },
  });
  if (!found) throw notFound("That device");
}

/** Replaces the device's SBOM and queues a check, in one transaction. */
export async function saveSbom(
  userId: string,
  deviceId: string,
  upload: { fileName: string; bytes: Uint8Array<ArrayBuffer>; maxMb: number },
) {
  const format = checkUpload(upload.bytes, upload.maxMb);
  const row = {
    format,
    fileName: cleanFileName(upload.fileName),
    sizeBytes: upload.bytes.byteLength,
    sha256: createHash("sha256").update(upload.bytes).digest("hex"),
    content: upload.bytes,
  };
  const jobId = await getDb().$transaction(
    async (tx) => {
      const device = await tx.device.findFirst({
        where: { id: deviceId, userId },
        select: { id: true },
      });
      if (!device) throw notFound("That device");
      // parsedAt = null tells the worker to parse the new file.
      await tx.sbom.upsert({
        where: { deviceId },
        create: { deviceId, ...row },
        update: { ...row, parsedAt: null, uploadedAt: new Date() },
        select: { id: true },
      });
      return enqueueCheck(tx, userId, deviceId);
    },
    // A 20 MB insert can take longer than Prisma's 5 s default on a NAS.
    { timeout: 60_000 },
  );
  return { device: await getDeviceDetail(userId, deviceId), jobId };
}
