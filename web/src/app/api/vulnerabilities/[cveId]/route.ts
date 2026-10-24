import { getVulnerabilityDetail } from "@/server/vulnerabilities";
import { json, route, withSession } from "@/server/http";

export const GET = route<{ cveId: string }>(async (req, ctx) => {
  const { userId } = await withSession(req);
  const { cveId } = await ctx.params;
  return json(await getVulnerabilityDetail(userId, cveId));
});
