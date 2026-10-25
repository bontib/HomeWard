// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Banner } from "./Banner";

describe("Banner", () => {
  it("shows its title and text", () => {
    render(<Banner title="Heads up">Plain text.</Banner>);
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByText("Plain text.")).toBeInTheDocument();
  });

  it("uses the critical icon shape for critical, not the info circle", () => {
    const info = render(<Banner>Info</Banner>).container.querySelector("path");
    const critical = render(<Banner variant="critical">Bad</Banner>).container.querySelector(
      "path",
    );
    expect(info?.getAttribute("d")).not.toBe(critical?.getAttribute("d"));
    expect(critical?.getAttribute("d")).toBe("M8 2h8l6 6v8l-6 6H8l-6-6V8z");
  });
});
