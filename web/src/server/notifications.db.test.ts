// Email alert settings, links and the test mail against a real Postgres.
// Person B must never read or change anything of person A, and a token only ever works for
// the person it was made for.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { CreateDeviceSchema, JobPayloadSchemas, UpdateFindingSchema } from "@/lib/contracts";
import { insertUser, insertVulnerability, resetTables, useTestPrisma } from "@/test/db-client";
import { startTestDb, type TestDb } from "@/test/test-db";
import { createDevice } from "./devices";
import { updateFinding } from "./findings";
import { signToken, verifyToken } from "./notification-tokens";
import {
  confirmEmailAlerts,
  getLinkView,
  CONFIRM_MAILS_PER_HOUR,
  getNotificationSettings,
  NOT_SET_UP,
  sendTestEmail,
  setEmailAlerts,
  unsubscribeEmailAlerts,
} from "./notifications";

let db: TestDb;
let prisma: PrismaClient;

const NOW = new Date("2026-10-25T12:00:00.000Z");
const minutesLater = (m: number) => new Date(NOW.getTime() + m * 60_000);

beforeAll(async () => {
  db = await startTestDb();
  prisma = useTestPrisma(db);
  Object.assign(process.env, {
    DATABASE_URL: db.url,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123",
    BETTER_AUTH_URL: "http://localhost:3000",
  });
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

beforeEach(async () => {
  await resetTables(db);
  await insertUser(db, "alice");
  await insertUser(db, "bob");
  await setSmtp(true);
});

async function setSmtp(configured: boolean) {
  await prisma.workerStatus.upsert({
    where: { id: 1 },
    create: {
      startedAt: NOW,
      heartbeatAt: NOW,
      version: "test",
      rescanCron: "0 3 * * *",
      nvdApiKeySet: false,
      smtpConfigured: configured,
      timeZone: "Europe/Amsterdam",
    },
    update: { smtpConfigured: configured },
  });
}

/** Turns alerts on the way a person does: ask for the link, then open it. */
async function turnOn(userId: string, at = NOW) {
  await setEmailAlerts(userId, true, at);
  const row = await prisma.notification.findFirstOrThrow({
    where: { userId, kind: "CONFIRM", status: "QUEUED" },
    orderBy: { createdAt: "desc" },
  });
  await confirmEmailAlerts(row.linkToken as string, at);
}

async function confirmToken(userId: string): Promise<string> {
  const row = await prisma.notification.findFirstOrThrow({
    where: { userId, kind: "CONFIRM", status: "QUEUED" },
    orderBy: { createdAt: "desc" },
  });
  return row.linkToken as string;
}

/** The link in the person's newest mail: the token on the pref row, or a bare one before alerts were ever on. */
async function unsubscribeToken(userId: string): Promise<string> {
  const pref = await prisma.notificationPref.findUnique({ where: { userId } });
  return pref?.unsubscribeToken ?? signToken("unsubscribe", userId);
}

describe("getNotificationSettings", () => {
  it("shows OFF with the person's own address when nothing was ever set", async () => {
    const settings = await getNotificationSettings("alice", NOW);
    expect(settings).toMatchObject({
      state: "OFF",
      email: "alice@example.com",
      smtpConfigured: true,
      digestHour: 7,
      timeZone: "Europe/Amsterdam",
      lastSentAt: null,
      lastError: null,
      confirmResendAt: null,
      testAvailableAt: null,
    });
  });

  it("says smtp is not configured when the worker never ran", async () => {
    await prisma.workerStatus.deleteMany();
    const settings = await getNotificationSettings("alice", NOW);
    expect(settings.smtpConfigured).toBe(false);
    expect(settings.timeZone).toBeNull();
  });

  it("reports the last sent time and a failure only when the newest finished mail failed", async () => {
    await prisma.notification.create({
      data: { userId: "alice", kind: "TEST", status: "SENT", sentAt: minutesLater(-30) },
    });
    expect((await getNotificationSettings("alice", NOW)).lastSentAt).toBe(
      minutesLater(-30).toISOString(),
    );
    expect((await getNotificationSettings("alice", NOW)).lastError).toBeNull();

    await prisma.notification.create({
      data: { userId: "alice", kind: "DIGEST", status: "FAILED", errorCode: "SMTP_FAILED" },
    });
    expect((await getNotificationSettings("alice", NOW)).lastError).toBe("SMTP_FAILED");
  });

  it("never shows another person's mail history", async () => {
    await prisma.notification.create({
      data: { userId: "bob", kind: "TEST", status: "FAILED", errorCode: "SMTP_FAILED" },
    });
    const settings = await getNotificationSettings("alice", NOW);
    expect(settings.lastError).toBeNull();
    expect(settings.email).toBe("alice@example.com");
  });
});

describe("setEmailAlerts", () => {
  it("moves OFF to PENDING_CONFIRM and queues one CONFIRM mail with its job", async () => {
    const result = await setEmailAlerts("alice", true, NOW);

    expect(result.settings.state).toBe("PENDING_CONFIRM");
    expect(result.jobId).not.toBeNull();
    const job = await prisma.job.findUniqueOrThrow({ where: { id: result.jobId as string } });
    expect(job.type).toBe("SEND_EMAIL");
    expect(job.userId).toBe("alice");
    const notification = await prisma.notification.findFirstOrThrow({ where: { userId: "alice" } });
    expect(JobPayloadSchemas.SEND_EMAIL.parse(job.payload).notificationId).toBe(notification.id);
    expect(notification).toMatchObject({ kind: "CONFIRM", status: "QUEUED" });
    const token = verifyToken(notification.linkToken as string, "confirm", { now: NOW });
    expect(token?.userId).toBe("alice");
    expect(token?.expiresAt?.toISOString()).toBe("2026-10-27T12:00:00.000Z");
  });

  it("answers 409 and changes nothing when smtp is not set up", async () => {
    await setSmtp(false);
    await expect(setEmailAlerts("alice", true, NOW)).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: NOT_SET_UP,
    });
    expect(await prisma.notificationPref.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.job.count()).toBe(0);
  });

  it("allows turning alerts off even when smtp is not set up", async () => {
    await setSmtp(false);
    const result = await setEmailAlerts("alice", false, NOW);
    expect(result.settings.state).toBe("OFF");
  });

  it("limits a new link to once every 10 minutes", async () => {
    await setEmailAlerts("alice", true, NOW);
    await expect(setEmailAlerts("alice", true, minutesLater(9))).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      message: "Wait a few minutes before asking for another link.",
    });
    const again = await setEmailAlerts("alice", true, minutesLater(10));
    expect(again.jobId).not.toBeNull();
  });

  it("tells the page when the resend button unlocks", async () => {
    await setEmailAlerts("alice", true, NOW);
    const settings = await getNotificationSettings("alice", minutesLater(4));
    expect(settings.confirmResendAt).toBe(minutesLater(10).toISOString());
    expect((await getNotificationSettings("alice", minutesLater(11))).confirmResendAt).toBeNull();
  });

  it("lets only one of two parallel requests through", async () => {
    const results = await Promise.allSettled([
      setEmailAlerts("alice", true, NOW),
      setEmailAlerts("alice", true, NOW),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.notification.count({ where: { userId: "alice" } })).toBe(1);
  });

  it("kills the older link when a new one is asked for", async () => {
    await setEmailAlerts("alice", true, NOW);
    const older = await confirmToken("alice");
    await setEmailAlerts("alice", true, minutesLater(11));

    await expect(confirmEmailAlerts(older, minutesLater(12))).rejects.toMatchObject({
      code: "INVALID_LINK",
    });
    const cancelled = await prisma.notification.findMany({ where: { status: "CANCELLED" } });
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.linkToken).toBeNull();
    const newer = await prisma.notification.findFirstOrThrow({ where: { status: "QUEUED" } });
    await confirmEmailAlerts(newer.linkToken as string, minutesLater(12));
    expect((await getNotificationSettings("alice", minutesLater(12))).state).toBe("ON");
  });

  it("does nothing when alerts are already on", async () => {
    await turnOn("alice");
    const before = await prisma.notification.count();
    const result = await setEmailAlerts("alice", true, minutesLater(30));
    expect(result.jobId).toBeNull();
    expect(await prisma.notification.count()).toBe(before);
  });

  it("turning off cancels every queued mail of that person and none of another", async () => {
    await turnOn("alice");
    await turnOn("bob");
    await prisma.notification.createMany({
      data: [
        { userId: "alice", kind: "INSTANT" },
        { userId: "alice", kind: "DIGEST" },
        { userId: "bob", kind: "INSTANT" },
      ],
    });

    const result = await setEmailAlerts("alice", false, minutesLater(1));

    expect(result.settings.state).toBe("OFF");
    expect(await prisma.notification.count({ where: { userId: "alice", status: "QUEUED" } })).toBe(
      0,
    );
    expect(
      await prisma.notification.count({
        where: { userId: "bob", kind: "INSTANT", status: "QUEUED" },
      }),
    ).toBe(1);
    expect((await getNotificationSettings("bob", NOW)).state).toBe("ON");
  });

  it("keeps person B's state when person A asks", async () => {
    await setEmailAlerts("alice", true, NOW);
    expect((await getNotificationSettings("bob", NOW)).state).toBe("OFF");
    expect(await prisma.notificationPref.findUnique({ where: { userId: "bob" } })).toBeNull();
  });
});

