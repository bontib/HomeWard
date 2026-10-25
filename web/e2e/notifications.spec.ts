import type { Browser, Page } from "@playwright/test";
import {
  addDeviceWithProduct,
  addOtherDevice,
  expect,
  newClientIp,
  test,
  type Account,
} from "./fixtures";
import {
  linkIn,
  mailsFor,
  mailsWithSubject,
  queueDigest,
  queueRescan,
  waitForDigestDone,
  waitForIdle,
  waitForMail,
  type Mail,
} from "./support/mail";
import { BASE_URL } from "./support/stack";

const XBOX = {
  search: "xbox",
  productTitle: "Xbox One Firmware",
  version: "10.0.19041.1000",
};
const RIGHT_AWAY = /needs fixing now$/;

async function openSettings(page: Page) {
  await page.goto("/settings/notifications");
  await expect(page.getByRole("heading", { level: 2, name: "Email alerts" })).toBeVisible();
}

/** Opens a mail link as a signed-out visitor, the way a mail program would. */
async function openSignedOut(browser: Browser) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": newClientIp() },
  });
  return { page: await context.newPage(), close: () => context.close() };
}

async function confirmFromMail(browser: Browser, page: Page, account: Account) {
  await openSettings(page);
  await page.getByLabel("Email me about new problems").click();
  await expect(page.getByText(`We sent a link to ${account.email}.`).first()).toBeVisible();
  const mail = await waitForMail(account.email, "Confirm email alerts from HomeGuard");
  const visitor = await openSignedOut(browser);
  await visitor.page.goto(linkIn(mail, "/notifications/confirm"));
  await visitor.page.getByRole("button", { name: "Turn on email alerts" }).click();
  await expect(visitor.page.getByRole("heading", { name: "Email alerts are on." })).toBeVisible();
  await visitor.close();
  return mail;
}

function expectHonest(mail: Mail) {
  const withoutFooterClaim = `${mail.subject}\n${mail.body}`
    .replace("No email does not mean a device is safe.", "")
    .toLowerCase();
  expect(withoutFooterClaim, mail.subject).not.toMatch(
    /safe|all clear|all good|good news|up to date/,
  );
  expect(mail.body).toContain("No email does not mean a device is safe.");
  expect(mail.body).toContain("We only email about new problems.");
}

test("the settings page shows Off, then waiting for the link, then On", async ({
  user: { page, account },
  browser,
}) => {
  await openSettings(page);
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
  await expect(page.getByText("Off. Turn it on and we'll send a link to confirm.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send a test email" })).toBeDisabled();
  await expect(page.getByText("Turn on email alerts first.")).toBeVisible();

  await page.getByLabel("Email me about new problems").click();
  await expect(page.getByText("Waiting for you")).toBeVisible();
  await expect(
    page.getByText(`We sent a link to ${account.email}. Open it to turn on alerts.`),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send the link again" })).toBeDisabled();
  await expect(page.getByText(/You can ask again in \d+ minutes?\./)).toBeVisible();

  const mail = await waitForMail(account.email, "Confirm email alerts from HomeGuard");
  const visitor = await openSignedOut(browser);
  await visitor.page.goto(linkIn(mail, "/notifications/confirm"));
  await visitor.page.getByRole("button", { name: "Turn on email alerts" }).click();
  await expect(visitor.page.getByRole("heading", { name: "Email alerts are on." })).toBeVisible();
  await visitor.close();

  await page.reload();
  await expect(page.getByText(`On. Sent to ${account.email}.`)).toBeVisible();
  await expect(page.getByLabel("Email me about new problems")).toBeChecked();
  expectHonest(mail);
});

