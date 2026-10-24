import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError, notFound } from "./errors";
import { parseJsonBody, parseQuery, route } from "./http";

const ctx = { params: Promise.resolve({}) };

describe("route", () => {
  it("turns an AppError into the documented error body", async () => {
    const handler = route(async () => {
      throw notFound("That device");
    });
    const res = await handler(new Request("http://x"), ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "That device was not found." },
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("hides the details of an unexpected error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = route(async () => {
      throw new Error("SELECT * FROM secrets failed");
    });
    const res = await handler(new Request("http://x"), ctx);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toBe(
      '{"error":{"code":"INTERNAL","message":"Something went wrong. Try again."}}',
    );
  });

  it("keeps the status of each error code", async () => {
    const codes = [
      ["VALIDATION_FAILED", 400],
      ["UNAUTHORIZED", 401],
      ["PAYLOAD_TOO_LARGE", 413],
      ["UNSUPPORTED_FILE", 415],
      ["RATE_LIMITED", 429],
    ] as const;
    for (const [code, status] of codes) {
      const res = await route(async () => {
        throw new AppError(code, "x");
      })(new Request("http://x"), ctx);
      expect(res.status).toBe(status);
    }
  });
});

describe("parsing", () => {
  const schema = z.object({ name: z.string().min(1, "Give your device a name.") });

  it("maps Zod issues to field messages", async () => {
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ name: "" }) });
    await expect(parseJsonBody(req, schema)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: "Give your device a name.",
      fields: { name: "Give your device a name." },
    });
  });

  it("refuses a body that is not JSON", async () => {
    const req = new Request("http://x", { method: "POST", body: "nope" });
    await expect(parseJsonBody(req, schema)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("reads query strings", () => {
    const q = parseQuery(new Request("http://x/?name=abc"), schema);
    expect(q.name).toBe("abc");
  });
});
