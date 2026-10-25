import { SendTestEmailSchema } from "@/lib/contracts";
import { json, parseJsonBody, route, withSession } from "@/server/http";
import { sendTestEmail } from "@/server/notifications";

export const POST = route(async (req) => {
  const { userId } = await withSession(req);
  await parseJsonBody(req, SendTestEmailSchema);
  return json(await sendTestEmail(userId), 202);
});
