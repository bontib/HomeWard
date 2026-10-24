import { getEnv } from "@/lib/env";
import { assertDeviceOwned, saveSbom } from "@/server/sboms";
import { json, route, withSession } from "@/server/http";
import { readSbomUpload } from "@/server/upload";

export const POST = route<{ id: string }>(async (req, ctx) => {
  const { userId } = await withSession(req);
  const { id } = await ctx.params;
  // Check the device before reading up to 20 MB from the client.
  await assertDeviceOwned(userId, id);
  const maxMb = getEnv().MAX_SBOM_MB;
  const upload = await readSbomUpload(req, maxMb);
  return json(await saveSbom(userId, id, { ...upload, maxMb }), 202);
});
