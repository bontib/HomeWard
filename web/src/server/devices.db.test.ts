import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { CreateDeviceSchema, UpdateDeviceSchema } from "@/lib/contracts";
import { insertUser, insertVulnerability, resetTables, useTestPrisma } from "@/test/db-client";
import { startTestDb, type TestDb } from "@/test/test-db";
import { AppError } from "./errors";
import { createDevice, deleteDevice, getDeviceDetail, listDevices, updateDevice } from "./devices";
import { getJob, scanDevice } from "./jobs";

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

const other = (name: string, version: string | null = null) =>
  CreateDeviceSchema.parse({
    type: "CONSOLE",
    name,
    product: { kind: "other", name: "" },
    version,
  });

async function expectNotFound(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
}

describe("createDevice", () => {
  it("creates the device with its manual product and queues one check", async () => {
    const { device, jobId } = await createDevice("alice", other("Living room Xbox", "10.0"));
    expect(device.product).toMatchObject({ name: "Living room Xbox", cpe: null, version: "10.0" });
    expect(device.check).toEqual({ state: "CHECKING", jobId, errorCode: null });
    expect(device.status).toBe("PENDING");
    const { rows } = await db.pool.query("SELECT type, user_id, device_id, priority FROM job");
    expect(rows).toEqual([
      { type: "CHECK_DEVICE", user_id: "alice", device_id: device.id, priority: 10 },
    ]);
  });

  it("rejects a catalog product that is not in the search cache", async () => {
    const input = CreateDeviceSchema.parse({
      type: "TV",
      name: "TV",
      product: { kind: "catalog", cpe: "cpe:2.3:o:lg:webos" },
      version: "6.0",
    });
    await expect(createDevice("alice", input)).rejects.toBeInstanceOf(AppError);
    expect(await prisma.device.count()).toBe(0);
  });

  it("uses the cached title and vendor for a catalog product", async () => {
    await db.pool.query(
      `INSERT INTO cpe_product (cpe, part, vendor, product, title, fetched_at)
       VALUES ('cpe:2.3:o:lg:webos', 'o', 'lg', 'webos', 'LG webOS', now())`,
    );
    const input = CreateDeviceSchema.parse({
      type: "TV",
      name: "TV",
      product: { kind: "catalog", cpe: "cpe:2.3:o:lg:webos" },
      version: "6.0",
    });
    const { device } = await createDevice("alice", input);
    expect(device.product).toMatchObject({
      name: "LG webOS",
      vendor: "lg",
      cpe: "cpe:2.3:o:lg:webos",
    });
  });
});

describe("listDevices", () => {
  it("only returns my devices, worst first", async () => {
    const a = await createDevice("alice", other("Beta"));
    const b = await createDevice("alice", other("Alpha"));
    await createDevice("bob", other("Bob's"));
    await db.pool.query("UPDATE device SET status = 'CRITICAL' WHERE id = $1", [a.device.id]);
    await db.pool.query("UPDATE device SET status = 'NO_KNOWN_VULNS' WHERE id = $1", [b.device.id]);
    const list = await listDevices("alice");
    expect(list.map((d) => d.name)).toEqual(["Beta", "Alpha"]);
  });

  it("never selects the sbom content column", async () => {
    const { device } = await createDevice("alice", other("PC"));
    await db.pool.query(
      `INSERT INTO sbom (device_id, format, file_name, size_bytes, sha256, content)
       VALUES ($1, 'CYCLONEDX', 'a.json', 3, repeat('a', 64), 'abc')`,
      [device.id],
    );
    const detail = await getDeviceDetail("alice", device.id);
    expect(detail.sbom).toMatchObject({ fileName: "a.json", format: "CYCLONEDX" });
    expect(JSON.stringify(detail)).not.toContain("content");
    expect((await listDevices("alice"))[0]?.hasSbom).toBe(true);
  });
});

