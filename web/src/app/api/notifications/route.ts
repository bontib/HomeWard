import { getNotificationSettings } from "@/server/notifications";
import { json, route, withSession } from "@/server/http";

export const GET = route(async (req) => {
  const { userId } = await withSession(req);
  return json({ settings: await getNotificationSettings(userId) });
});
