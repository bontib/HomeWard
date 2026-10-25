// Starts the whole stack without Docker: embedded Postgres, a mock NVD/KEV server, the
// built Next.js app and the real Rust worker with fake Trivy. Returns the teardown.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { BASE_URL, DATABASE_URL, PORTS } from "./support/stack";

const webDir = path.resolve(__dirname, "..");
const NEXT_BIN = path.join(webDir, "node_modules/next/dist/bin/next");
const workerDir = path.resolve(webDir, "../worker");

function withProcessEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return Object.assign({}, process.env, extra);
}

async function waitFor(url: string, what: string, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} did not become ready at ${url}`);
}

function start(
  name: string,
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  logDir: string,
) {
  const log = path.join(logDir, `${name}.log`);
  writeFileSync(log, "");
  const child = spawn(cmd, args, {
    cwd,
    env: withProcessEnv(env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const append = (chunk: Buffer) => writeFileSync(log, chunk, { flag: "a" });
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return child;
}

export default async function globalSetup() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "homeward-e2e-"));
  const logDir = path.join(webDir, "test-results", "stack-logs");
  mkdirSync(logDir, { recursive: true });
  const children: ChildProcess[] = [];

  const pg = new EmbeddedPostgres({
    databaseDir: path.join(tmp, "pg"),
    user: "homeward",
    password: "homeward",
    port: PORTS.db,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("homeward_e2e");

  const teardown = async () => {
    for (const child of children) child.kill("SIGTERM");
    await pg.stop().catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
  };

  try {
    const dbEnv = { DATABASE_URL };
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: webDir,
      env: withProcessEnv(dbEnv),
      stdio: "pipe",
    });

    const nvd = start(
      "mock-nvd",
      "node",
      [path.join(__dirname, "support/mock-nvd.mjs")],
      webDir,
      { MOCK_NVD_PORT: String(PORTS.nvd) },
      logDir,
    );
    children.push(nvd);

    const webEnv = {
      ...dbEnv,
      BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-0123",
      BETTER_AUTH_URL: BASE_URL,
      ALLOW_SIGNUP: "true",
      // Each test sends its own X-Forwarded-For, so the sign-in rate limit is per test.
      TRUSTED_PROXY: "true",
      NODE_ENV: "production",
    };
    if (!["1", "true"].includes(process.env.E2E_SKIP_BUILD ?? "")) {
      execFileSync("npx", ["next", "build"], {
        cwd: webDir,
        env: withProcessEnv(webEnv),
        stdio: "pipe",
      });
    }
    children.push(
      start(
        "web",
        process.execPath,
        [NEXT_BIN, "start", "-p", String(PORTS.web), "-H", "127.0.0.1"],
        webDir,
        webEnv,
        logDir,
      ),
    );

    execFileSync("cargo", ["build"], { cwd: workerDir, stdio: "pipe" });
    const fakeTrivy = path.join(workerDir, "tests/fixtures/fake-trivy.sh");
    children.push(
      start(
        "worker",
        path.join(workerDir, "target/debug/worker"),
        [],
        workerDir,
        {
          ...dbEnv,
          NVD_BASE_URL: `http://127.0.0.1:${PORTS.nvd}`,
          KEV_URL: `http://127.0.0.1:${PORTS.nvd}/kev`,
          TRIVY_PATH: fakeTrivy,
          TRIVY_CACHE_DIR: path.join(tmp, "trivy-cache"),
          RUST_LOG: "info",
        },
        logDir,
      ),
    );

    await waitFor(`${BASE_URL}/api/health`, "web");
    return teardown;
  } catch (err) {
    await teardown();
    throw err;
  }
}
