// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  allStatusDevices,
  cleanLaptop,
  criticalCamera,
  makeDevice,
  vulnerableConsole,
} from "./fixtures";
import { countLevels, NetworkSummary, summaryHeadline } from "./NetworkSummary";

describe("summaryHeadline", () => {
  it("picks the worst level and never says safe", () => {
    expect(summaryHeadline(countLevels([criticalCamera, vulnerableConsole]))).toBe(
      "1 device needs fixing now",
    );
    expect(summaryHeadline(countLevels([vulnerableConsole]))).toBe("1 device is vulnerable");
    expect(
      summaryHeadline(countLevels([vulnerableConsole, makeDevice({ status: "VULNERABLE" })])),
    ).toBe("2 devices are vulnerable");
    expect(summaryHeadline(countLevels([makeDevice({ status: "UPDATE_AVAILABLE" })]))).toBe(
      "Some updates are waiting",
    );
    expect(summaryHeadline(countLevels([cleanLaptop]))).toBe("No known problems on your devices");
  });

  it("is honest when nothing can be checked", () => {
    expect(summaryHeadline(countLevels([makeDevice({ status: "NOT_TRACKED" })]))).toBe(
      "We can't check these devices yet",
    );
  });
});

describe("NetworkSummary", () => {
  it("counts devices per level and warns about unchecked ones", () => {
    render(<NetworkSummary devices={allStatusDevices} />);
    expect(screen.getByRole("heading", { name: "1 device needs fixing now" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /1 critical, 1 vulnerable/ })).toBeInTheDocument();
    expect(screen.getByText(/can't be fully checked/)).toBeInTheDocument();
    expect(screen.getByText(/does not mean a device is safe/)).toBeInTheDocument();
  });
});
