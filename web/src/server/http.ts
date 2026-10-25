// Small helpers for route handlers: session check, Zod parsing, JSON replies, error mapping.
// Handler shape: withSession -> parse with Zod -> one src/server function -> json().
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import type { ApiError } from "@/lib/contracts";
import { getSessionInfo, type SessionInfo } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { AppError } from "./errors";
import { readBodyCapped } from "./upload";

const NO_STORE = { "Cache-Control": "no-store" };

export function json<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function allowedOrigins(env: { BETTER_AUTH_URL: string; TRUSTED_ORIGINS: string[] }) {
  return [env.BETTER_AUTH_URL, ...env.TRUSTED_ORIGINS].map((o) => new URL(o).origin);
}

/**
 * Blocks state-changing requests that a browser sent from another site (CSRF). SameSite=Lax
 * already helps; this is the second layer. Requests with no Origin and no Sec-Fetch-Site
 * (curl, scripts) pass: they cannot carry a victim's cookie.
 */
export function assertSameSite(req: Request, allowed: string[]): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;
  const origin = req.headers.get("origin");
  if (origin !== null) {
    if (!allowed.includes(origin)) throw forbidden();
    return;
  }
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") throw forbidden();
}

const forbidden = () =>
  new AppError("FORBIDDEN", "This request came from another site. Open HomeGuard directly.");

/** For the token routes that have no session but still change state: same Origin rule, no cookie. */
export function withSameSite(req: Request): void {
  assertSameSite(req, allowedOrigins(getEnv()));
}

export async function withSession(req: Request): Promise<SessionInfo> {
  assertSameSite(req, allowedOrigins(getEnv()));
  const session = await getSessionInfo(req.headers);
  if (!session) throw new AppError("UNAUTHORIZED", "Sign in to continue.");
  return session;
}

function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

function validationError(error: ZodError): AppError {
  const fields = zodFields(error);
  const first = Object.values(fields)[0] ?? "Check the form and try again.";
  return new AppError("VALIDATION_FAILED", first, fields);
}

export function parseWith<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

const DEFAULT_JSON_BODY_BYTES = 8 * 1024;
const MAX_JSON_DEPTH = 8;

const notJson = () => new AppError("VALIDATION_FAILED", "The request body must be JSON.");

/** Nesting depth of a parsed JSON value, counted without recursion. Stops once past the limit. */
export function exceedsJsonDepth(value: unknown, maxDepth: number): boolean {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (typeof node !== "object" || node === null) continue;
    if (depth > maxDepth) return true;
    for (const child of Object.values(node)) stack.push({ node: child, depth: depth + 1 });
  }
  return false;
}

/**
 * Reads at most `maxBytes` of a JSON body (a few KB by default) and refuses deep nesting.
 * Token routes have no session, so they pass a smaller limit.
 */
export async function parseJsonBody<T>(
  req: Request,
  schema: ZodType<T>,
  options: { maxBytes?: number } = {},
): Promise<T> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json") || !req.body) throw notJson();
  const bytes = await readBodyCapped(
    req,
    options.maxBytes ?? DEFAULT_JSON_BODY_BYTES,
    () => new AppError("PAYLOAD_TOO_LARGE", "The request body is too large."),
  );
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw notJson();
  }
  if (exceedsJsonDepth(body, MAX_JSON_DEPTH)) throw notJson();
  return parseWith(schema, body);
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  return parseWith(schema, params);
}

function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    const body: ApiError = {
      error: { code: err.code, message: err.message, ...(err.fields && { fields: err.fields }) },
    };
    return NextResponse.json(body, { status: err.status, headers: NO_STORE });
  }
  // Details stay in the server log; the browser only gets a generic message.
  console.error("Unhandled error in route handler", err);
  const body: ApiError = {
    error: { code: "INTERNAL", message: "Something went wrong. Try again." },
  };
  return NextResponse.json(body, { status: 500, headers: NO_STORE });
}

type RouteContext<P> = { params: Promise<P> };

/** Wraps a handler so thrown AppErrors become the documented error body. */
export function route<P = Record<string, never>>(
  handler: (req: Request, ctx: RouteContext<P>) => Promise<NextResponse>,
) {
  return async (req: Request, ctx: RouteContext<P>): Promise<NextResponse> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