describe("confirmEmailAlerts", () => {
  it("turns alerts on and marks every existing finding as already told", async () => {
    const device = (
      await createDevice(
        "alice",
        CreateDeviceSchema.parse({
          type: "CONSOLE",
          name: "Box",
          product: { kind: "other", name: "" },
          version: "1.0",
        }),
      )
    ).device;
    const component = await prisma.component.findFirstOrThrow({ where: { deviceId: device.id } });
    await insertVulnerability(db, { id: "CVE-1" });
    await insertVulnerability(db, { id: "CVE-2" });
    const mine = await prisma.finding.create({
      data: {
        deviceId: device.id,
        componentId: component.id,
        vulnerabilityId: "CVE-1",
        source: "NVD",
      },
    });
    const ignored = await prisma.finding.create({
      data: {
        deviceId: device.id,
        componentId: component.id,
        vulnerabilityId: "CVE-2",
        source: "NVD",
        state: "IGNORED",
      },
    });
    await insertUser(db, "carol");
    const carolDevice = await prisma.device.create({
      data: { userId: "carol", name: "Other", type: "OTHER" },
    });
    const carolComponent = await prisma.component.create({
      data: { deviceId: carolDevice.id, source: "MANUAL", name: "x" },
    });
    const theirs = await prisma.finding.create({
      data: {
        deviceId: carolDevice.id,
        componentId: carolComponent.id,
        vulnerabilityId: "CVE-1",
        source: "NVD",
      },
    });

    await turnOn("alice");

    const pref = await prisma.notificationPref.findUniqueOrThrow({ where: { userId: "alice" } });
    expect(pref).toMatchObject({ emailState: "ON", confirmNonce: null });
    expect(pref.confirmedAt).not.toBeNull();
    expect(
      (await prisma.finding.findUniqueOrThrow({ where: { id: mine.id } })).notifiedAt,
    ).not.toBeNull();
    expect(
      (await prisma.finding.findUniqueOrThrow({ where: { id: ignored.id } })).notifiedAt,
    ).not.toBeNull();
    expect(
      (await prisma.finding.findUniqueOrThrow({ where: { id: theirs.id } })).notifiedAt,
    ).toBeNull();
  });

  it("refuses a used nonce the second time but stays calm when alerts are already on", async () => {
    await setEmailAlerts("alice", true, NOW);
    const token = await confirmToken("alice");
    await confirmEmailAlerts(token, NOW);

    expect(await confirmEmailAlerts(token, minutesLater(1))).toEqual({ state: "ON" });
    await setEmailAlerts("alice", false, minutesLater(2));
    await expect(confirmEmailAlerts(token, minutesLater(3))).rejects.toMatchObject({
      code: "INVALID_LINK",
    });
  });

  it("refuses an expired link with the documented text", async () => {
    await setEmailAlerts("alice", true, NOW);
    const token = await confirmToken("alice");
    await expect(confirmEmailAlerts(token, minutesLater(48 * 60 + 1))).rejects.toMatchObject({
      code: "INVALID_LINK",
      status: 400,
      message: "This link has expired. Turn on alerts again in Settings > Notifications.",
    });
    expect((await getNotificationSettings("alice", NOW)).state).toBe("PENDING_CONFIRM");
  });

  it("refuses a forged token and changes nothing", async () => {
    await setEmailAlerts("alice", true, NOW);
    const token = await confirmToken("alice");
    const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    await expect(confirmEmailAlerts(tampered, NOW)).rejects.toMatchObject({ code: "INVALID_LINK" });
    expect((await getNotificationSettings("alice", NOW)).state).toBe("PENDING_CONFIRM");
  });

  it("refuses an unsubscribe token used as a confirm token", async () => {
    await setEmailAlerts("alice", true, NOW);
    await expect(confirmEmailAlerts(await unsubscribeToken("alice"), NOW)).rejects.toMatchObject({
      code: "INVALID_LINK",
    });
  });

  it("changes only the person the token was made for", async () => {
    await setEmailAlerts("alice", true, NOW);
    await setEmailAlerts("bob", true, NOW);
    await confirmEmailAlerts(await confirmToken("alice"), NOW);
    expect((await getNotificationSettings("alice", NOW)).state).toBe("ON");
    expect((await getNotificationSettings("bob", NOW)).state).toBe("PENDING_CONFIRM");
  });

  it("does not let alice's token with bob's nonce confirm bob", async () => {
    await setEmailAlerts("bob", true, NOW);
    const bobPref = await prisma.notificationPref.findUniqueOrThrow({ where: { userId: "bob" } });
    const forged = signToken("confirm", "alice", {
      nonce: bobPref.confirmNonce as string,
      expiresAt: minutesLater(60),
    });
    await expect(confirmEmailAlerts(forged, NOW)).rejects.toMatchObject({ code: "INVALID_LINK" });
    expect((await getNotificationSettings("bob", NOW)).state).toBe("PENDING_CONFIRM");
  });

  it("answers 409 when smtp is not set up and leaves the pending state alone", async () => {
    await setEmailAlerts("alice", true, NOW);
    const token = await confirmToken("alice");
    await setSmtp(false);
    await expect(confirmEmailAlerts(token, NOW)).rejects.toMatchObject({
      code: "CONFLICT",
      message: NOT_SET_UP,
    });
    expect((await getNotificationSettings("alice", NOW)).state).toBe("PENDING_CONFIRM");
  });
});

