import { UpdateFindingSchema } from "@/lib/contracts";
import { updateFinding } from "@/server/findings";
import { json, parseJsonBody, route, withSession } from "@/server/http";

export const PATCH = route<{ id: string }>(async (req, ctx) => {
  const { userId } = await withSession(req);
  const { id } = await ctx.params;
  const input = await parseJsonBody(req, UpdateFindingSchema);
  return json(await updateFinding(userId, id, input));
});
