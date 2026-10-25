import { SetEmailAlertsSchema } from "@/lib/contracts";
import { json, parseJsonBody, route, withSession } from "@/server/http";
import { setEmailAlerts } from "@/server/notifications";

export const PUT = route(async (req) => {
  const { userId } = await withSession(req);
  const input = await parseJsonBody(req, SetEmailAlertsSchema);
  return json(await setEmailAlerts(userId, input.enabled));
});
