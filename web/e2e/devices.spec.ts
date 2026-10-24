import { addDeviceWithProduct, addOtherDevice, expect, test } from "./fixtures";

test("a known vulnerable product shows CVEs and a risk badge", async ({ user: { page } }) => {
  await addDeviceWithProduct(page, {
    name: "Living room Xbox",
    search: "xbox",
    productTitle: "Xbox One Firmware",
    version: "10.0.19041.1000",
  });
  await expect(page.getByText("Critical").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Ignore CVE-2024-1111" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Known vulnerabilities · [1-9]/ })).toBeVisible();
});

test("an unknown product is shown as Not tracked", async ({ user: { page } }) => {
  await addOtherDevice(page, "Mystery thing");
  await expect(page.getByText("Not tracked").first()).toBeVisible();
  await expect(
    page.getByText("We can't check this device yet, so we can't list any."),
  ).toBeVisible();
});

test("ignoring a finding with a reason and reopening it updates the device", async ({
  user: { page },
}) => {
  await addDeviceWithProduct(page, {
    name: "Xbox to ignore",
    search: "xbox",
    productTitle: "Xbox One Firmware",
    version: "10.0.19041.1000",
  });
  const heading = page.getByRole("heading", { name: /Known vulnerabilities/ });
  await expect(page.getByRole("button", { name: "Ignore CVE-2024-1111" })).toBeVisible();
  await expect(heading).not.toHaveText(/· 0$/);

  await page.getByRole("button", { name: "Ignore CVE-2024-1111" }).click();
  await page.getByLabel("Why are you ignoring it?").fill("Not exposed to the internet");
  await page.getByRole("button", { name: "Ignore problem" }).click();
  await expect(page.getByRole("button", { name: "Reopen CVE-2024-1111" })).toBeVisible();
  await expect(page.getByText("Not exposed to the internet")).toBeVisible();

  await page.getByRole("button", { name: "Reopen CVE-2024-1111" }).click();
  await expect(page.getByRole("button", { name: "Ignore CVE-2024-1111" })).toBeVisible();
});

test("the dashboard to device to CVE page reaches an NVD link", async ({ user: { page } }) => {
  await addDeviceWithProduct(page, {
    name: "Xbox for links",
    search: "xbox",
    productTitle: "Xbox One Firmware",
    version: "10.0.19041.1000",
  });
  await page.goto("/");
  await page
    .getByRole("link", { name: /Xbox for links/ })
    .first()
    .click();
  await page
    .getByRole("link", { name: /CVE-2024-1111/ })
    .first()
    .click();
  await expect(page.getByRole("link", { name: "Full details on NVD" }).first()).toHaveAttribute(
    "href",
    /nvd\.nist\.gov\/vuln\/detail\/CVE-2024-1111/,
  );
});
