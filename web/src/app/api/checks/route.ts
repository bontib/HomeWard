import { getChecksStatus } from "@/server/checks";
import { json, route, withSession } from "@/server/http";

export const GET = route(async (req) => {
  const { userId } = await withSession(req);
  return json(await getChecksStatus(userId));
});
