import { listComponents } from "@/server/components";
import { json, route, withSession } from "@/server/http";

export const GET = route<{ id: string }>(async (req, ctx) => {
  const { userId } = await withSession(req);
  const { id } = await ctx.params;
  return json({ components: await listComponents(userId, id) });
});
