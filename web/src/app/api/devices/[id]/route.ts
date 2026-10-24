import { UpdateDeviceSchema } from "@/lib/contracts";
import { deleteDevice, getDeviceDetail, updateDevice } from "@/server/devices";
import { json, noContent, parseJsonBody, route, withSession } from "@/server/http";

type Params = { id: string };

export const GET = route<Params>(async (req, ctx) => {
  const { userId } = await withSession(req);
  const { id } = await ctx.params;
  return json({ device: await getDeviceDetail(userId, id) });
});

export const PATCH = route<Params>(async (req, ctx) => {
  const { userId } = await withSession(req);
  const { id } = await ctx.params;
  const input = await parseJsonBody(req, UpdateDeviceSchema);
  return json(await updateDevice(userId, id, input));
});

export const DELETE = route<Params>(async (req, ctx) => {
  const { userId } = await withSession(req);
  const { id } = await ctx.params;
  await deleteDevice(userId, id);
  return noContent();
});
