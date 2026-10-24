import { runChecks } from "@/server/checks";
import { json, route, withSession } from "@/server/http";

export const POST = route(async (req) => {
  const { userId } = await withSession(req);
  return json({ jobId: await runChecks(userId) }, 202);
});
