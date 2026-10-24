import { VulnerabilityListQuerySchema } from "@/lib/contracts";
import { listVulnerabilities } from "@/server/vulnerabilities";
import { json, parseQuery, route, withSession } from "@/server/http";

export const GET = route(async (req) => {
  const { userId } = await withSession(req);
  const query = parseQuery(req, VulnerabilityListQuerySchema);
  return json(await listVulnerabilities(userId, query));
});
