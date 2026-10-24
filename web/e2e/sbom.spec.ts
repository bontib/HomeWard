import path from "node:path";
import { addOtherDevice, expect, test } from "./fixtures";

const fixture = (name: string) => path.join(__dirname, "fixtures", name);

test("a CycloneDX file lists components and findings", async ({ user: { page } }) => {
  await addOtherDevice(page, "Smart hub");
  await page.getByLabel("Add a software list").setInputFiles(fixture("cyclonedx.json"));
  await expect(page.getByRole("cell", { name: "log4j-core" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ignore CVE-2021-44228" })).toBeVisible();
});

test("a file that is not an SBOM gets a clear error", async ({ user: { page } }) => {
  await addOtherDevice(page, "Bad upload");
  await page.getByLabel("Add a software list").setInputFiles(fixture("not-an-sbom.json"));
  await expect(
    page.getByText("This isn't a CycloneDX or SPDX file. Export it as JSON and try again."),
  ).toBeVisible();
});

test("a file over the size limit is refused", async ({ user: { page } }) => {
  await addOtherDevice(page, "Big upload");
  await page.getByLabel("Add a software list").setInputFiles({
    name: "big.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(21 * 1024 * 1024, 32),
  });
  await expect(page.getByText("This file is larger than 20 MB.")).toBeVisible();
});
