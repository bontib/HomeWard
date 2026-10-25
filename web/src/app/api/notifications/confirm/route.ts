import { json, route, withSameSite } from "@/server/http";
import { parseTokenBody } from "@/server/notification-http";
import { confirmEmailAlerts } from "@/server/notifications";

// No session: the signed token is the credential. POST only, so a GET (link scanner) changes nothing.
export const POST = route(async (req) => {
  withSameSite(req);
  const token = await parseTokenBody(req, "confirm");
  return json(await confirmEmailAlerts(token));
});
