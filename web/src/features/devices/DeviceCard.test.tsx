// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeviceCard } from "./DeviceCard";
import { checkingTv, cleanLaptop, criticalCamera, makeDevice, untrackedPrinter } from "./fixtures";

describe("DeviceCard", () => {
  it("links the whole card to the device and shows meta, badge, version and count", () => {
    render(<DeviceCard device={criticalCamera} />);
    const link = screen.getByRole("link", { name: /Front door camera/ });
    expect(link).toHaveAttribute("href", "/devices/dev_1");
    expect(screen.getByText("Reolink · E1 Outdoor · Front door")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("v3.1.0")).toBeInTheDocument();
    expect(screen.getByText("2 known vulnerabilities")).toBeInTheDocument();
  });

  it("uses the singular for one vulnerability", () => {
    render(<DeviceCard device={makeDevice({ openFindingCount: 1, status: "VULNERABLE" })} />);
    expect(screen.getByText("1 known vulnerability")).toBeInTheDocument();
  });

  it("shows Not tracked with an explanation, never a green check", () => {
    render(<DeviceCard device={untrackedPrinter} />);
    expect(screen.getByText("Not tracked")).toBeInTheDocument();
    expect(screen.getByText("version ?")).toBeInTheDocument();
    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    expect(screen.queryByText("No known vulnerabilities")).toBeNull();
  });

  it("shows how many parts were not checked", () => {
    render(<DeviceCard device={cleanLaptop} />);
    expect(screen.getByText("No known vulnerabilities")).toBeInTheDocument();
    expect(screen.getByText("3 parts not checked")).toBeInTheDocument();
  });

  it("shows Checking while a check runs", () => {
    render(<DeviceCard device={checkingTv} />);
    expect(screen.getAllByText("Checking…").length).toBeGreaterThan(0);
  });

  it("shows a plain message when the last check failed", () => {
    render(
      <DeviceCard
        device={makeDevice({
          check: { state: "FAILED", jobId: "j", errorCode: "NVD_UNAVAILABLE" },
          openFindingCount: 0,
        })}
      />,
    );
    expect(screen.getByText(/NVD is busy/)).toBeInTheDocument();
  });
});
