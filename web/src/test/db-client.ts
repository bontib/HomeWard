// Points getDb() at the throwaway test database and gives tests small row builders.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { TestDb } from "./test-db";

const TABLES = [
  "job",
  "finding",
  "version_change",
  "sbom",
  "component",
  "device",
  "cpe_product_cve",
  "cpe_product",
  "product_search",
  "vulnerability",
  "kev_entry",
  "data_source",
  "worker_status",
  "session",
  "account",
  "app_user",
];

export function useTestPrisma(db: TestDb): PrismaClient {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: db.url, max: 4 }) });
  (globalThis as unknown as { prisma?: PrismaClient }).prisma = client;
  return client;
}

export async function resetTables(db: TestDb): Promise<void> {
  await db.pool.query(`TRUNCATE ${TABLES.join(", ")} CASCADE`);
}

export async function insertUser(db: TestDb, id: string): Promise<string> {
  await db.pool.query(
    "INSERT INTO app_user (id, name, email, updated_at) VALUES ($1, $1, $1 || '@example.com', now())",
    [id],
  );
  return id;
}

export async function insertVulnerability(
  db: TestDb,
  v: { id: string; severity?: string; cvss?: number | null; exploited?: boolean },
): Promise<void> {
  await db.pool.query(
    `INSERT INTO vulnerability (id, severity, cvss_score, exploited, summary, details_source, fetched_at)
     VALUES ($1, $2::severity, $3, $4, 'A test problem.', 'NVD', now())`,
    [v.id, v.severity ?? "HIGH", v.cvss ?? 7.5, v.exploited ?? false],
  );
}
