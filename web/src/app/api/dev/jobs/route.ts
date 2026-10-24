import { getEnv } from "@/lib/env";
import { AppError } from "@/server/errors";
import { enqueueDevNoop } from "@/server/jobs";
import { json, route, withSession } from "@/server/http";

export const POST = route(async (req) => {
  if (getEnv().NODE_ENV === "production") throw new AppError("NOT_FOUND", "Not found.");
  const { userId } = await withSession(req);
  const sleepMs = Number(new URL(req.url).searchParams.get("sleepMs") ?? 0);
  return json(
    { jobId: await enqueueDevNoop(userId, Math.min(5000, Math.max(0, sleepMs || 0))) },
    202,
  );
});