describe("another user's device", () => {
  it("is not found for read, update, delete and scan", async () => {
    const { device } = await createDevice("alice", other("Mine"));
    await expectNotFound(getDeviceDetail("bob", device.id));
    await expectNotFound(updateDevice("bob", device.id, UpdateDeviceSchema.parse({ name: "x" })));
    await expectNotFound(deleteDevice("bob", device.id));
    await expectNotFound(scanDevice("bob", device.id));
    expect(await prisma.device.count({ where: { name: "Mine" } })).toBe(1);
  });

  it("does not show findings of a device to another user", async () => {
    const { device } = await createDevice("alice", other("Mine"));
    const component = await prisma.component.findFirstOrThrow({ where: { deviceId: device.id } });
    await insertVulnerability(db, { id: "CVE-2024-0001" });
    await db.pool.query(
      `INSERT INTO finding (device_id, component_id, vulnerability_id, source)
       VALUES ($1, $2, 'CVE-2024-0001', 'NVD')`,
      [device.id, component.id],
    );
    expect((await getDeviceDetail("alice", device.id)).findings).toHaveLength(1);
    await expectNotFound(getDeviceDetail("bob", device.id));
  });
});

describe("updateDevice", () => {
  it("changing only the name queues no check", async () => {
    const { device } = await createDevice("alice", other("Old"));
    const result = await updateDevice(
      "alice",
      device.id,
      UpdateDeviceSchema.parse({ name: "New" }),
    );
    expect(result.device.name).toBe("New");
    expect(result.jobId).toBeNull();
  });

  it("a new version is recorded in the history and reuses the queued check", async () => {
    const { device, jobId } = await createDevice("alice", other("Box", "1.0"));
    const result = await updateDevice(
      "alice",
      device.id,
      UpdateDeviceSchema.parse({ version: "2.0" }),
    );
    expect(result.jobId).toBe(jobId);
    expect(result.device.product?.version).toBe("2.0");
    expect(result.device.versionHistory).toMatchObject([{ fromVersion: "1.0", toVersion: "2.0" }]);
    expect(await prisma.job.count()).toBe(1);
  });

  it("the same version again changes nothing", async () => {
    const { device } = await createDevice("alice", other("Box", "1.0"));
    const result = await updateDevice(
      "alice",
      device.id,
      UpdateDeviceSchema.parse({ version: "1.0" }),
    );
    expect(result.jobId).toBeNull();
    expect(result.device.versionHistory).toEqual([]);
  });

  it("a different product removes the old findings", async () => {
    const { device } = await createDevice("alice", other("Box", "1.0"));
    const component = await prisma.component.findFirstOrThrow({ where: { deviceId: device.id } });
    await insertVulnerability(db, { id: "CVE-2024-0002" });
    await db.pool.query(
      `INSERT INTO finding (device_id, component_id, vulnerability_id, source)
       VALUES ($1, $2, 'CVE-2024-0002', 'NVD')`,
      [device.id, component.id],
    );
    const patch = UpdateDeviceSchema.parse({ product: { kind: "other", name: "Other thing" } });
    const result = await updateDevice("alice", device.id, patch);
    expect(result.device.findings).toEqual([]);
    expect(result.device.product?.name).toBe("Other thing");
  });
});

describe("deleteDevice", () => {
  it("removes the device and what hangs on it", async () => {
    const { device } = await createDevice("alice", other("Gone"));
    await deleteDevice("alice", device.id);
    expect(await prisma.component.count()).toBe(0);
  });
});

describe("getJob", () => {
  it("shows my job and hides someone else's", async () => {
    const { jobId } = await createDevice("alice", other("Box"));
    expect((await getJob("alice", jobId ?? "")).type).toBe("CHECK_DEVICE");
    await expectNotFound(getJob("bob", jobId ?? ""));
  });

  it("hides system jobs except RESCAN_ALL", async () => {
    const { rows } = await db.pool.query(
      `INSERT INTO job (type, payload) VALUES ('IMPORT_KEV', '{}'), ('RESCAN_ALL', '{"userId":null}') RETURNING id, type`,
    );
    const kev = rows.find((r) => r.type === "IMPORT_KEV");
    const rescan = rows.find((r) => r.type === "RESCAN_ALL");
    await expectNotFound(getJob("alice", kev.id));
    expect((await getJob("alice", rescan.id)).type).toBe("RESCAN_ALL");
  });
});

describe("scanDevice", () => {
  it("returns the queued job when pressed twice", async () => {
    const { device } = await createDevice("alice", other("Box"));
    const first = await scanDevice("alice", device.id);
    const second = await scanDevice("alice", device.id);
    expect(second).toBe(first);
  });

  it("queues a new job once the old one has finished", async () => {
    const { device, jobId } = await createDevice("alice", other("Box"));
    await db.pool.query("UPDATE job SET status = 'DONE' WHERE id = $1", [jobId]);
    const again = await scanDevice("alice", device.id);
    expect(again).not.toBe(jobId);
  });
});
