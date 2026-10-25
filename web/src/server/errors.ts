// Errors that business logic throws and route handlers turn into the error body of
// docs/architecture-v1.md section 3.1. Messages are plain text that is safe to show.
import type { ApiErrorCode } from "@/lib/contracts";

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_FILE: 415,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  INVALID_LINK: 400,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

/** Used for "not found" and "not yours" alike, so ids of other users never leak. */
export const notFound = (what = "That") => new AppError("NOT_FOUND", `${what} was not found.`);