describe("unsubscribeEmailAlerts", () => {
  it("turns alerts off and cancels queued mail, with no session", async () => {
    await turnOn("alice");
    await prisma.notification.create({ data: { userId: "alice", kind: "INSTANT" } });

    expect(await unsubscribeEmailAlerts(await unsubscribeToken("alice"), minutesLater(5))).toEqual({
      state: "OFF",
    });

    expect((await getNotificationSettings("alice", NOW)).state).toBe("OFF");
    expect(await prisma.notification.count({ where: { userId: "alice", status: "QUEUED" } })).toBe(
      0,
    );
  });

  it("works with the token stored on the pref row, which is what the worker puts in mails", async () => {
    await turnOn("alice");
    const pref = await prisma.notificationPref.findUniqueOrThrow({ where: { userId: "alice" } });
    await unsubscribeEmailAlerts(pref.unsubscribeToken, NOW);
    expect((await getNotificationSettings("alice", NOW)).state).toBe("OFF");
  });

  it("is harmless when alerts were never on", async () => {
    expect(await unsubscribeEmailAlerts(await unsubscribeToken("alice"), NOW)).toEqual({
      state: "OFF",
    });
  });

  it("never touches another person", async () => {
    await turnOn("alice");
    await turnOn("bob");
    await unsubscribeEmailAlerts(await unsubscribeToken("alice"), NOW);
    expect((await getNotificationSettings("bob", NOW)).state).toBe("ON");
  });

  it("refuses a confirm token and a forged token with the documented text", async () => {
    await turnOn("alice");
    await setEmailAlerts("alice", true, minutesLater(20));
    const confirm = await confirmToken("alice").catch(() => "");
    const forged = signToken("unsubscribe", "alice", { secret: "x".repeat(40) });
    for (const token of [confirm || (await unsubscribeToken("alice")).replace(/.$/, "A"), forged]) {
      await expect(unsubscribeEmailAlerts(token, NOW)).rejects.toMatchObject({
        code: "INVALID_LINK",
        message: "This link doesn't work. You can turn alerts off in Settings > Notifications.",
      });
    }
    expect((await getNotificationSettings("alice", NOW)).state).toBe("ON");
  });
});

