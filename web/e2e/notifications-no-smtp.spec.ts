// These run in the second pass, where the worker has no SMTP settings.
import { addDeviceWithProduct, expect, test } from "./fixtures";
import { BASE_URL } from "./support/stack";

test("@no-smtp the page says email is not set up and nothing can be turned on", async ({
  user: { page },
}) => {
  await page.goto("/settings/notifications");
  await expect(page.getByText("Not set up", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Email alerts aren't set up on this HomeGuard yet. Ask the person who runs it."),
  ).toBeVisible();
  await expect(page.getByLabel("Email me about new problems")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send a test email" })).toBeDisabled();

  const put = await page.request.put("/api/notifications/email", {
    headers: { origin: BASE_URL },
    data: { enabled: true },
  });
  expect(put.status()).toBe(409);
  expect((await put.json()).error.message).toBe(
    "Email alerts aren't set up on this HomeGuard yet.",
  );
});

test("@no-smtp a Critical check still shows its normal result", async ({ user: { page } }) => {
  await addDeviceWithProduct(page, {
    name: "Plain Xbox",
    search: "xbox",
    productTitle: "Xbox One Firmware",
    version: "10.0.19041.1000",
  });
  await expect(page.getByRole("button", { name: "Ignore CVE-2024-1111" })).toBeVisible();
  await page.goto("/settings/notifications");
  await expect(page.getByText("Not set up", { exact: true })).toBeVisible();
});
