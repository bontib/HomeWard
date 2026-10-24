import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  ALLOW_SIGNUP: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  MAX_SBOM_MB: z.coerce.number().int().min(1).max(100).default(20),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parses the given variables. Throws an Error that names every bad variable. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
  throw new Error(`Invalid environment:\n${lines.join("\n")}`);
}

let cached: Env | undefined;

/** Reads process.env once. Exits the process with a plain message when it is wrong. */
export function getEnv(): Env {
  if (cached) return cached;
  try {
    cached = parseEnv(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  return cached;
}
