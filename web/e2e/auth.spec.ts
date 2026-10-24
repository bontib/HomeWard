import { expect, newAccount, newClientIp, test } from "./fixtures";
import { BASE_URL } from "./support/stack";

test.use({ extraHTTPHeaders: { "x-forwarded-for": newClientIp() } });

test("sign up, sign out, sign in again", async ({ page }) => {
  const account = newAccount();
  await page.goto("/signup");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(`${BASE_URL}/`);
  await expect(page.getByText(account.email)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("signed-out visitors are sent to the sign-in page", async ({ page }) => {
  for (const path of ["/", "/devices/new", "/vulnerabilities", "/settings"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("a wrong password shows an error and stays on the page", async ({ page, makeUser }) => {
  const { account } = await makeUser();
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill("not-the-password-123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("alert")).toBeVisible();
});

test("too many sign-in attempts from one address are refused", async ({ request }) => {
  const headers = { origin: BASE_URL, "x-forwarded-for": "203.0.113.77" };
  const statuses: number[] = [];
  for (let i = 0; i < 8; i++) {
    const res = await request.post("/api/auth/sign-in/email", {
      headers,
      data: { email: "nobody@example.test", password: "wrong-password-1" },
    });
    statuses.push(res.status());
  }
  expect(statuses.at(-1)).toBe(429);
  expect(statuses[0]).not.toBe(429);
});

test("a cross-origin POST to the auth API is refused", async ({ request }) => {
  const res = await request.post("/api/auth/sign-in/email", {
    headers: { origin: "https://evil.example" },
    data: { email: "nobody@example.test", password: "wrong-password-1" },
  });
  expect(res.status()).toBe(403);
});
