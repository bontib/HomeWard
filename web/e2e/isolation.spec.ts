import { addOtherDevice, expect, test } from "./fixtures";

test("user B cannot see or open user A's device", async ({ user, makeUser }) => {
  await addOtherDevice(user.page, "A private device");
  const url = user.page.url();
  const id = url.split("/devices/")[1];

  const other = await makeUser();
  await other.page.goto("/");
  await expect(other.page.getByText("A private device")).toHaveCount(0);

  const api = await other.page.request.get(`/api/devices/${id}`);
  expect(api.status()).toBe(404);
  const del = await other.page.request.delete(`/api/devices/${id}`, {
    headers: { origin: new URL(url).origin },
  });
  expect(del.status()).toBe(404);

  await other.page.goto(`/devices/${id}`);
  await expect(other.page.getByText("A private device")).toHaveCount(0);

  const owner = await user.page.request.get(`/api/devices/${id}`);
  expect(owner.status()).toBe(200);
});
