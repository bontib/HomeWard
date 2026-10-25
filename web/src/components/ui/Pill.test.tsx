// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "./icons";
import { Pill } from "./Pill";

describe("Pill", () => {
  it("shows plain text with no icon by default", () => {
    const { container } = render(<Pill>Example</Pill>);
    expect(screen.getByText("Example")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("puts the icon before the text and hides it from screen readers", () => {
    const { container } = render(
      <Pill tone="update" icon={<Icon name="clock" />}>
        Waiting for you
      </Pill>,
    );
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    expect(screen.getByText("Waiting for you")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("bg-update-tint");
  });
});
