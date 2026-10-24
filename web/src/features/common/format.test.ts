import { describe, expect, it } from "vitest";
import { formatDate, timeAgo, vendorName } from "./format";

const NOW = new Date("2026-03-12T12:00:00Z").getTime();

describe("timeAgo", () => {
  it("uses plain units", () => {
    expect(timeAgo("2026-03-12T11:59:40Z", NOW)).toBe("just now");
    expect(timeAgo("2026-03-12T11:59:00Z", NOW)).toBe("1 minute ago");
    expect(timeAgo("2026-03-12T10:00:00Z", NOW)).toBe("2 hours ago");
    expect(timeAgo("2026-03-09T12:00:00Z", NOW)).toBe("3 days ago");
  });
});

describe("formatDate", () => {
  it("is stable across time zones", () => {
    expect(formatDate("2026-03-12T23:30:00Z")).toBe("12 March 2026");
  });
});

describe("vendorName", () => {
  it("title-cases words and keeps known acronyms", () => {
    expect(vendorName("sony")).toBe("Sony");
    expect(vendorName("western digital")).toBe("Western Digital");
    expect(vendorName("tp-link")).toBe("TP-Link");
    expect(vendorName("lg")).toBe("LG");
    expect(vendorName("hp")).toBe("HP");
  });
});
