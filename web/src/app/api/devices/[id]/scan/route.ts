import { scanDevice } from "@/server/jobs";
import { json, route, withSession } from "@/server/http";

export const POST = route<{ id: string }>(async (req, ctx) => {
  const { userId } = await withSession(req);
  const { id } = await ctx.params;
  return json({ jobId: await scanDevice(userId, id) }, 202);
});
