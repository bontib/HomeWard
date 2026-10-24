// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorText } from "./ErrorText";

describe("ErrorText", () => {
  it("shows an icon next to the words", () => {
    const { container } = render(<ErrorText>That did not work.</ErrorText>);
    expect(screen.getByRole("alert")).toHaveTextContent("That did not work.");
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