describe("getLinkView", () => {
  it("shows the masked address and changes nothing", async () => {
    await setEmailAlerts("alice", true, NOW);
    const before = await prisma.notificationPref.findUniqueOrThrow({ where: { userId: "alice" } });

    const view = await getLinkView("confirm", await confirmToken("alice"), NOW);

    expect(view).toEqual({
      purpose: "confirm",
      maskedEmail: "a***@example.com",
      alreadyDone: false,
    });
    const after = await prisma.notificationPref.findUniqueOrThrow({ where: { userId: "alice" } });
    expect(after).toEqual(before);
  });

  it("says alreadyDone for a confirm link when alerts are on, and for unsubscribe when off", async () => {
    await turnOn("alice");
    const confirm = await prisma.notification.findFirstOrThrow({ where: { userId: "alice" } });
    // The confirm row's token was cleared by the worker in real life; sign a genuine one here.
    const old = signToken("confirm", "alice", { nonce: "gone", expiresAt: minutesLater(60) });
    expect(confirm.kind).toBe("CONFIRM");
    expect((await getLinkView("confirm", old, NOW)).alreadyDone).toBe(true);
    expect(
      (await getLinkView("unsubscribe", await unsubscribeToken("alice"), NOW)).alreadyDone,
    ).toBe(false);
    await unsubscribeEmailAlerts(await unsubscribeToken("alice"), NOW);
    expect(
      (await getLinkView("unsubscribe", await unsubscribeToken("alice"), NOW)).alreadyDone,
    ).toBe(true);
  });

  it("refuses a confirm link that was replaced, expired or made for the wrong purpose", async () => {
    await setEmailAlerts("alice", true, NOW);
    const token = await confirmToken("alice");
    await expect(getLinkView("confirm", token, minutesLater(48 * 60 + 1))).rejects.toMatchObject({
      code: "INVALID_LINK",
    });
    await expect(getLinkView("unsubscribe", token, NOW)).rejects.toMatchObject({
      code: "INVALID_LINK",
    });
    await setEmailAlerts("alice", true, minutesLater(11));
    await expect(getLinkView("confirm", token, minutesLater(12))).rejects.toMatchObject({
      code: "INVALID_LINK",
    });
  });

  it("refuses a link for a deleted person", async () => {
    const token = await unsubscribeToken("alice");
    await prisma.user.delete({ where: { id: "alice" } });
    await expect(getLinkView("unsubscribe", token, NOW)).rejects.toMatchObject({
      code: "INVALID_LINK",
    });
  });
});

