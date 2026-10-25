import { createApi, fetchBaseQuery, type FetchBaseQueryError } from "@reduxjs/toolkit/query/react";
import type { ApiError } from "@/lib/contracts";

/** One API slice for the whole app. Features add endpoints with `api.injectEndpoints`. */
export const api = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({ baseUrl: "/api" }),
  tagTypes: [
    "Device",
    "DeviceList",
    "Components",
    "Findings",
    "Vulnerability",
    "Checks",
    "Notifications",
  ],
  endpoints: () => ({}),
});

const FALLBACK = "Something went wrong. Try again.";

function isApiError(data: unknown): data is ApiError {
  return typeof data === "object" && data !== null && "error" in data;
}

/** Turns any RTK Query error into text that is safe to show. */
export function errorMessage(error: unknown): string {
  const data = (error as FetchBaseQueryError | undefined)?.data;
  if (isApiError(data)) return data.error.message;
  return FALLBACK;
}

/** Field messages from a 400 response, keyed by field path. */
export function fieldErrors(error: unknown): Record<string, string> {
  const data = (error as FetchBaseQueryError | undefined)?.data;
  return (isApiError(data) && data.error.fields) || {};
}

export function isNotFound(error: unknown): boolean {
  return (error as FetchBaseQueryError | undefined)?.status === 404;
}
