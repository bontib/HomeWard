import { CreateDeviceSchema } from "@/lib/contracts";
import { createDevice, listDevices } from "@/server/devices";
import { json, parseJsonBody, route, withSession } from "@/server/http";

export const GET = route(async (req) => {
  const { userId } = await withSession(req);
  return json({ devices: await listDevices(userId) });
});

export const POST = route(async (req) => {
  const { userId } = await withSession(req);
  const input = await parseJsonBody(req, CreateDeviceSchema);
  return json(await createDevice(userId, input), 201);
});
