/** Runs once when the server starts. A bad setting stops the container here, with a plain message. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getEnv } = await import("@/lib/env");
  getEnv();
}
