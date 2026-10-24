import { describe, expect, it } from "vitest";
import { allStatusDevices } from "./fixtures";
import { countInGroup, filterDevices } from "./filterDevices";

describe("filterDevices", () => {
  it("matches name or room, ignoring case", () => {
    expect(filterDevices(allStatusDevices, "STUDY", "all").map((d) => d.name)).toEqual([
      "Bon's laptop",
      "Study printer",
    ]);
    expect(filterDevices(allStatusDevices, "camera", "all")).toHaveLength(1);
  });

  it("needs attention means critical and vulnerable only", () => {
    expect(filterDevices(allStatusDevices, "", "attention").map((d) => d.status)).toEqual([
      "CRITICAL",
      "VULNERABLE",
    ]);
    expect(countInGroup(allStatusDevices, "attention")).toBe(2);
  });

  it("groups by device type", () => {
    expect(filterDevices(allStatusDevices, "", "consoles")).toHaveLength(1);
    expect(filterDevices(allStatusDevices, "", "media")).toHaveLength(1);
    expect(filterDevices(allStatusDevices, "", "computers")).toHaveLength(1);
    expect(filterDevices(allStatusDevices, "", "smartHome")).toHaveLength(1);
  });
});
