// The route handlers end to end: real Better Auth sessions, real Postgres.
// Checks the session gate, error bodies and that user B cannot touch user A's data.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { resetTables, useTestPrisma } from "@/test/db-client";
import { startTestDb, type TestDb } from "@/test/test-db";

let db: TestDb;
let prisma: PrismaClient;
let cookies: Record<string, string> = {};

const handlers = {} as Record<
  string,
  Record<string, (req: Request, ctx: never) => Promise<Response>>
>;

beforeAll(async () => {
  db = await startTestDb();
  prisma = useTestPrisma(db);
  Object.assign(process.env, {
    DATABASE_URL: db.url,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123",
    BETTER_AUTH_URL: "http://localhost:3000",
    ALLOW_SIGNUP: "true",
    MAX_SBOM_MB: "1",
  });
  const load = async (name: string, mod: Promise<unknown>) => {
    handlers[name] = (await mod) as (typeof handlers)[string];
  };
  await load("devices", import("./devices/route"));
  await load("device", import("./devices/[id]/route"));
  await load("scan", import("./devices/[id]/scan/route"));
  await load("components", import("./devices/[id]/components/route"));
  await load("sbom", import("./devices/[id]/sbom/route"));
  await load("products", import("./products/route"));
  await load("vulns", import("./vulnerabilities/route"));
  await load("vuln", import("./vulnerabilities/[cveId]/route"));
  await load("finding", import("./findings/[id]/route"));
  await load("job", import("./jobs/[id]/route"));
  await load("checks", import("./checks/route"));
  await load("run", import("./checks/run/route"));
  await load("devjobs", import("./dev/jobs/route"));
  await load("health", import("./health/route"));
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

beforeEach(async () => {
  await resetTables(db);
  cookies = {};
  for (const name of ["alice", "bob"]) {
    const { getAuth } = await import("@/lib/auth");
    const api = getAuth().api;
    await api.signUpEmail({
      body: { email: `${name}@example.com`, password: "long-enough-password", name },
    });
    const signedIn = await api.signInEmail({
      body: { email: `${name}@example.com`, password: "long-enough-password" },
      returnHeaders: true,
    });
    cookies[name] = signedIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }
});

type Call = {
  as?: "alice" | "bob" | null;
  method?: string;
  body?: unknown;
  form?: FormData;
  query?: string;
  id?: string;
};

async function call(handler: string, method: string, opts: Call = {}) {
  const user = opts.as === undefined ? "alice" : opts.as;
  const headers = new Headers();
  if (user) headers.set("cookie", cookies[user] ?? "");
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers.set("content-type", "application/json");
  }
  const req = new Request(`http://localhost:3000/api/x${opts.query ?? ""}`, {
    method,
    headers,
    body,
  });
  const fn = handlers[handler]?.[method];
  if (!fn) throw new Error(`no ${method} on ${handler}`);
  const res = await fn(req, { params: Promise.resolve({ id: opts.id, cveId: opts.id }) } as never);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function makeDevice(as: "alice" | "bob" = "alice") {
  const res = await call("devices", "POST", {
    as,
    body: { type: "CONSOLE", name: "Box", product: { kind: "other", name: "" }, version: "1.0" },
  });
  expect(res.status).toBe(201);
  return res.body.device.id as string;
}

describe("the session gate", () => {
  const routes: [string, string, Call?][] = [
    ["devices", "GET"],
    ["devices", "POST", { body: {} }],
    ["device", "GET", { id: "x" }],
    ["device", "PATCH", { id: "x", body: { name: "n" } }],
    ["device", "DELETE", { id: "x" }],
    ["scan", "POST", { id: "x" }],
    ["components", "GET", { id: "x" }],
    ["sbom", "POST", { id: "x" }],
    ["products", "GET", { query: "?q=xbox" }],
    ["vulns", "GET"],
    ["vuln", "GET", { id: "CVE-1" }],
    ["finding", "PATCH", { id: "x", body: { state: "OPEN" } }],
    ["job", "GET", { id: "x" }],
    ["checks", "GET"],
    ["run", "POST"],
    ["devjobs", "POST"],
  ];

  it.each(routes)("%s %s answers 401 without a session", async (name, method, opts) => {
    const res = await call(name, method, { ...opts, as: null });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED", message: "Sign in to continue." } });
  });

  it("the health route needs no session", async () => {
    const res = await call("health", "GET", { as: null });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("devices", () => {
  it("creates, lists, reads, edits and deletes", async () => {
    const id = await makeDevice();
    expect((await call("devices", "GET")).body.devices).toHaveLength(1);
    expect((await call("device", "GET", { id })).body.device.name).toBe("Box");
    const edited = await call("device", "PATCH", { id, body: { version: "2.0" } });
    expect(edited.status).toBe(200);
    expect(edited.body.jobId).toEqual(expect.any(String));
    const gone = await call("device", "DELETE", { id });
    expect(gone.status).toBe(204);
    expect((await call("device", "GET", { id })).status).toBe(404);
  });

  it("answers 400 with field messages for a bad form", async () => {
    const res = await call("devices", "POST", {
      body: { type: "CONSOLE", name: " ", product: { kind: "other", name: "" }, version: null },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      fields: { name: "Give your device a name." },
    });
  });

  it("answers 400 for a catalog product that is not in the cache", async () => {
    const res = await call("devices", "POST", {
      body: {
        type: "TV",
        name: "TV",
        product: { kind: "catalog", cpe: "cpe:2.3:o:lg:webos" },
        version: "1",
      },
    });
    expect(res.status).toBe(400);
  });

  it("answers 400 for an empty edit", async () => {
    const id = await makeDevice();
    expect((await call("device", "PATCH", { id, body: {} })).status).toBe(400);
  });

  it("scan returns 202 and the same job twice", async () => {
    const id = await makeDevice();
    const first = await call("scan", "POST", { id });
    const second = await call("scan", "POST", { id });
    expect(first.status).toBe(202);
    expect(second.body.jobId).toBe(first.body.jobId);
  });

  it("never caches", async () => {
    expect((await call("devices", "GET")).headers.get("cache-control")).toBe("no-store");
  });
});

describe("another user", () => {
  it("gets 404, never 403 or the data, on every device route", async () => {
    const id = await makeDevice("alice");
    const attempts: [string, string, Call][] = [
      ["device", "GET", { as: "bob", id }],
      ["device", "PATCH", { as: "bob", id, body: { name: "stolen" } }],
      ["device", "DELETE", { as: "bob", id }],
      ["scan", "POST", { as: "bob", id }],
      ["components", "GET", { as: "bob", id }],
      ["sbom", "POST", { as: "bob", id }],
    ];
    for (const [name, method, opts] of attempts) {
      const res = await call(name, method, opts);
      expect(res.status, `${method} ${name}`).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }
    expect((await call("devices", "GET", { as: "bob" })).body.devices).toEqual([]);
    expect((await prisma.device.findUniqueOrThrow({ where: { id } })).name).toBe("Box");
  });

  it("cannot read or change a finding, a job or a vulnerability of the first user", async () => {
    const id = await makeDevice("alice");
    const component = await prisma.component.findFirstOrThrow({ where: { deviceId: id } });
    await db.pool.query(
      `INSERT INTO vulnerability (id, severity, summary, details_source, fetched_at) VALUES ('CVE-2024-9', 'HIGH', 's', 'NVD', now())`,
    );
    const { rows } = await db.pool.query(
      `INSERT INTO finding (device_id, component_id, vulnerability_id, source) VALUES ($1, $2, 'CVE-2024-9', 'NVD') RETURNING id`,
      [id, component.id],
    );
    const job = await prisma.job.findFirstOrThrow({ where: { deviceId: id } });

    expect(
      (
        await call("finding", "PATCH", {
          as: "bob",
          id: rows[0].id,
          body: { state: "IGNORED", reason: "x" },
        })
      ).status,
    ).toBe(404);
    expect((await call("vuln", "GET", { as: "bob", id: "CVE-2024-9" })).status).toBe(404);
    expect((await call("job", "GET", { as: "bob", id: job.id })).status).toBe(404);
    expect((await call("vulns", "GET", { as: "bob" })).body.findings).toEqual([]);
    expect((await call("vuln", "GET", { as: "alice", id: "CVE-2024-9" })).status).toBe(200);
    expect((await call("job", "GET", { as: "alice", id: job.id })).status).toBe(200);
  });
});

describe("findings", () => {
  it("ignore returns the finding and the recompute job", async () => {
    const id = await makeDevice();
    const component = await prisma.component.findFirstOrThrow({ where: { deviceId: id } });
    await db.pool.query(
      `INSERT INTO vulnerability (id, severity, summary, details_source, fetched_at) VALUES ('CVE-2024-9', 'HIGH', 's', 'NVD', now())`,
    );
    const { rows } = await db.pool.query(
      `INSERT INTO finding (device_id, component_id, vulnerability_id, source) VALUES ($1, $2, 'CVE-2024-9', 'NVD') RETURNING id`,
      [id, component.id],
    );
    const res = await call("finding", "PATCH", {
      id: rows[0].id,
      body: { state: "IGNORED", reason: "  " },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.reason).toBe("Add a short reason.");
    const ok = await call("finding", "PATCH", {
      id: rows[0].id,
      body: { state: "IGNORED", reason: "No internet access" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.finding.state).toBe("IGNORED");
    expect(ok.body.jobId).toEqual(expect.any(String));
  });
});

describe("products", () => {
  it("rejects a short search with the user-facing message", async () => {
    const res = await call("products", "GET", { query: "?q=x" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("Type at least 2 letters.");
  });

  it("normalises the search text", async () => {
    const res = await call("products", "GET", { query: "?q=%20%20Xbox%20%20ONE%20" });
    expect(res.body).toEqual({ query: "xbox one", status: "PENDING", products: [] });
  });
});

describe("SBOM upload", () => {
  const file = (content: BlobPart, name = "sbom.json") => {
    const form = new FormData();
    form.set("file", new File([content], name, { type: "application/json" }));
    return form;
  };

  it("accepts a CycloneDX file with 202", async () => {
    const id = await makeDevice();
    const res = await call("sbom", "POST", {
      id,
      form: file('{"bomFormat":"CycloneDX","components":[]}'),
    });
    expect(res.status).toBe(202);
    expect(res.body.device.sbom.format).toBe("CYCLONEDX");
    expect(res.body.jobId).toEqual(expect.any(String));
  });

  it("answers 415 with the agreed text for a file that is not an SBOM", async () => {
    const id = await makeDevice();
    const res = await call("sbom", "POST", { id, form: file("just text") });
    expect(res.status).toBe(415);
    expect(res.body.error.message).toBe(
      "This isn't a CycloneDX or SPDX file. Export it as JSON and try again.",
    );
  });

  it("answers 413 with the limit for a file over MAX_SBOM_MB", async () => {
    const id = await makeDevice();
    const res = await call("sbom", "POST", { id, form: file(new Uint8Array(1024 * 1024 + 1)) });
    expect(res.status).toBe(413);
    expect(res.body.error.message).toBe("This file is larger than 1 MB.");
    expect(await prisma.sbom.count()).toBe(0);
  });

  it("answers 400 when no file is sent", async () => {
    const id = await makeDevice();
    expect((await call("sbom", "POST", { id, form: new FormData() })).status).toBe(400);
  });
});

describe("dev jobs", () => {
  it("queues a DEV_NOOP outside production and hides itself in production", async () => {
    const res = await call("devjobs", "POST");
    expect(res.status).toBe(202);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: res.body.jobId } })).type).toBe(
      "DEV_NOOP",
    );

    const { getEnv } = await import("@/lib/env");
    const env = getEnv();
    const before = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      expect((await call("devjobs", "POST")).status).toBe(404);
    } finally {
      env.NODE_ENV = before;
    }
  });
});

describe("checks", () => {
  it("run returns 202 and the status shows the active rescan", async () => {
    const run = await call("run", "POST");
    expect(run.status).toBe(202);
    const status = await call("checks", "GET");
    expect(status.body.activeRescanJobId).toBe(run.body.jobId);
  });
});
