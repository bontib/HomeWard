import { afterAll, beforeAll, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { useTestPrisma } from "@/test/db-client";
import { startTestDb, type TestDb } from "@/test/test-db";

let db: TestDb;
let prisma: PrismaClient;

beforeAll(async () => {
  db = await startTestDb();
  prisma = useTestPrisma(db);
  Object.assign(process.env, {
    DATABASE_URL: db.url,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123",
    ALLOW_SIGNUP: "false",
  });
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

it("refuses new accounts when ALLOW_SIGNUP is false", async () => {
  const { getAuth } = await import("./auth");
  await expect(
    getAuth().api.signUpEmail({
      body: { email: "new@example.com", password: "long-enough-password", name: "New" },
    }),
  ).rejects.toThrow();
  expect(await prisma.user.count()).toBe(0);
});
