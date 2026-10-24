import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { resetTables, useTestPrisma } from "@/test/db-client";
import { startTestDb, type TestDb } from "@/test/test-db";

let db: TestDb;
let prisma: PrismaClient;
let auth: typeof import("./auth");

beforeAll(async () => {
  db = await startTestDb();
  prisma = useTestPrisma(db);
  Object.assign(process.env, {
    DATABASE_URL: db.url,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123",
    BETTER_AUTH_URL: "http://localhost:3000",
    ALLOW_SIGNUP: "true",
  });
  auth = await import("./auth");
  await resetTables(db);
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

const signUp = (email: string, password: string) =>
  auth.getAuth().api.signUpEmail({ body: { email, password, name: "Test" } });

describe("email and password", () => {
  it("refuses a password shorter than 12 characters", async () => {
    await expect(signUp("short@example.com", "elevenchars")).rejects.toThrow();
  });

  it("accepts a 12 character password and starts a session", async () => {
    await signUp("ok@example.com", "twelve-chars");
    const result = await auth.getAuth().api.signInEmail({
      body: { email: "ok@example.com", password: "twelve-chars" },
      returnHeaders: true,
    });
    const cookie = result.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const info = await auth.getSessionInfo(new Headers({ cookie }));
    expect(info?.email).toBe("ok@example.com");
  });

  it("gives no session without a cookie", async () => {
    expect(await auth.getSessionInfo(new Headers())).toBeNull();
  });
});

describe("scripts/reset-password.mjs", () => {
  const script = path.resolve(import.meta.dirname, "../../scripts/reset-password.mjs");
  // The password is read from stdin, never from the command line.
  const run = (email: string, password: string | null, ...flags: string[]) =>
    execFileSync("node", [script, email, ...flags], {
      env: { ...process.env, DATABASE_URL: db.url },
      encoding: "utf8",
      input: password ?? "",
      stdio: ["pipe", "pipe", "pipe"],
    });

  it("lets the user sign in with the new password and ends old sessions", async () => {
    await signUp("reset@example.com", "old-password-1");
    await auth
      .getAuth()
      .api.signInEmail({ body: { email: "reset@example.com", password: "old-password-1" } });
    run("reset@example.com", "brand-new-password");

    const { rows } = await db.pool.query(
      "SELECT count(*)::int AS n FROM session s JOIN app_user u ON u.id = s.user_id WHERE u.email = 'reset@example.com'",
    );
    expect(rows[0].n).toBe(0);
    await expect(
      auth
        .getAuth()
        .api.signInEmail({ body: { email: "reset@example.com", password: "old-password-1" } }),
    ).rejects.toThrow();
    await expect(
      auth
        .getAuth()
        .api.signInEmail({ body: { email: "reset@example.com", password: "brand-new-password" } }),
    ).resolves.toBeDefined();
  });

  it("generates a password and prints it once", async () => {
    await signUp("gen@example.com", "old-password-2");
    const output = run("gen@example.com", null, "--generate");
    const generated = /shown once\): (\S+)/.exec(output)?.[1] ?? "";
    expect(generated.length).toBeGreaterThanOrEqual(12);
    await expect(
      auth.getAuth().api.signInEmail({ body: { email: "gen@example.com", password: generated } }),
    ).resolves.toBeDefined();
  });

  it("refuses a short password", () => {
    expect(() => run("reset@example.com", "short")).toThrow(/at least 12/);
  });

  it("says so when the email is unknown", () => {
    expect(() => run("nobody@example.com", "long-enough-password")).toThrow(
      /No account with that email/,
    );
  });
});
