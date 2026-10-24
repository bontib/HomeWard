// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VersionTag } from "./VersionTag";

describe("VersionTag", () => {
  it("shows the version with a v", () => {
    render(<VersionTag current="3.1.0" />);
    expect(screen.getByText("v3.1.0")).toBeInTheDocument();
  });

  it("shows the target after an arrow", () => {
    render(<VersionTag current="3.1.0" target="3.1.2" />);
    expect(screen.getByText("3.1.2")).toBeInTheDocument();
    expect(screen.getByText("update to")).toBeInTheDocument();
  });

  it("hides the arrow when the target is unknown or the same", () => {
    const { rerender } = render(<VersionTag current="3.1.0" target={null} />);
    expect(screen.queryByText("update to")).toBeNull();
    rerender(<VersionTag current="3.1.0" target="3.1.0" />);
    expect(screen.queryByText("update to")).toBeNull();
  });

  it("says 'version ?' when unknown", () => {
    render(<VersionTag current={null} />);
    expect(screen.getByText("version ?")).toBeInTheDocument();
  });

  it("does not add a v to versions that start with a letter", () => {
    render(<VersionTag current="Build 4" />);
    expect(screen.getByText("Build 4")).toBeInTheDocument();
  });
});
