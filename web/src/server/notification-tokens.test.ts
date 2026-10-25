import { describe, expect, it } from "vitest";
import { maskEmail, newNonce, signToken, verifyToken } from "./notification-tokens";

const SECRET = "test-secret-test-secret-test-secret-123";
const OTHER_SECRET = "another-secret-another-secret-12345678";
const NOW = new Date("2026-10-25T12:00:00Z");
const opts = { secret: SECRET, now: NOW };

describe("signToken and verifyToken", () => {
  it("gives back the user, nonce and expiry of a genuine token", () => {
    const expiresAt = new Date("2026-10-27T12:00:00Z");
    const token = signToken("confirm", "alice", { nonce: "n1", expiresAt, secret: SECRET });
    expect(verifyToken(token, "confirm", opts)).toEqual({
      userId: "alice",
      nonce: "n1",
      expiresAt,
    });
  });

  it("has no nonce and no expiry for an unsubscribe token", () => {
    const token = signToken("unsubscribe", "alice", { secret: SECRET });
    expect(verifyToken(token, "unsubscribe", opts)).toEqual({
      userId: "alice",
      nonce: null,
      expiresAt: null,
    });
  });

  it("makes the same unsubscribe token every time, so re-minting is harmless", () => {
    const a = signToken("unsubscribe", "alice", { secret: SECRET });
    const b = signToken("unsubscribe", "alice", { secret: SECRET });
    expect(a).toBe(b);
  });

  it("uses only characters the Zod token schema accepts", () => {
    const token = signToken("confirm", "alice", { nonce: newNonce(), secret: SECRET });
    expect(token).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(token.length).toBeLessThan(512);
  });

  it("refuses a token for another purpose, both ways", () => {
    const confirm = signToken("confirm", "alice", { nonce: "n", secret: SECRET });
    const unsubscribe = signToken("unsubscribe", "alice", { secret: SECRET });
    expect(verifyToken(confirm, "unsubscribe", opts)).toBeNull();
    expect(verifyToken(unsubscribe, "confirm", opts)).toBeNull();
  });

  it("refuses a token when any character of the signature changes", () => {
    const token = signToken("unsubscribe", "alice", { secret: SECRET });
    const last = token.at(-1) === "A" ? "B" : "A";
    expect(verifyToken(token.slice(0, -1) + last, "unsubscribe", opts)).toBeNull();
  });

  it("refuses a token whose payload was swapped for another user's", () => {
    const alice = signToken("unsubscribe", "alice", { secret: SECRET });
    const bob = signToken("unsubscribe", "bob", { secret: SECRET });
    const [version, , signature] = alice.split(".");
    const bobBody = bob.split(".")[1];
    expect(verifyToken(`${version}.${bobBody}.${signature}`, "unsubscribe", opts)).toBeNull();
  });

  it("refuses a token signed with another secret", () => {
    const token = signToken("unsubscribe", "alice", { secret: OTHER_SECRET });
    expect(verifyToken(token, "unsubscribe", opts)).toBeNull();
  });

  it("refuses an expired token, unless the caller allows it", () => {
    const expiresAt = new Date("2026-10-25T11:59:59Z");
    const token = signToken("confirm", "alice", { nonce: "n", expiresAt, secret: SECRET });
    expect(verifyToken(token, "confirm", opts)).toBeNull();
    expect(verifyToken(token, "confirm", { ...opts, allowExpired: true })?.userId).toBe("alice");
  });

  it.each(["", "garbage", "v1.a.b", "v1..", "v2.abc.def", "a.b.c.d", "v1.e30.e30"])(
    "refuses the malformed token %j",
    (token) => {
      expect(verifyToken(token, "confirm", opts)).toBeNull();
      expect(verifyToken(token, "unsubscribe", opts)).toBeNull();
    },
  );

  it("refuses a token that is too long without trying to read it", () => {
    expect(verifyToken("v1." + "a".repeat(600) + ".sig", "confirm", opts)).toBeNull();
  });
});

describe("newNonce", () => {
  it("is different every time and url safe", () => {
    const [a, b] = [newNonce(), newNonce()];
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("you@example.com")).toBe("y***@example.com");
  });

  it("hides everything when there is no usable address", () => {
    expect(maskEmail("nope")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
  });
});
