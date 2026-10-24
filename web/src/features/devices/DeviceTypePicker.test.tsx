// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddDeviceTile } from "./AddDeviceTile";
import { DeviceTypePicker } from "./DeviceTypePicker";
import { DeviceIcon } from "./DeviceIcon";

describe("DeviceTypePicker", () => {
  it("marks the chosen type and reports changes", async () => {
    const onChange = vi.fn();
    render(<DeviceTypePicker value="TV" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "TV" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Camera" }));
    expect(onChange).toHaveBeenCalledWith("CAMERA");
  });

  it("offers all 16 device types", () => {
    render(<DeviceTypePicker value={null} onChange={() => undefined} />);
    expect(screen.getAllByRole("button")).toHaveLength(16);
  });
});

describe("AddDeviceTile and DeviceIcon", () => {
  it("links to the add page", () => {
    render(<AddDeviceTile />);
    expect(screen.getByRole("link", { name: /Add a device/ })).toHaveAttribute(
      "href",
      "/devices/new",
    );
  });

  it("names the icon by device type", () => {
    render(<DeviceIcon type="CONSOLE" />);
    expect(screen.getByRole("img", { name: "Game console" })).toBeInTheDocument();
  });
});