test("turning alerts on mails a link that works while signed out, and only the button confirms", async ({
  user: { page, account },
  browser,
}) => {
  await openSettings(page);
  await page.getByLabel("Email me about new problems").click();
  const mail = await waitForMail(account.email, "Confirm email alerts from HomeGuard");
  expect(mail.body).toContain("The link works for 48 hours.");
  const link = linkIn(mail, "/notifications/confirm");

  const visitor = await openSignedOut(browser);
  await visitor.page.goto(link);
  await expect(visitor.page).toHaveURL(/\/notifications\/confirm\?token=/);
  await expect(visitor.page.getByRole("heading", { level: 1 })).toHaveText(
    /Turn on email alerts for .\*\*\*@/,
  );
  // Opening the link (a mail scanner would do this) changed nothing.
  const view = await page.request.get("/api/notifications");
  expect((await view.json()).settings.state).toBe("PENDING_CONFIRM");

  await visitor.page.getByRole("button", { name: "Turn on email alerts" }).click();
  await expect(visitor.page.getByRole("heading", { name: "Email alerts are on." })).toBeVisible();
  expect((await (await page.request.get("/api/notifications")).json()).settings.state).toBe("ON");

  // The same link a second time is not an error.
  await visitor.page.goto(link);
  await expect(visitor.page.getByRole("heading", { name: "Email alerts are on." })).toBeVisible();
  await visitor.close();
});

test("the test email button sends a mail and then asks to wait", async ({
  user: { page, account },
  browser,
}) => {
  await confirmFromMail(browser, page, account);
  await openSettings(page);
  await page.getByRole("button", { name: "Send a test email" }).click();
  await expect(page.getByText(`Sent to ${account.email}. Check your inbox.`)).toBeVisible();
  const mail = await waitForMail(account.email, "HomeGuard test email");
  expect(mail.body).toContain("This is a test email.");
  expectHonest(mail);

  await expect(page.getByRole("button", { name: "Send a test email" })).toBeDisabled();
  await expect(
    page.getByText("Wait a few minutes before sending another test email."),
  ).toBeVisible();
});

test("a new Critical finding sends one mail right away, and a rescan sends no second one", async ({
  user: { page, account },
  browser,
}) => {
  await confirmFromMail(browser, page, account);
  await addDeviceWithProduct(page, { name: "Hall Xbox", ...XBOX });
  const mail = await waitForMail(account.email, "Hall Xbox needs fixing now");
  expect(mail.body).toContain("Critical: Security problem in");
  expect(mail.body).toContain("Last checked: ");
  expect(linkIn(mail, "/devices/")).toContain(BASE_URL);
  expect(mail.headers["list-unsubscribe"]).toMatch(/notifications\/unsubscribe\/one-click\?token=/);
  expect(mail.headers["list-unsubscribe-post"]).toBe("List-Unsubscribe=One-Click");
  expectHonest(mail);

  await page.getByRole("button", { name: "Check again" }).click();
  await waitForIdle(account.email);
  await page.getByRole("button", { name: "Check again" }).click();
  await waitForIdle(account.email);
  await queueRescan(account.email);
  await waitForIdle(account.email);
  expect(await mailsWithSubject(account.email, RIGHT_AWAY)).toHaveLength(1);
});

