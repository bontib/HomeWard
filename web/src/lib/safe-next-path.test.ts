import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/features/auth/schemas";

describe("safeNextPath", () => {
  it("keeps a normal path with its query", () => {
    expect(safeNextPath("/devices/abc?tab=software")).toBe("/devices/abc?tab=software");
  });

  it.each([
    ["a missing value", undefined],
    ["another site", "https://evil.example"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash", "/\\evil.example"],
    ["a tab after the slash", "/\t/evil.example"],
    ["a newline after the slash", "/\n/evil.example"],
    ["a path without a leading slash", "evil.example"],
  ])("falls back to / for %s", (_label, input) => {
    expect(safeNextPath(input)).toBe("/");
  });
});
