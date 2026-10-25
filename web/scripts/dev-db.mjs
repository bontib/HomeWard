// Starts a real Postgres 17 (npm package embedded-postgres) for local work without Docker.
// Data lives in web/.devdb/. Stop with Ctrl+C. See docs/adr/0006.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../.devdb");
const port = Number(process.env.DEV_DB_PORT ?? 54329);
const user = "homeward";
const password = "homeward";
const database = "homeward";

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
  onLog: () => {},
  onError: (e) => console.error(e),
});

if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase(database);
} catch {
  // The database already exists from an earlier run.
}

console.log(
  `Postgres is ready.\nDATABASE_URL=postgresql://${user}:${password}@127.0.0.1:${port}/${database}`,
);

async function shutdown() {
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
