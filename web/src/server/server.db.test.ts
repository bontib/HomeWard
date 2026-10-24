// Product search, findings, vulnerabilities, checks, SBOM upload and the job helpers,
// against a real Postgres. Another user must never see or change any of it.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  CreateDeviceSchema,
  UpdateFindingSchema,
  VulnerabilityListQuerySchema,
} from "@/lib/contracts";
import { enqueueCheck, enqueueRecompute, enqueueRescan } from "@/lib/jobs";
import { insertUser, insertVulnerability, resetTables, useTestPrisma } from "@/test/db-client";
import { startTestDb, type TestDb } from "@/test/test-db";
import { getChecksStatus, runChecks } from "./checks";
import { listComponents } from "./components";
import { createDevice, getDeviceDetail, MAX_DEVICES_PER_USER } from "./devices";
import { updateFinding } from "./findings";
import { searchProducts } from "./products";
import { saveSbom } from "./sboms";
import { getVulnerabilityDetail, listVulnerabilities } from "./vulnerabilities";

let db: TestDb;
let prisma: PrismaClient;

beforeAll(async () => {
  db = await startTestDb();
  prisma = useTestPrisma(db);
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

beforeEach(async () => {
  await resetTables(db);
  await insertUser(db, "alice");
  await insertUser(db, "bob");
});

async function newDevice(userId: string, name = "Box") {
  const input = CreateDeviceSchema.parse({
    type: "CONSOLE",
    name,
    product: { kind: "other", name: "" },
    version: "1.0",
  });
  return (await createDevice(userId, input)).device;
}

async function addFinding(
  deviceId: string,
  cve: string,
  opts: { cvss?: number; exploited?: boolean } = {},
) {
  const component = await prisma.component.findFirstOrThrow({ where: { deviceId } });
  await insertVulnerability(db, { id: cve, cvss: opts.cvss ?? 7.5, exploited: opts.exploited });
  const { rows } = await db.pool.query(
    `INSERT INTO finding (device_id, component_id, vulnerability_id, source, fixed_version)
     VALUES ($1, $2, $3, 'NVD', '2.0') RETURNING id`,
    [deviceId, component.id, cve],
  );
  return rows[0].id as string;
}

const notFound = { code: "NOT_FOUND", status: 404 };

describe("searchProducts", () => {
  it("queues one job for a new search and answers PENDING", async () => {
    const result = await searchProducts("alice", "xbox");
    expect(result).toEqual({ query: "xbox", status: "PENDING", products: [] });
    const jobs = await prisma.job.findMany();
    expect(jobs).toMatchObject([
      { type: "SEARCH_PRODUCTS", payload: { query: "xbox" }, maxAttempts: 1 },
    ]);
    const row = await prisma.productSearch.findUniqueOrThrow({ where: { query: "xbox" } });
    expect(row.jobId).toBe(jobs[0]?.id);
  });

  it("does not queue twice while the search is fresh and pending", async () => {
    await searchProducts("alice", "xbox");
    await searchProducts("alice", "xbox");
    expect(await prisma.job.count()).toBe(1);
  });

  it("answers READY from the cache without a job", async () => {
    await db.pool.query(
      `INSERT INTO cpe_product (cpe, part, vendor, product, title, latest_version, fetched_at)
       VALUES ('cpe:2.3:o:a:one', 'o', 'a', 'one', 'One', '2.0', now()), ('cpe:2.3:o:a:two', 'o', 'a', 'two', 'Two', NULL, now())`,
    );
    await db.pool.query(
      `INSERT INTO product_search (query, status, cpes, fetched_at)
       VALUES ('one', 'READY', ARRAY['cpe:2.3:o:a:two', 'cpe:2.3:o:a:one'], now())`,
    );
    const result = await searchProducts("alice", "one");
    expect(result.status).toBe("READY");
    expect(result.products.map((p) => p.title)).toEqual(["Two", "One"]);
    expect(await prisma.job.count()).toBe(0);
  });

  it.each([
    ["a ready search older than 30 days", "READY", "fetched_at = now() - interval '31 days'", 1],
    [
      "a failed search older than a minute",
      "FAILED",
      "requested_at = now() - interval '2 minutes'",
      1,
    ],
    [
      "a pending search stuck for 3 minutes",
      "PENDING",
      "requested_at = now() - interval '3 minutes'",
      1,
    ],
    ["a failed search from a few seconds ago", "FAILED", "requested_at = now()", 0],
    ["a ready search from yesterday", "READY", "fetched_at = now() - interval '1 day'", 0],
  ])("refreshes %s: %i job(s)", async (_label, status, set, jobs) => {
    await db.pool.query(
      `INSERT INTO product_search (query, status, fetched_at, requested_at) VALUES ('xbox', '${status}', now(), now())`,
    );
    await db.pool.query(`UPDATE product_search SET ${set}`);
    await searchProducts("alice", "xbox");
    expect(await prisma.job.count()).toBe(jobs);
  });

  it("refuses with 429 when ten searches are already waiting and leaves no trace", async () => {
    for (let i = 0; i < 10; i++) {
      await db.pool.query(
        "INSERT INTO job (type, payload, max_attempts) VALUES ('SEARCH_PRODUCTS', $1, 1)",
        [JSON.stringify({ query: `word${i}` })],
      );
    }
    await expect(searchProducts("alice", "another")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });
    expect(await prisma.productSearch.count()).toBe(0);
  });
});

describe("searchProducts per-user limit", () => {
  it("refuses a fourth waiting search from one user but not from another", async () => {
    for (const q of ["aa", "bb", "cc"]) await searchProducts("alice", q);
    await expect(searchProducts("alice", "dd")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(searchProducts("bob", "dd")).resolves.toMatchObject({ status: "PENDING" });
  });
});

describe("device limit", () => {
  it("refuses a device over the per-user cap", async () => {
    await db.pool.query(
      `INSERT INTO device (user_id, name, type, updated_at) SELECT 'alice', 'd' || g, 'OTHER', now() FROM generate_series(1, ${MAX_DEVICES_PER_USER}) g`,
    );
    await expect(newDevice("alice")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(newDevice("bob")).resolves.toBeDefined();
  });
});

describe("enqueue helpers", () => {
  it("enqueueCheck sets CHECKING and reuses the waiting job", async () => {
    const device = await newDevice("alice");
    const again = await prisma.$transaction((tx) => enqueueCheck(tx, "alice", device.id));
    expect(again).toBe(device.check.jobId);
    expect(await prisma.job.count()).toBe(1);
  });

  it("enqueueCheck starts a new job when the old one is running", async () => {
    const device = await newDevice("alice");
    await db.pool.query("UPDATE job SET status = 'RUNNING'");
    const next = await prisma.$transaction((tx) => enqueueCheck(tx, "alice", device.id));
    expect(next).not.toBe(device.check.jobId);
    const row = await prisma.device.findUniqueOrThrow({ where: { id: device.id } });
    expect(row.checkJobId).toBe(next);
  });

  it("enqueueCheck for someone else's device throws and queues nothing", async () => {
    const device = await newDevice("alice");
    await expect(prisma.$transaction((tx) => enqueueCheck(tx, "bob", device.id))).rejects.toThrow();
    expect(await prisma.job.count()).toBe(1);
  });

  it("the data and the job are saved together or not at all", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.device.create({ data: { userId: "alice", name: "Half", type: "TV" } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await prisma.device.count()).toBe(0);
    expect(await prisma.job.count()).toBe(0);
  });

  it("enqueueRescan reuses an active rescan and keeps users apart", async () => {
    const first = await prisma.$transaction((tx) => enqueueRescan(tx, "alice"));
    expect(await prisma.$transaction((tx) => enqueueRescan(tx, "alice"))).toBe(first);
    expect(await prisma.$transaction((tx) => enqueueRescan(tx, "bob"))).not.toBe(first);
  });

  it("enqueueRecompute reuses a queued recompute for the same device", async () => {
    const device = await newDevice("alice");
    const first = await prisma.$transaction((tx) => enqueueRecompute(tx, "alice", device.id));
    expect(await prisma.$transaction((tx) => enqueueRecompute(tx, "alice", device.id))).toBe(first);
  });
});

describe("updateFinding", () => {
  it("ignores with a reason and queues a status recompute", async () => {
    const device = await newDevice("alice");
    const findingId = await addFinding(device.id, "CVE-2024-0001");
    const result = await updateFinding(
      "alice",
      findingId,
      UpdateFindingSchema.parse({ state: "IGNORED", reason: "Not reachable" }),
    );
    expect(result.finding).toMatchObject({ state: "IGNORED", ignoredReason: "Not reachable" });
    const job = await prisma.job.findUniqueOrThrow({ where: { id: result.jobId } });
    expect(job).toMatchObject({ type: "RECOMPUTE_STATUS", deviceId: device.id, userId: "alice" });
  });

  it("reopens and clears the reason", async () => {
    const device = await newDevice("alice");
    const findingId = await addFinding(device.id, "CVE-2024-0001");
    await updateFinding(
      "alice",
      findingId,
      UpdateFindingSchema.parse({ state: "IGNORED", reason: "x" }),
    );
    const result = await updateFinding(
      "alice",
      findingId,
      UpdateFindingSchema.parse({ state: "OPEN" }),
    );
    expect(result.finding).toMatchObject({ state: "OPEN", ignoredReason: null });
  });

  it("is not found for another user's finding and changes nothing", async () => {
    const device = await newDevice("alice");
    const findingId = await addFinding(device.id, "CVE-2024-0001");
    await expect(
      updateFinding("bob", findingId, UpdateFindingSchema.parse({ state: "IGNORED", reason: "x" })),
    ).rejects.toMatchObject(notFound);
    expect((await prisma.finding.findUniqueOrThrow({ where: { id: findingId } })).state).toBe(
      "OPEN",
    );
    expect(await prisma.job.count({ where: { type: "RECOMPUTE_STATUS" } })).toBe(0);
  });
});

describe("vulnerabilities", () => {
  const all = VulnerabilityListQuerySchema.parse({});

  it("lists my open findings worst first, with the device", async () => {
    const device = await newDevice("alice");
    await addFinding(device.id, "CVE-2024-0001", { cvss: 5 });
    await addFinding(device.id, "CVE-2024-0002", { cvss: 9.5 });
    const { findings } = await listVulnerabilities("alice", all);
    expect(findings.map((f) => f.vulnerability.id)).toEqual(["CVE-2024-0002", "CVE-2024-0001"]);
    expect(findings[0]?.device).toMatchObject({ id: device.id, name: "Box" });
  });

  it("filters by level, device and state", async () => {
    const one = await newDevice("alice", "One");
    const two = await newDevice("alice", "Two");
    await addFinding(one.id, "CVE-2024-0001", { cvss: 9.5 });
    const ignored = await addFinding(two.id, "CVE-2024-0002", { cvss: 5 });
    await updateFinding(
      "alice",
      ignored,
      UpdateFindingSchema.parse({ state: "IGNORED", reason: "x" }),
    );
    const level = await listVulnerabilities(
      "alice",
      VulnerabilityListQuerySchema.parse({ level: "critical" }),
    );
    expect(level.findings).toHaveLength(1);
    const onTwo = await listVulnerabilities(
      "alice",
      VulnerabilityListQuerySchema.parse({ deviceId: two.id }),
    );
    expect(onTwo.findings).toHaveLength(0);
    const ignoredList = await listVulnerabilities(
      "alice",
      VulnerabilityListQuerySchema.parse({ state: "IGNORED" }),
    );
    expect(ignoredList.findings.map((f) => f.vulnerability.id)).toEqual(["CVE-2024-0002"]);
  });

  it("counts devices that are not fully checked", async () => {
    const device = await newDevice("alice");
    await db.pool.query("UPDATE device SET unchecked_count = 2 WHERE id = $1", [device.id]);
    expect((await listVulnerabilities("alice", all)).notFullyCheckedDeviceCount).toBe(1);
    expect((await listVulnerabilities("bob", all)).notFullyCheckedDeviceCount).toBe(0);
  });

  it("never lists another user's findings, even when asked by device id", async () => {
    const device = await newDevice("alice");
    await addFinding(device.id, "CVE-2024-0001");
    expect((await listVulnerabilities("bob", all)).findings).toEqual([]);
    const byDevice = VulnerabilityListQuerySchema.parse({ deviceId: device.id });
    expect((await listVulnerabilities("bob", byDevice)).findings).toEqual([]);
  });

  it("shows the detail with only my devices", async () => {
    const mine = await newDevice("alice", "Mine");
    const theirs = await newDevice("bob", "Theirs");
    await addFinding(mine.id, "CVE-2024-0001");
    await db.pool.query(
      `INSERT INTO finding (device_id, component_id, vulnerability_id, source)
       SELECT $1, id, 'CVE-2024-0001', 'NVD' FROM component WHERE device_id = $1`,
      [theirs.id],
    );
    const detail = await getVulnerabilityDetail("alice", "CVE-2024-0001");
    expect(detail.affected.map((a) => a.device.name)).toEqual(["Mine"]);
    expect(detail.vulnerability).toMatchObject({
      id: "CVE-2024-0001",
      nvdUrl: "https://nvd.nist.gov/vuln/detail/CVE-2024-0001",
      references: [],
    });
  });

  it("is not found when none of my devices has it", async () => {
    const theirs = await newDevice("bob");
    await addFinding(theirs.id, "CVE-2024-0001");
    await expect(getVulnerabilityDetail("alice", "CVE-2024-0001")).rejects.toMatchObject(notFound);
    await expect(getVulnerabilityDetail("alice", "CVE-1999-0000")).rejects.toMatchObject(notFound);
  });
});

describe("listComponents", () => {
  it("is not found for another user's device", async () => {
    const device = await newDevice("alice");
    await expect(listComponents("bob", device.id)).rejects.toMatchObject(notFound);
  });

  it("puts components with findings first, then unchecked ones", async () => {
    const device = await newDevice("alice");
    await db.pool.query(
      `INSERT INTO component (device_id, source, name, version, "check")
       VALUES ($1, 'SBOM', 'zlib', '1', 'CHECKED'), ($1, 'SBOM', 'aaa-unchecked', '1', 'UNSUPPORTED')`,
      [device.id],
    );
    await addFinding(device.id, "CVE-2024-0001", { cvss: 9.9 });
    const list = await listComponents("alice", device.id);
    expect(list.map((c) => c.name)).toEqual(["Box", "aaa-unchecked", "zlib"]);
    expect(list[0]).toMatchObject({ openFindingCount: 1, worstLevel: "critical" });
    expect(list[2]?.worstLevel).toBeNull();
  });
});

describe("saveSbom", () => {
  const cyclonedx = new TextEncoder().encode('{"bomFormat":"CycloneDX","components":[]}');
  const upload = (name = "a.json") => ({
    fileName: name,
    bytes: new Uint8Array(cyclonedx),
    maxMb: 20,
  });

  it("stores the file and queues one check", async () => {
    const device = await newDevice("alice");
    const result = await saveSbom("alice", device.id, upload("../x/sbom.json"));
    expect(result.jobId).toBe(device.check.jobId);
    expect(result.device.sbom).toMatchObject({
      fileName: "sbom.json",
      format: "CYCLONEDX",
      parsedAt: null,
    });
    const row = await prisma.sbom.findFirstOrThrow({ where: { deviceId: device.id } });
    expect(row.sha256).toHaveLength(64);
    expect(row.content.byteLength).toBe(cyclonedx.byteLength);
  });

  it("a second upload replaces the first and asks for a new parse", async () => {
    const device = await newDevice("alice");
    await saveSbom("alice", device.id, upload("first.json"));
    await db.pool.query("UPDATE sbom SET parsed_at = now()");
    await saveSbom("alice", device.id, upload("second.json"));
    expect(await prisma.sbom.count()).toBe(1);
    const row = await prisma.sbom.findFirstOrThrow({});
    expect(row).toMatchObject({ fileName: "second.json", parsedAt: null });
  });

  it("is not found for another user's device and stores nothing", async () => {
    const device = await newDevice("alice");
    await expect(saveSbom("bob", device.id, upload())).rejects.toMatchObject(notFound);
    expect(await prisma.sbom.count()).toBe(0);
  });

  it("refuses a file that is not an SBOM before touching the database", async () => {
    const device = await newDevice("alice");
    const bad = { fileName: "a.json", bytes: new TextEncoder().encode('{"x":1}'), maxMb: 20 };
    await expect(saveSbom("alice", device.id, bad)).rejects.toMatchObject({
      code: "UNSUPPORTED_FILE",
    });
    expect(await prisma.sbom.count()).toBe(0);
  });
});

describe("checks", () => {
  it("reports a worker that has not been seen as off", async () => {
    const status = await getChecksStatus("alice");
    expect(status.scanner).toMatchObject({
      on: false,
      lastCheckAt: null,
      rescanCron: null,
      nvdApiKeySet: false,
    });
    expect(status.sources.NVD).toEqual({
      lastSuccessAt: null,
      dataUpdatedAt: null,
      lastErrorCode: null,
    });
  });

  it("reports the worker, the sources and the checking devices", async () => {
    await db.pool.query(
      `INSERT INTO worker_status (id, started_at, heartbeat_at, version, rescan_cron, next_rescan_at, nvd_api_key_set)
       VALUES (1, now(), now(), '0.1.0', '0 3 * * *', now() + interval '3 hours', true)`,
    );
    await db.pool.query(
      "INSERT INTO data_source (id, last_success_at, last_error_code) VALUES ('KEV', now(), NULL), ('NVD', NULL, 'NVD_UNAVAILABLE')",
    );
    await newDevice("alice");
    await newDevice("bob");
    const status = await getChecksStatus("alice");
    expect(status.scanner).toMatchObject({ on: true, rescanCron: "0 3 * * *", nvdApiKeySet: true });
    expect(status.scanner.nextCheckAt).not.toBeNull();
    expect(status.sources.KEV.lastSuccessAt).not.toBeNull();
    expect(status.sources.NVD.lastErrorCode).toBe("NVD_UNAVAILABLE");
    expect(status.checkingDeviceCount).toBe(1);
  });

  it("a worker whose last heartbeat is old is off", async () => {
    await db.pool.query(
      `INSERT INTO worker_status (id, started_at, heartbeat_at, version, rescan_cron, nvd_api_key_set)
       VALUES (1, now(), now() - interval '5 minutes', '0.1.0', '0 3 * * *', false)`,
    );
    expect((await getChecksStatus("alice")).scanner.on).toBe(false);
  });

  it("lists only my recent checks, and the scheduled rescan", async () => {
    await newDevice("alice", "Mine");
    await newDevice("bob", "Theirs");
    await db.pool.query(
      `INSERT INTO job (type, payload, status) VALUES ('RESCAN_ALL', '{"userId":null}', 'DONE')`,
    );
    await db.pool.query(
      `INSERT INTO job (type, payload, status) VALUES ('IMPORT_KEV', '{}', 'DONE')`,
    );
    const { recent } = await getChecksStatus("alice");
    expect(recent.map((r) => [r.type, r.device?.name ?? null]).sort()).toEqual([
      ["CHECK_DEVICE", "Mine"],
      ["RESCAN_ALL", null],
    ]);
  });

  it("keeps a check of a removed device with no device", async () => {
    const device = await newDevice("alice");
    await prisma.device.delete({ where: { id: device.id } });
    const { recent } = await getChecksStatus("alice");
    expect(recent).toMatchObject([{ type: "CHECK_DEVICE", device: null }]);
  });

  it("runChecks queues one rescan for me and returns it again while it is active", async () => {
    const first = await runChecks("alice");
    expect(await runChecks("alice")).toBe(first);
    expect((await getChecksStatus("alice")).activeRescanJobId).toBe(first);
    expect((await getChecksStatus("bob")).activeRescanJobId).toBeNull();
    const job = await prisma.job.findUniqueOrThrow({ where: { id: first } });
    expect(job).toMatchObject({
      type: "RESCAN_ALL",
      userId: "alice",
      payload: { userId: "alice" },
    });
  });

  it("a scheduled rescan for everyone counts as active for me", async () => {
    const { rows } = await db.pool.query(
      `INSERT INTO job (type, payload, status) VALUES ('RESCAN_ALL', '{"userId":null}', 'RUNNING') RETURNING id`,
    );
    expect(await runChecks("alice")).toBe(rows[0].id);
  });
});

describe("device detail", () => {
  it("is built from my rows only", async () => {
    const mine = await newDevice("alice");
    await newDevice("bob");
    expect((await getDeviceDetail("alice", mine.id)).id).toBe(mine.id);
  });
});
