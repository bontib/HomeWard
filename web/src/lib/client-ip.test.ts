import { describe, expect, it } from "vitest";
import { forRateLimit } from "./client-ip";

const spoofed = () =>
  new Request("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8", "content-type": "text/plain" },
    body: "hello",
  });

describe("forRateLimit", () => {
  it("drops client-supplied forwarding headers by default", () => {
    const req = forRateLimit(spoofed(), false);
    expect(req.headers.get("x-forwarded-for")).toBeNull();
    expect(req.headers.get("x-real-ip")).toBeNull();
  });

  it("keeps other headers and the body", async () => {
    const req = forRateLimit(spoofed(), false);
    expect(req.headers.get("content-type")).toBe("text/plain");
    expect(await req.text()).toBe("hello");
  });

  it("keeps the headers when a trusted proxy is configured", () => {
    expect(forRateLimit(spoofed(), true).headers.get("x-forwarded-for")).toBe("1.2.3.4");
  });
});
