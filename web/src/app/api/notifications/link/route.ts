import { z } from "zod";
import { json, parseWith, route } from "@/server/http";
import { parseToken } from "@/server/notification-http";
import { getLinkView } from "@/server/notifications";

const PurposeSchema = z.enum(["confirm", "unsubscribe"]);

// No session: the signed token is the credential. Reads only, so link scanners change nothing.
export const GET = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const purpose = parseWith(PurposeSchema, params.get("purpose"));
  const token = parseToken({ token: params.get("token") }, purpose);
  return json({ link: await getLinkView(purpose, token) });
});
