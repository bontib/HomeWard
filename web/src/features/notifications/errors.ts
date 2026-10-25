import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { ApiError, ApiErrorCode } from "@/lib/contracts";

function apiError(error: unknown): ApiError["error"] | null {
  const data = (error as FetchBaseQueryError | undefined)?.data;
  if (typeof data === "object" && data !== null && "error" in data) {
    return (data as ApiError).error;
  }
  return null;
}

export function errorCodeOf(error: unknown): ApiErrorCode | null {
  return apiError(error)?.code ?? null;
}

/** The server's own sentence when it sent one (the API texts are written for people), else ours. */
export function messageOr(error: unknown, fallback: string): string {
  const message = apiError(error)?.message;
  return message && errorCodeOf(error) !== "INTERNAL" ? message : fallback;
}
