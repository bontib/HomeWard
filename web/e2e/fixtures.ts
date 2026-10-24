import { expect, test as base, type Page } from "@playwright/test";
import { BASE_URL } from "./support/stack";

let counter = 0;
const uid = () => `${Date.now().toString(36)}${process.pid}${counter++}`;

export type Account = { name: string; email: string; password: string };

export function newAccount(): Account {
  return {
    name: "Test Person",
    email: `user-${uid()}@example.test`,
    password: "correct-horse-battery",
  };
}

/** A fake client address, so the per-address sign-in rate limit never spans tests. */
export function newClientIp(): string {
  const n = Math.floor(Math.random() * 60_000) + 1;
  return `10.${(n >> 8) & 255}.${n & 255}.${(counter++ % 250) + 1}`;
}

type Fixtures = {
  /** A page already signed in as a brand-new user. */
  user: { page: Page; account: Account };
  /** Makes another signed-in user in a separate browser context. */
  makeUser: () => Promise<{ page: Page; account: Account }>;
};

// Playwright fixtures call `use`, which is not a React hook.
/* eslint-disable react-hooks/rules-of-hooks */
export const test = base.extend<Fixtures>({
  makeUser: async ({ browser }, use) => {
    const contexts: Array<{ close(): Promise<void> }> = [];
    await use(async () => {
      const context = await browser.newContext({
        baseURL: BASE_URL,
        extraHTTPHeaders: { "x-forwarded-for": newClientIp() },
      });
      contexts.push(context);
      const account = newAccount();
      const res = await context.request.post("/api/auth/sign-up/email", {
        headers: { origin: BASE_URL },
        data: account,
      });
      expect(res.ok(), await res.text()).toBe(true);
      return { page: await context.newPage(), account };
    });
    for (const c of contexts) await c.close();
  },
  user: async ({ makeUser }, use) => {
    await use(await makeUser());
  },
});

export { expect };

/** Adds a device by the form. `search` is typed into the product search. */
export async function addDeviceWithProduct(
  page: Page,
  opts: { name: string; search: string; productTitle: string; version: string },
) {
  await page.goto("/devices/new");
  await page.getByRole("button", { name: "Game console" }).click();
  await page.getByLabel("Search for the brand or model").fill(opts.search);
  await page.getByRole("radio", { name: new RegExp(opts.productTitle) }).check({ force: true });
  await page.getByLabel("Version", { exact: true }).fill(opts.version);
  await page.getByLabel("Name", { exact: true }).fill(opts.name);
  await page.getByRole("button", { name: "Add device" }).click();
  await expect(page.getByRole("heading", { level: 1, name: opts.name })).toBeVisible();
}

/** Adds a device that has no product (shows Not tracked). */
export async function addOtherDevice(page: Page, name: string, productName = "Mystery box") {
  await page.goto("/devices/new");
  await page.getByRole("button", { name: "Game console" }).click();
  await page.getByLabel("Search for the brand or model").fill("zzz");
  await page.getByRole("button", { name: "Add it as Other" }).click();
  await page.getByLabel("What is it called?").fill(productName);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add device" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}
