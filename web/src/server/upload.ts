// Reads an SBOM upload from a multipart request without ever holding more than the limit.
import { AppError } from "./errors";
import { MULTIPART_OVERHEAD_BYTES, tooLargeMessage } from "./sboms";

export type Upload = { fileName: string; bytes: Uint8Array<ArrayBuffer> };

function tooLarge(maxMb: number): AppError {
  return new AppError("PAYLOAD_TOO_LARGE", tooLargeMessage(maxMb));
}

/**
 * Reads the request body chunk by chunk and stops as soon as it is over the limit, so a
 * client that lies about (or leaves out) Content-Length cannot fill the memory.
 */
export async function readBodyCapped(
  req: Request,
  maxBytes: number,
  onTooLarge: () => AppError,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw onTooLarge();
  if (!req.body) throw new AppError("VALIDATION_FAILED", "Choose a file to upload.");

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw onTooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readSbomUpload(req: Request, maxMb: number): Promise<Upload> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    throw new AppError("VALIDATION_FAILED", "Choose a file to upload.");
  }
  const body = await readBodyCapped(req, maxMb * 1024 * 1024 + MULTIPART_OVERHEAD_BYTES, () =>
    tooLarge(maxMb),
  );
  let form: FormData;
  try {
    form = await new Request("http://upload.invalid/", {
      method: "POST",
      headers: { "content-type": type },
      body,
    }).formData();
  } catch {
    throw new AppError("VALIDATION_FAILED", "Choose a file to upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new AppError("VALIDATION_FAILED", "Choose a file to upload.");
  }
  if (file.size > maxMb * 1024 * 1024) throw tooLarge(maxMb);
  return { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}