test("problems that existed before alerts were turned on are not mailed", async ({
  user: { page, account },
  browser,
}) => {
  await addDeviceWithProduct(page, { name: "Old Xbox", ...XBOX });
  await expect(page.getByRole("button", { name: "Ignore CVE-2024-1111" })).toBeVisible();
  await waitForIdle(account.email);

  await confirmFromMail(browser, page, account);
  await page.goto("/");
  await page
    .getByRole("link", { name: /Old Xbox/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Check again" }).click();
  await waitForIdle(account.email);
  await queueRescan(account.email);
  await waitForIdle(account.email);
  expect(await mailsWithSubject(account.email, RIGHT_AWAY)).toHaveLength(0);
});

test("a device that is Not tracked sends no mail, and the daily summary is silent when nothing is new", async ({
  user: { page, account },
  browser,
}) => {
  await confirmFromMail(browser, page, account);
  await addOtherDevice(page, "Mystery thing");
  await expect(page.getByText("Not tracked").first()).toBeVisible();
  await waitForIdle(account.email);
  await queueDigest();
  await waitForDigestDone();
  await waitForIdle(account.email);
  const subjects = (await mailsFor(account.email)).map((m) => m.subject);
  expect(subjects).toEqual(["Confirm email alerts from HomeGuard"]);
});

test("the unsubscribe link asks first, then stops mail for later Critical findings", async ({
  user: { page, account },
  browser,
}) => {
  await confirmFromMail(browser, page, account);
  await addDeviceWithProduct(page, { name: "First Xbox", ...XBOX });
  const mail = await waitForMail(account.email, "First Xbox needs fixing now");
  const link = linkIn(mail, "/notifications/unsubscribe?");

  const visitor = await openSignedOut(browser);
  await visitor.page.goto(link);
  await expect(visitor.page.getByRole("heading", { level: 1 })).toHaveText(
    /Stop email alerts for .\*\*\*@/,
  );
  expect((await (await page.request.get("/api/notifications")).json()).settings.state).toBe("ON");
  await visitor.page.getByRole("button", { name: "Stop email alerts" }).click();
  await expect(visitor.page.getByRole("heading", { name: "Email alerts are off." })).toBeVisible();
  await visitor.close();

  await openSettings(page);
  await expect(page.getByText("Off. Turn it on and we'll send a link to confirm.")).toBeVisible();
  await addDeviceWithProduct(page, { name: "Second Xbox", ...XBOX });
  await waitForIdle(account.email);
  expect(await mailsWithSubject(account.email, /Second Xbox/)).toHaveLength(0);
});

test("one-click unsubscribe takes a form POST and nothing else", async ({
  user: { page, account },
  browser,
}) => {
  await confirmFromMail(browser, page, account);
  await addDeviceWithProduct(page, { name: "Click Xbox", ...XBOX });
  const mail = await waitForMail(account.email, "Click Xbox needs fixing now");
  const url = mail.headers["list-unsubscribe"]?.match(/<(https?:\/\/[^>]*one-click[^>]*)>/)?.[1];
  expect(url, mail.headers["list-unsubscribe"]).toBeTruthy();

  const visitor = await openSignedOut(browser);
  const json = await visitor.page.request.post(url as string, {
    data: { "List-Unsubscribe": "One-Click" },
  });
  expect(json.status()).toBe(415);
  const get = await visitor.page.request.get(url as string);
  expect(get.status()).toBe(405);
  expect((await (await page.request.get("/api/notifications")).json()).settings.state).toBe("ON");

  const form = await visitor.page.request.post(url as string, {
    form: { "List-Unsubscribe": "One-Click" },
  });
  expect(form.status()).toBe(200);
  await visitor.close();
  expect((await (await page.request.get("/api/notifications")).json()).settings.state).toBe("OFF");
});

test("user B cannot use or read user A's links, and a changed token is refused", async ({
  user: { page, account },
  makeUser,
  browser,
}) => {
  const b = await makeUser();
  await openSettings(page);
  await page.getByLabel("Email me about new problems").click();
  const mail = await waitForMail(account.email, "Confirm email alerts from HomeGuard");
  const token = new URL(linkIn(mail, "/notifications/confirm")).searchParams.get("token") as string;

  // B sees only B's own address and state.
  const bView = await b.page.request.get("/api/notifications");
  const bSettings = (await bView.json()).settings;
  expect(bSettings.email).toBe(b.account.email);
  expect(bSettings.state).toBe("OFF");
  expect(JSON.stringify(bSettings)).not.toContain(account.email);

  // B posting A's token does not touch B.
  const post = await b.page.request.post("/api/notifications/confirm", {
    headers: { origin: BASE_URL },
    data: { token },
  });
  expect(post.status()).toBe(200);
  expect((await (await b.page.request.get("/api/notifications")).json()).settings.state).toBe(
    "OFF",
  );

  // A changed token is refused with the same answer as an expired one.
  const flipped = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
  const bad = await b.page.request.post("/api/notifications/confirm", {
    headers: { origin: BASE_URL },
    data: { token: flipped },
  });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error.code).toBe("INVALID_LINK");

  const visitor = await openSignedOut(browser);
  await visitor.page.goto(`/notifications/confirm?token=${flipped}`);
  await expect(
    visitor.page.getByRole("heading", { name: "This link doesn't work." }),
  ).toBeVisible();
  await expect(visitor.page.getByRole("button", { name: "Turn on email alerts" })).toHaveCount(0);
  await visitor.close();
});

test("the settings page needs a session", async ({ browser }) => {
  const visitor = await openSignedOut(browser);
  await visitor.page.goto("/settings/notifications");
  await expect(visitor.page).toHaveURL(/\/sign-in|\/login/);
  const api = await visitor.page.request.get("/api/notifications");
  expect(api.status()).toBe(401);
  await visitor.close();
});
