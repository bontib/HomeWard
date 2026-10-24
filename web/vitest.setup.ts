import { afterEach } from "vitest";

// Only load DOM helpers when the test runs in jsdom.
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => cleanup());
}
