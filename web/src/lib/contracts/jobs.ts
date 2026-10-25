// Job payloads. Source of truth: docs/architecture-v1.md section 4.1 and
// docs/architecture-notifications.md section 3.1.
// The Rust side is worker/src/contract.rs. Both parse the files in contracts/jobs/.
import { z } from "zod";
import type { JobType } from "./enums";

export const JobPayloadSchemas = {
  CHECK_DEVICE: z.object({ deviceId: z.string().min(1) }),
  RECOMPUTE_STATUS: z.object({ deviceId: z.string().min(1) }),
  SEARCH_PRODUCTS: z.object({ query: z.string().min(2).max(60) }),
  RESCAN_ALL: z.object({ userId: z.string().nullable() }),
  UPDATE_TRIVY_DB: z.object({}),
  IMPORT_KEV: z.object({}),
  DEV_NOOP: z.object({ sleepMs: z.number().int().min(0).max(5000).optional() }),
  SEND_EMAIL: z.object({ notificationId: z.string().min(1) }),
  SEND_DIGEST: z.object({}),
} satisfies Record<JobType, z.ZodType>;

export type JobPayload<T extends JobType> = z.infer<(typeof JobPayloadSchemas)[T]>;
