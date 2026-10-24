// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { cveLevel, deviceLevel, LEVEL_LABEL } from "./display";
import { RiskBadge } from "./RiskBadge";

describe("RiskBadge", () => {
  it("shows an icon and words for every level, never color alone", () => {
    for (const level of Object.keys(LEVEL_LABEL) as (keyof typeof LEVEL_LABEL)[]) {
      const { container, unmount } = render(<RiskBadge level={level} />);
      expect(screen.getByText(LEVEL_LABEL[level])).toBeInTheDocument();
      expect(container.querySelector("svg")).not.toBeNull();
      unmount();
    }
  });

  it("does not use a check mark for 'No known vulnerabilities'", () => {
    const { container } = render(<RiskBadge level="safe" />);
    const d = Array.from(container.querySelectorAll("path")).map((p) => p.getAttribute("d"));
    expect(d).not.toContain("M8.5 12l2.5 2.5 4.5-5");
  });

  it("allows custom text", () => {
    render(<RiskBadge level="critical">Exploited in the wild</RiskBadge>);
    expect(screen.getByText("Exploited in the wild")).toBeInTheDocument();
  });
});

describe("display levels", () => {
  it("never calls nothing-known 'safe' and shows untracked devices as Not tracked", () => {
    expect(LEVEL_LABEL[deviceLevel("NO_KNOWN_VULNS")]).toBe("No known vulnerabilities");
    expect(LEVEL_LABEL[deviceLevel("NOT_TRACKED")]).toBe("Not tracked");
    expect(Object.values(LEVEL_LABEL).join(" ").toLowerCase()).not.toContain("safe");
  });

  it("labels low CVEs 'Low' in the update color", () => {
    expect(cveLevel("low")).toEqual({ level: "update", label: "Low" });
  });
});
