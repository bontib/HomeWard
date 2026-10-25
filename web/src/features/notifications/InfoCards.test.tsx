// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlertSampleCard } from "./AlertSampleCard";
import { alertsOn } from "./fixtures";
import { WhatWeEmailCard } from "./WhatWeEmailCard";

describe("WhatWeEmailCard", () => {
  it("shows the daily time with the server time zone", () => {
    render(<WhatWeEmailCard settings={alertsOn} />);
    expect(
      screen.getByRole("heading", { name: "Daily summary, 7 am (server time, Europe/Amsterdam)" }),
    ).toBeInTheDocument();
  });

  it("still shows when the settings could not load, and says what is not emailed", () => {
    render(<WhatWeEmailCard settings={undefined} />);
    expect(
      screen.getByRole("heading", { name: "Daily summary, 7 am (server time)" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Update available, Low and Not tracked/)).toBeInTheDocument();
    expect(screen.getByText("Not tracked")).toBeInTheDocument();
    expect(screen.getByText(/No email does not mean a device is safe/)).toBeInTheDocument();
  });

  it("has no controls: there is nothing to set", () => {
    render(<WhatWeEmailCard settings={alertsOn} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("AlertSampleCard", () => {
  it("is marked as an example with a made-up device", () => {
    render(<AlertSampleCard />);
    expect(screen.getByText("Example")).toBeInTheDocument();
    expect(screen.getByLabelText("Example email")).toHaveTextContent(
      "Front door camera needs fixing now",
    );
    expect(screen.getByText("Update to 3.1.2 to fix this.")).toBeInTheDocument();
  });
});