describe("sendTestEmail", () => {
  it("queues a TEST mail for the person's own address", async () => {
    await turnOn("alice");
    const result = await sendTestEmail("alice", minutesLater(1));

    expect(result.jobId).not.toBeNull();
    const row = await prisma.notification.findFirstOrThrow({ where: { kind: "TEST" } });
    expect(row.userId).toBe("alice");
    expect(row.status).toBe("QUEUED");
    const job = await prisma.job.findUniqueOrThrow({ where: { id: result.jobId as string } });
    expect(job.userId).toBe("alice");
    expect(result.settings.testAvailableAt).toBe(minutesLater(6).toISOString());
  });

  it("answers 409 before alerts are on and when smtp is not set up", async () => {
    await expect(sendTestEmail("alice", NOW)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Turn on email alerts first.",
    });
    await setEmailAlerts("alice", true, NOW);
    await expect(sendTestEmail("alice", NOW)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Turn on email alerts first.",
    });
    await setSmtp(false);
    await expect(sendTestEmail("alice", NOW)).rejects.toMatchObject({
      code: "CONFLICT",
      message: NOT_SET_UP,
    });
    expect(await prisma.notification.count({ where: { kind: "TEST" } })).toBe(0);
  });

  it("limits tests to one every 5 minutes, also for two parallel calls", async () => {
    await turnOn("alice");
    const parallel = await Promise.allSettled([
      sendTestEmail("alice", minutesLater(1)),
      sendTestEmail("alice", minutesLater(1)),
    ]);
    expect(parallel.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.notification.count({ where: { kind: "TEST" } })).toBe(1);

    await expect(sendTestEmail("alice", minutesLater(5))).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      message: "Wait a few minutes before sending another test email.",
    });
    expect((await sendTestEmail("alice", minutesLater(6))).jobId).not.toBeNull();
  });

  it("never queues a test mail for another person", async () => {
    await turnOn("alice");
    await expect(sendTestEmail("bob", minutesLater(1))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.notification.count({ where: { userId: "bob" } })).toBe(0);
  });
});

