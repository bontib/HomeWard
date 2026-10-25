import { route } from "@/server/http";
import { emptyOk, readOneClickRequest } from "@/server/notification-http";
import { unsubscribeEmailAlerts } from "@/server/notifications";

// RFC 8058 one-click unsubscribe. The mail provider posts from its own servers, so there is no
// Origin and no cookie. The signed token in the query is the only credential.
export const POST = route(async (req) => {
  await unsubscribeEmailAlerts(await readOneClickRequest(req));
  return emptyOk();
});
