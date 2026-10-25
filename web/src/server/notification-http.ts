// Request parsing for the token routes. A bad token is always the same answer (INVALID_LINK),
// so nothing tells a forged token from an expired one.
import { NextResponse } from "next/server";
import { z } from "zod";
import { NotificationTokenSchema } from "@/lib/contracts";
import { AppError } from "./errors";
import { parseJsonBody } from "./http";
import { invalidLink } from "./notifications";
import type { TokenPurpose } from "./notification-tokens";
import { readBodyCapped } from "./upload";

const ONE_CLICK_BODY_LIMIT_BYTES = 1024;
const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";

export function parseToken(value: unknown, purpose: TokenPurpose): string {
  const parsed = NotificationTokenSchema.safeParse(value);
  if (!parsed.success) throw invalidLink(purpose);
  return parsed.data.token;
}

export async function parseTokenBody(req: Request, purpose: TokenPurpose): Promise<string> {
  const body = await parseJsonBody(req, z.record(z.string(), z.unknown()));
  return parseToken(body, purpose);
}

/** RFC 8058: the mail provider posts a small form from its own servers. */
export async function readOneClickRequest(req: Request): Promise<string> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/x-www-form-urlencoded")) {
    throw new AppError("UNSUPPORTED_FILE", "The request body must be a form.");
  }
  if (!req.body)
    throw new AppError("VALIDATION_FAILED", `The request body must be ${ONE_CLICK_BODY}.`);
  const bytes = await readBodyCapped(
    req,
    ONE_CLICK_BODY_LIMIT_BYTES,
    () => new AppError("PAYLOAD_TOO_LARGE", "The request body is too large."),
  );
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  if (form.get("List-Unsubscribe") !== "One-Click") {
    throw new AppError("VALIDATION_FAILED", `The request body must be ${ONE_CLICK_BODY}.`);
  }
  return parseToken({ token: new URL(req.url).searchParams.get("token") }, "unsubscribe");
}

export const emptyOk = () =>
  new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
