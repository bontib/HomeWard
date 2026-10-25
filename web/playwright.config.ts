import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, SMTP_OFF } from "./e2e/support/stack";

// The stack (Postgres, mock NVD, Next.js, Rust worker) is started by global setup.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  // The @no-smtp specs need a worker without SMTP, so they run in their own pass.
  ...(SMTP_OFF ? { grep: /@no-smtp/ } : { grepInvert: /@no-smtp/ }),
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
