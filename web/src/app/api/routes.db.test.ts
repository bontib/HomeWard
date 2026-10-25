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
  await load("notifications", import("./notifications/route"));
  await load("nemail", import("./notifications/email/route"));
  await load("ntest", import("./notifications/test/route"));
  await load("nlink", import("./notifications/link/route"));
  await load("nconfirm", import("./notifications/confirm/route"));
  await load("nunsub", import("./notifications/unsubscribe/route"));
  await load("noneclick", import("./notifications/unsubscribe/one-click/route"));
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
  headers?: Record<string, string>;
  /** A body that is not JSON, with its own content type. */
  raw?: { body: string; type: string };
};

async function call(handler: string, method: string, opts: Call = {}) {
  const user = opts.as === undefined ? "alice" : opts.as;
  const headers = new Headers();
  if (user) headers.set("cookie", cookies[user] ?? "");
  let body: BodyInit | undefined;
  for (const [name, value] of Object.entries(opts.headers ?? {})) headers.set(name, value);
  if (opts.raw) {
    body = opts.raw.body;
    headers.set("content-type", opts.raw.type);
  } else if (opts.form) body = opts.form;
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
    ["notifications", "GET"],
    ["nemail", "PUT", { body: { enabled: true } }],
    ["ntest", "POST", { body: {} }],
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

describe("notification routes", () => {
  const origin = { origin: "http://localhost:3000" };

  async function turnOnFor(name: "alice" | "bob") {
    await prisma.workerStatus.upsert({
      where: { id: 1 },
      create: {
        startedAt: new Date(),
        heartbeatAt: new Date(),
        version: "test",
        rescanCron: "0 3 * * *",
        nvdApiKeySet: false,
        smtpConfigured: true,
      },
      update: { smtpConfigured: true },
    });
    const put = await call("nemail", "PUT", { as: name, body: { enabled: true } });
    expect(put.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `${name}@example.com` } });
    const row = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, kind: "CONFIRM" },
    });
    return { token: row.linkToken as string, userId: user.id, put };
  }

  it("GET /api/notifications returns only the signed-in person's settings", async () => {
    const res = await call("notifications", "GET", { as: "bob" });
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({
      state: "OFF",
      email: "bob@example.com",
      smtpConfigured: false,
    });
  });

  it("PUT answers 409 with the not-set-up text when the worker has no smtp", async () => {
    const res = await call("nemail", "PUT", { body: { enabled: true } });
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: "CONFLICT",
      message: "Email alerts aren't set up on this HomeGuard yet.",
    });
  });

  it("PUT checks the body, the content type and the Origin", async () => {
    expect((await call("nemail", "PUT", { body: { enabled: "yes" } })).status).toBe(400);
    expect((await call("nemail", "PUT", { body: { enabled: true, extra: 1 } })).status).toBe(400);
    const notJson = await call("nemail", "PUT", {
      raw: { body: "enabled=true", type: "text/plain" },
    });
    expect(notJson.status).toBe(400);
    const crossSite = await call("nemail", "PUT", {
      body: { enabled: true },
      headers: { origin: "https://evil.example" },
    });
    expect(crossSite.status).toBe(403);
    expect(crossSite.body.error.code).toBe("FORBIDDEN");
  });

  it("PUT turns alerts on for the caller only, and the test route answers 409 until they are on", async () => {
    const { put } = await turnOnFor("alice");
    expect(put.body.settings.state).toBe("PENDING_CONFIRM");
    expect(typeof put.body.jobId).toBe("string");
    expect((await call("notifications", "GET", { as: "bob" })).body.settings.state).toBe("OFF");

    const early = await call("ntest", "POST", { body: {} });
    expect(early.status).toBe(409);
    expect(early.body.error.message).toBe("Turn on email alerts first.");
  });

  it("the confirm link works end to end and a second use is harmless", async () => {
    const { token } = await turnOnFor("alice");
    const view = await call("nlink", "GET", {
      as: null,
      query: `?purpose=confirm&token=${token}`,
    });
    expect(view.status).toBe(200);
    expect(view.body.link).toEqual({
      purpose: "confirm",
      maskedEmail: "a***@example.com",
      alreadyDone: false,
    });
    expect((await call("notifications", "GET")).body.settings.state).toBe("PENDING_CONFIRM");

    const first = await call("nconfirm", "POST", { as: null, body: { token }, headers: origin });
    expect(first).toMatchObject({ status: 200, body: { state: "ON" } });
    const second = await call("nconfirm", "POST", { as: null, body: { token }, headers: origin });
    expect(second).toMatchObject({ status: 200, body: { state: "ON" } });

    const test = await call("ntest", "POST", { body: {} });
    expect(test.status).toBe(202);
    const again = await call("ntest", "POST", { body: {} });
    expect(again.status).toBe(429);
  });

  it("the confirm and unsubscribe routes only change state on POST", async () => {
    const { token } = await turnOnFor("alice");
    expect(handlers.nconfirm?.GET).toBeUndefined();
    expect(handlers.nunsub?.GET).toBeUndefined();
    expect(handlers.noneclick?.GET).toBeUndefined();
    await call("nlink", "GET", { as: null, query: `?purpose=confirm&token=${token}` });
    expect((await call("notifications", "GET")).body.settings.state).toBe("PENDING_CONFIRM");
  });

  it("a confirm token for alice cannot be used to turn on bob, even with bob's cookie", async () => {
    const alice = await turnOnFor("alice");
    await turnOnFor("bob");
    const res = await call("nconfirm", "POST", {
      as: "bob",
      body: { token: alice.token },
      headers: origin,
    });
    expect(res.status).toBe(200);
    expect((await call("notifications", "GET", { as: "alice" })).body.settings.state).toBe("ON");
    expect((await call("notifications", "GET", { as: "bob" })).body.settings.state).toBe(
      "PENDING_CONFIRM",
    );
  });

  it("bad tokens all get the same 400 INVALID_LINK answer", async () => {
    const { token } = await turnOnFor("alice");
    const flipped = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    for (const bad of [flipped, "short", "has spaces in it and is long enough", 5]) {
      const res = await call("nconfirm", "POST", {
        as: null,
        body: { token: bad },
        headers: origin,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: "INVALID_LINK",
        message: "This link has expired. Turn on alerts again in Settings > Notifications.",
      });
    }
    const unsub = await call("nunsub", "POST", {
      as: null,
      body: { token: flipped },
      headers: origin,
    });
    expect(unsub.status).toBe(400);
    expect(unsub.body.error.code).toBe("INVALID_LINK");
    const link = await call("nlink", "GET", {
      as: null,
      query: `?purpose=unsubscribe&token=${flipped}`,
    });
    expect(link.status).toBe(400);
    expect(link.body.error.code).toBe("INVALID_LINK");
  });

  it("the token routes refuse a cross-site browser request", async () => {
    const { token } = await turnOnFor("alice");
    const res = await call("nconfirm", "POST", {
      as: null,
      body: { token },
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    expect((await call("notifications", "GET")).body.settings.state).toBe("PENDING_CONFIRM");
  });

  describe("one-click unsubscribe (RFC 8058)", () => {
    const form = "application/x-www-form-urlencoded";

    async function alertsOnWithUnsubscribeToken() {
      const { token, userId } = await turnOnFor("alice");
      await call("nconfirm", "POST", { as: null, body: { token }, headers: origin });
      const pref = await prisma.notificationPref.findUniqueOrThrow({ where: { userId } });
      return pref.unsubscribeToken;
    }

    it("turns alerts off from a form post with no cookie and no Origin check", async () => {
      const token = await alertsOnWithUnsubscribeToken();
      const res = await call("noneclick", "POST", {
        as: null,
        query: `?token=${token}`,
        raw: { body: "List-Unsubscribe=One-Click", type: form },
        headers: { origin: "https://mail-provider.example" },
      });
      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
      expect((await call("notifications", "GET")).body.settings.state).toBe("OFF");
    });

    it("accepts only the form body and nothing else", async () => {
      const token = await alertsOnWithUnsubscribeToken();
      const query = `?token=${token}`;
      const json = await call("noneclick", "POST", { as: null, query, body: { token } });
      expect(json.status).toBe(415);
      const wrong = await call("noneclick", "POST", {
        as: null,
        query,
        raw: { body: "List-Unsubscribe=Nope", type: form },
      });
      expect(wrong.status).toBe(400);
      const big = await call("noneclick", "POST", {
        as: null,
        query,
        raw: { body: "List-Unsubscribe=One-Click&" + "a=b&".repeat(400), type: form },
      });
      expect(big.status).toBe(413);
      expect((await call("notifications", "GET")).body.settings.state).toBe("ON");
    });

    it("refuses a bad token, and a confirm token, with INVALID_LINK", async () => {
      const { token: confirm } = await turnOnFor("bob");
      for (const token of ["short", confirm]) {
        const res = await call("noneclick", "POST", {
          as: null,
          query: `?token=${token}`,
          raw: { body: "List-Unsubscribe=One-Click", type: form },
        });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_LINK");
      }
      const missing = await call("noneclick", "POST", {
        as: null,
        raw: { body: "List-Unsubscribe=One-Click", type: form },
      });
      expect(missing.status).toBe(400);
    });

    it("only changes the person the token belongs to", async () => {
      const token = await alertsOnWithUnsubscribeToken();
      const { token: bobToken } = await turnOnFor("bob");
      await call("nconfirm", "POST", { as: null, body: { token: bobToken }, headers: origin });
      await call("noneclick", "POST", {
        as: null,
        query: `?token=${token}`,
        raw: { body: "List-Unsubscribe=One-Click", type: form },
      });
      expect((await call("notifications", "GET", { as: "bob" })).body.settings.state).toBe("ON");
    });
  });
});
