// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  criticalVulnerability,
  lowVulnerability,
  mediumVulnerability,
} from "@/features/devices/fixtures";
import { CveItem } from "./CveItem";
import { firstTwoSentences } from "@/features/common/format";

describe("CveItem", () => {
  it("shows score, id link, level, exploited badge, title, short summary and fix", () => {
    render(
      <CveItem
        vulnerability={criticalVulnerability}
        productName="E1 Outdoor"
        fixedVersion="3.1.2"
      />,
    );
    expect(screen.getByText("9.8")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CVE-2026-10231" })).toHaveAttribute(
      "href",
      "/vulnerabilities/CVE-2026-10231",
    );
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Exploited in the wild")).toBeInTheDocument();
    expect(screen.getByText("Security problem in E1 Outdoor")).toBeInTheDocument();
    expect(screen.queryByText(/More detail follows/)).toBeNull();
    expect(screen.getByText("3.1.2")).toBeInTheDocument();
  });

  it("says 'No fix known yet.' without a fixed version", () => {
    render(<CveItem vulnerability={mediumVulnerability} productName={null} fixedVersion={null} />);
    expect(screen.getByText("No fix known yet.")).toBeInTheDocument();
    expect(screen.getByText("Security problem")).toBeInTheDocument();
    expect(screen.getByText("Vulnerable")).toBeInTheDocument();
  });

  it("labels low scores Low and shows ignored items with the reason", () => {
    render(
      <CveItem
        vulnerability={lowVulnerability}
        productName="X"
        fixedVersion={null}
        ignored
        ignoredReason="Not online"
      />,
    );
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("Ignored")).toBeInTheDocument();
    expect(screen.getByText("Your reason: Not online")).toBeInTheDocument();
  });
});

describe("firstTwoSentences", () => {
  it("keeps two sentences", () => {
    expect(firstTwoSentences("One. Two! Three.")).toBe("One. Two!");
    expect(firstTwoSentences("Only one")).toBe("Only one");
  });
});
