import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { forRateLimit } from "@/lib/client-ip";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// Built per request so importing this file at build time does not read the environment.
export function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(forRateLimit(request, getEnv().TRUSTED_PROXY));
}

export function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(forRateLimit(request, getEnv().TRUSTED_PROXY));
}
