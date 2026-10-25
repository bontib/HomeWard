import { json, route, withSameSite } from "@/server/http";
import { parseTokenBody } from "@/server/notification-http";
import { unsubscribeEmailAlerts } from "@/server/notifications";

export const POST = route(async (req) => {
  withSameSite(req);
  const token = await parseTokenBody(req, "unsubscribe");
  return json(await unsubscribeEmailAlerts(token));
});