describe("ignoring a finding", () => {
  async function newFinding() {
    const device = (
      await createDevice(
        "alice",
        CreateDeviceSchema.parse({
          type: "CONSOLE",
          name: "Box",
          product: { kind: "other", name: "" },
          version: "1.0",
        }),
      )
    ).device;
    const component = await prisma.component.findFirstOrThrow({ where: { deviceId: device.id } });
    await insertVulnerability(db, { id: "CVE-9" });
    return prisma.finding.create({
      data: {
        deviceId: device.id,
        componentId: component.id,
        vulnerabilityId: "CVE-9",
        source: "NVD",
      },
    });
  }

  it("marks the finding as told, and a reopen keeps that mark", async () => {
    const finding = await newFinding();
    await updateFinding(
      "alice",
      finding.id,
      UpdateFindingSchema.parse({ state: "IGNORED", reason: "ok" }),
    );
    const ignored = await prisma.finding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(ignored.notifiedAt).not.toBeNull();

    await updateFinding("alice", finding.id, UpdateFindingSchema.parse({ state: "OPEN" }));
    const reopened = await prisma.finding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(reopened.notifiedAt).toEqual(ignored.notifiedAt);
  });

  it("keeps an earlier notified_at when ignoring", async () => {
    const finding = await newFinding();
    const earlier = new Date("2026-01-01T00:00:00Z");
    await prisma.finding.update({ where: { id: finding.id }, data: { notifiedAt: earlier } });
    await updateFinding(
      "alice",
      finding.id,
      UpdateFindingSchema.parse({ state: "IGNORED", reason: "ok" }),
    );
    expect(
      (await prisma.finding.findUniqueOrThrow({ where: { id: finding.id } })).notifiedAt,
    ).toEqual(earlier);
  });

  it("does not mark another person's finding", async () => {
    const finding = await newFinding();
    await expect(
      updateFinding(
        "bob",
        finding.id,
        UpdateFindingSchema.parse({ state: "IGNORED", reason: "ok" }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await prisma.finding.findUniqueOrThrow({ where: { id: finding.id } })).notifiedAt,
    ).toBeNull();
  });
});

describe("confirm mail limits", () => {
  const hoursLater = (h: number) => minutesLater(h * 60);

  /** Asks for a new link every 11 minutes, which is what a person clicking "send again" does. */
  async function askAgain(userId: string, times: number, start = NOW) {
    for (let i = 0; i < times; i++)
      await setEmailAlerts(
        userId,
        true,
        minutesLater(11 * i + (start.getTime() - NOW.getTime()) / 60_000),
      );
  }

  it("stops after 3 confirm mails for one account, with a message about turning off and on", async () => {
    await askAgain("alice", 3);
    await expect(setEmailAlerts("alice", true, minutesLater(40))).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      message: expect.stringContaining("off and on again"),
    });
    expect(await prisma.notification.count({ where: { userId: "alice", kind: "CONFIRM" } })).toBe(
      3,
    );
  });

  it("starts counting again after alerts are turned off and on, until the address limit", async () => {
    await askAgain("alice", 3);
    await setEmailAlerts("alice", false, minutesLater(40));
    await expect(setEmailAlerts("alice", true, minutesLater(41))).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: expect.stringContaining("Try again later"),
    });
    const next = await setEmailAlerts("alice", true, hoursLater(25));
    expect(next.jobId).not.toBeNull();
    expect(
      (await prisma.notificationPref.findUniqueOrThrow({ where: { userId: "alice" } }))
        .confirmSendCount,
    ).toBe(1);
  });

  it("limits confirm mails for one address even when the account is deleted and made again", async () => {
    await askAgain("alice", 3);
    await prisma.user.delete({ where: { id: "alice" } });
    await insertUser(db, "alice");
    await expect(setEmailAlerts("alice", true, minutesLater(60))).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("limits confirm mails for the whole instance per hour", async () => {
    await prisma.confirmSend.createMany({
      data: Array.from({ length: CONFIRM_MAILS_PER_HOUR }, (_, i) => ({
        email: `stranger${i}@example.com`,
        createdAt: minutesLater(-5),
      })),
    });
    await expect(setEmailAlerts("alice", true, NOW)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(await prisma.notification.count()).toBe(0);
    const later = await setEmailAlerts("alice", true, minutesLater(60));
    expect(later.jobId).not.toBeNull();
  });

  it("forgets log rows older than two days", async () => {
    await prisma.confirmSend.create({
      data: { email: "old@example.com", createdAt: hoursLater(-49) },
    });
    await setEmailAlerts("alice", true, NOW);
    expect(await prisma.confirmSend.count({ where: { email: "old@example.com" } })).toBe(0);
  });
});

describe("unsubscribe link rotation", () => {
  it("stops an older unsubscribe link when alerts are turned on again", async () => {
    await turnOn("alice");
    const first = await unsubscribeToken("alice");
    await setEmailAlerts("alice", false, minutesLater(1));
    await turnOn("alice", minutesLater(20));
    const second = await unsubscribeToken("alice");
    expect(second).not.toBe(first);

    await expect(unsubscribeEmailAlerts(first, minutesLater(30))).rejects.toMatchObject({
      code: "INVALID_LINK",
    });
    await expect(getLinkView("unsubscribe", first, minutesLater(30))).rejects.toMatchObject({
      code: "INVALID_LINK",
    });
    expect((await getNotificationSettings("alice", minutesLater(30))).state).toBe("ON");
    expect(await unsubscribeEmailAlerts(second, minutesLater(30))).toEqual({ state: "OFF" });
  });

  it("keeps the newest link working through the whole on period, for the page and one-click", async () => {
    await turnOn("alice");
    const token = await unsubscribeToken("alice");
    expect((await getLinkView("unsubscribe", token, minutesLater(60 * 24 * 30))).alreadyDone).toBe(
      false,
    );
    expect(await unsubscribeEmailAlerts(token, minutesLater(60 * 24 * 30))).toEqual({
      state: "OFF",
    });
  });

  it("rotates the link when the confirm link is opened", async () => {
    await setEmailAlerts("alice", true, NOW);
    const pending = await unsubscribeToken("alice");
    await confirmEmailAlerts(await confirmToken("alice"), NOW);
    expect(await unsubscribeToken("alice")).not.toBe(pending);
    await expect(unsubscribeEmailAlerts(pending, NOW)).rejects.toMatchObject({
      code: "INVALID_LINK",
    });
  });

  it("still answers OFF for an old link once alerts are off", async () => {
    await turnOn("alice");
    const old = await unsubscribeToken("alice");
    await setEmailAlerts("alice", false, minutesLater(1));
    expect(await unsubscribeEmailAlerts(old, minutesLater(2))).toEqual({ state: "OFF" });
  });
});
