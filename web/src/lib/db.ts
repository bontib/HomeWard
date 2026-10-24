import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "./env";

const globalForDb = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: getEnv().DATABASE_URL, max: 5 });
  return new PrismaClient({ adapter });
}

// Lazy on purpose: importing a route file during `next build` must not need a database
// or exit because of missing env vars. One client per process; globalThis survives dev reloads.
export function getDb(): PrismaClient {
  globalForDb.prisma ??= createClient();
  return globalForDb.prisma;
}
