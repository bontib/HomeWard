// Database for *.db.test.ts files. Uses TEST_DATABASE_URL when set (CI), otherwise starts a
// throwaway embedded Postgres on a free port (ADR 0006). The migrations in prisma/migrations
// are applied by running their SQL files in order.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const migrationsDir = path.resolve(import.meta.dirname, "../../prisma/migrations");

export type TestDb = {
  pool: pg.Pool;
  url: string;
  stop: () => Promise<void>;
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function applyMigrations(pool: pg.Pool): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  const folders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const folder of folders) {
    await pool.query(readFileSync(path.join(migrationsDir, folder, "migration.sql"), "utf8"));
  }
}

export async function startTestDb(): Promise<TestDb> {
  const externalUrl = process.env.TEST_DATABASE_URL;
  let url = externalUrl;
  let embedded: EmbeddedPostgres | undefined;
  let dataDir: string | undefined;

  if (url && !/\/[^/?]*test[^/?]*(\?|$)/.test(url)) {
    // applyMigrations drops the public schema, so only a database named like "*test*" is allowed.
    throw new Error('TEST_DATABASE_URL must point at a database whose name contains "test".');
  }

  if (!url) {
    const port = await freePort();
    dataDir = mkdtempSync(path.join(os.tmpdir(), "homeguard-testdb-"));
    embedded = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "test",
      password: "test",
      port,
      persistent: false,
      onLog: () => {},
      onError: () => {},
    });
    await embedded.initialise();
    await embedded.start();
    await embedded.createDatabase("test");
    url = `postgresql://test:test@127.0.0.1:${port}/test`;
  }

  const pool = new pg.Pool({ connectionString: url, max: 4 });
  // Stopping the server can drop idle clients; that is expected at teardown.
  pool.on("error", () => {});
  await applyMigrations(pool);

  return {
    pool,
    url,
    stop: async () => {
      await pool.end();
      await embedded?.stop();
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
