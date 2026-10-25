// Signed tokens for the links in notification mails (docs/architecture-notifications.md section 6).
// token   = "v1." + b64url(payload JSON) + "." + b64url(HMAC-SHA256(key, "v1." + b64url(payload)))
// payload = { p: purpose, u: userId, n: nonce | null, e: expiry in unix seconds | null }
// The purpose is part of the signed data, so a confirm token never works as an unsubscribe token.
// Only the web app has the secret. The worker copies finished tokens into mails and never checks one.
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getEnv } from "@/lib/env";

export type TokenPurpose = "confirm" | "unsubscribe";

export type VerifiedToken = {
  userId: string;
  nonce: string | null;
  expiresAt: Date | null;
};

const VERSION = "v1";
const KEY_INFO = "homeguard notification token v1";
const MAX_TOKEN_LENGTH = 512;

const PayloadSchema = z.object({
  p: z.enum(["confirm", "unsubscribe"]),
  u: z.string().min(1),
  n: z.string().nullable(),
  e: z.number().int().nullable(),
});

function signingKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", KEY_INFO, 32));
}

function sign(signedPart: string, secret: string): string {
  return createHmac("sha256", signingKey(secret)).update(signedPart).digest("base64url");
}

/** 16 random bytes; stored on the pref row so only the newest confirm link works. */
export function newNonce(): string {
  return randomBytes(16).toString("base64url");
}

export function signToken(
  purpose: TokenPurpose,
  userId: string,
  options: { nonce?: string; expiresAt?: Date; secret?: string } = {},
): string {
  const payload = {
    p: purpose,
    u: userId,
    n: options.nonce ?? null,
    e: options.expiresAt ? Math.floor(options.expiresAt.getTime() / 1000) : null,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signedPart = `${VERSION}.${body}`;
  return `${signedPart}.${sign(signedPart, options.secret ?? getEnv().BETTER_AUTH_SECRET)}`;
}

function signatureMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Returns the content of a token that is genuine, made for this purpose and not expired.
 * Every failure is `null`: callers must not tell a forged token from an expired one.
 * `allowExpired` is for the one place where an old, genuine confirm link is harmless.
 */
export function verifyToken(
  token: string,
  purpose: TokenPurpose,
  options: { now?: Date; secret?: string; allowExpired?: boolean } = {},
): VerifiedToken | null {
  if (token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [version, body, signature] = parts as [string, string, string];

  const secret = options.secret ?? getEnv().BETTER_AUTH_SECRET;
  if (!signatureMatches(sign(`${version}.${body}`, secret), signature)) return null;

  const payload = parsePayload(body);
  if (!payload || payload.p !== purpose) return null;

  const expiresAt = payload.e === null ? null : new Date(payload.e * 1000);
  const now = options.now ?? new Date();
  if (expiresAt && expiresAt <= now && !options.allowExpired) return null;
  return { userId: payload.u, nonce: payload.n, expiresAt };
}

function parsePayload(body: string): z.infer<typeof PayloadSchema> | null {
  try {
    const parsed = PayloadSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** "you@example.com" becomes "y***@example.com". The link can be forwarded, so the page shows less. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
