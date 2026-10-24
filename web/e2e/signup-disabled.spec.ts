import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import { BASE_URL, DATABASE_URL } from "./support/stack";

// A second Next.js server on another port with ALLOW_SIGNUP=false, same database.
const PORT = 3101;
const URL_OFF = `http://127.0.0.1:${PORT}`;

test.describe("sign-up turned off", () => {
  let server: ReturnType<typeof spawn>;

  test.beforeAll(async () => {
    server = spawn(
      process.execPath,
      [
        path.resolve(__dirname, "../node_modules/next/dist/bin/next"),
        "start",
        "-p",
        String(PORT),
        "-H",
        "127.0.0.1",
      ],
      {
        cwd: path.resolve(__dirname, ".."),
        env: Object.assign({}, process.env, {
          DATABASE_URL,
          BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-0123",
          BETTER_AUTH_URL: URL_OFF,
          ALLOW_SIGNUP: "false",
          NODE_ENV: "production",
        }),
        stdio: "ignore",
      },
    );
    await expect
      .poll(async () => (await fetch(`${URL_OFF}/api/health`).catch(() => null))?.ok ?? false, {
        timeout: 60_000,
      })
      .toBe(true);
  });

  test.afterAll(() => {
    server?.kill("SIGTERM");
  });

  test("the sign-up page says it is off and the API refuses", async ({ page, request }) => {
    expect(BASE_URL).not.toBe(URL_OFF);
    await page.goto(`${URL_OFF}/signup`);
    await expect(page.getByRole("heading", { name: "Sign-up is turned off" })).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveCount(0);

    const res = await request.post(`${URL_OFF}/api/auth/sign-up/email`, {
      headers: { origin: URL_OFF },
      data: {
        name: "X",
        email: `closed-${Date.now()}@example.test`,
        password: "correct-horse-battery",
      },
    });
    expect(res.ok()).toBe(false);
  });
});
