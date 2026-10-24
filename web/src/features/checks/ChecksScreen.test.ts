import { describe, expect, it } from "vitest";
import type { DataSourceId, SourceView } from "@/lib/contracts";
import { staleDataNotes } from "./ChecksScreen";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const fresh: SourceView = { lastSuccessAt: null, dataUpdatedAt: null, lastErrorCode: null };

function sources(overrides: Partial<Record<DataSourceId, SourceView>>) {
  return { NVD: fresh, TRIVY_DB: fresh, KEV: fresh, ...overrides };
}

describe("staleDataNotes", () => {
  it("says nothing when data is fresh", () => {
    const kev = { ...fresh, dataUpdatedAt: "2026-10-24T03:00:00Z" };
    expect(staleDataNotes(sources({ KEV: kev }), NOW)).toEqual([]);
  });

  it("shows the age of the known exploited list when the update failed", () => {
    const kev = {
      ...fresh,
      dataUpdatedAt: "2026-10-21T12:00:00Z",
      lastErrorCode: "KEV_UNAVAILABLE" as const,
    };
    expect(staleDataNotes(sources({ KEV: kev }), NOW)).toEqual([
      "Known exploited list is 3 days old.",
    ]);
  });

  it("shows the scanner data date when its update failed", () => {
    const trivy = {
      ...fresh,
      dataUpdatedAt: "2026-10-20T03:00:00Z",
      lastErrorCode: "TRIVY_FAILED" as const,
    };
    expect(staleDataNotes(sources({ TRIVY_DB: trivy }), NOW)).toEqual([
      "Scanner data is from 20 October 2026.",
    ]);
  });
});
