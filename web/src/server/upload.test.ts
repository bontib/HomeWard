import { describe, expect, it } from "vitest";
import { readBodyCapped, readSbomUpload } from "./upload";

const tooLarge = () => new Error("too large") as never;

function multipart(content: BlobPart, name = "sbom.json", field = "file"): Request {
  const form = new FormData();
  form.set(field, new File([content], name, { type: "application/json" }));
  return new Request("http://localhost/api/devices/1/sbom", { method: "POST", body: form });
}

describe("readBodyCapped", () => {
  it("returns the body when it fits", async () => {
    const req = new Request("http://x", { method: "POST", body: "hello" });
    expect(new TextDecoder().decode(await readBodyCapped(req, 100, tooLarge))).toBe("hello");
  });

  it("stops at the limit even when Content-Length is missing", async () => {
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const req = new Request("http://x", { method: "POST", body: stream, duplex: "half" } as never);
    await expect(readBodyCapped(req, 10 * 1024, tooLarge)).rejects.toThrow("too large");
  });

  it("refuses at once when Content-Length is over the limit", async () => {
    const req = new Request("http://x", {
      method: "POST",
      body: "x",
      headers: { "content-length": "999999" },
    });
    await expect(readBodyCapped(req, 100, tooLarge)).rejects.toThrow("too large");
  });
});

describe("readSbomUpload", () => {
  it("reads the file field", async () => {
    const upload = await readSbomUpload(multipart('{"a":1}', "my.json"), 1);
    expect(upload.fileName).toBe("my.json");
    expect(new TextDecoder().decode(upload.bytes)).toBe('{"a":1}');
  });

  it("asks for a file when the field is missing or empty", async () => {
    await expect(readSbomUpload(multipart("x", "a.json", "other"), 1)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(readSbomUpload(multipart(""), 1)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("refuses a body that is not multipart", async () => {
    const req = new Request("http://x", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    await expect(readSbomUpload(req, 1)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("refuses a file over the limit with the 413 text", async () => {
    const big = new Uint8Array(1024 * 1024 + 10);
    await expect(readSbomUpload(multipart(big), 1)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: "This file is larger than 1 MB.",
    });
  });
});
