// E-mail alert settings, the confirm and unsubscribe links, and the test mail
// (docs/architecture-notifications.md sections 5 to 7). The web app only writes rows and jobs;
// the worker sends every mail. Every function that takes a userId touches that user's rows only.
// The functions that take a token get the user from the verified token, never from the request.
import type { Prisma } from "@/generated/prisma/client";
import {
  DIGEST_HOUR,
  type ConfirmEmailAlertsResponse,
  type NotificationActionResponse,
  type NotificationLinkView,
  type NotificationSettings,
  type UnsubscribeEmailAlertsResponse,
} from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { AppError } from "./errors";
import {
  maskEmail,
  newNonce,
  signToken,
  verifyToken,
  type TokenPurpose,
} from "./notification-tokens";

type Tx = Prisma.TransactionClient;

const CONFIRM_LINK_HOURS = 48;
const CONFIRM_RESEND_MINUTES = 10;
const TEST_MINUTES = 5;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Limits on confirm mails. Sign-up can be open and a stranger can type any address, so these
// keep HomeGuard from being used to mail someone (or to get the SMTP account blocked).
export const CONFIRM_MAILS_PER_ACCOUNT = 3; // until alerts are turned off and on again
export const CONFIRM_MAILS_PER_ADDRESS_PER_DAY = 3;
export const CONFIRM_MAILS_PER_HOUR = 20; // the whole instance
const CONFIRM_LOG_KEEP_MS = 2 * DAY_MS;
const CONFIRM_LOCK_KEY = 727_001; // pg_advisory_xact_lock key: counts and inserts must not interleave

export const NOT_SET_UP = "Email alerts aren't set up on this HomeGuard yet.";
const TURN_ON_FIRST = "Turn on email alerts first.";
const WAIT_FOR_LINK = "Wait a few minutes before asking for another link.";
const CONFIRM_ACCOUNT_LIMIT =
  "We already sent several confirmation emails. Turn email alerts off and on again to start over.";
const CONFIRM_BUSY = "We can't send another confirmation email right now. Try again later.";
const WAIT_FOR_TEST = "Wait a few minutes before sending another test email.";

const INVALID_TEXT: Record<TokenPurpose, string> = {
  confirm: "This link has expired. Turn on alerts again in Settings > Notifications.",
  unsubscribe: "This link doesn't work. You can turn alerts off in Settings > Notifications.",
};

export function invalidLink(purpose: TokenPurpose): AppError {
  return new AppError("INVALID_LINK", INVALID_TEXT[purpose]);
}

const plusMinutes = (from: Date, minutes: number) => new Date(from.getTime() + minutes * MINUTE_MS);

// ---------- Settings ----------

async function isSmtpConfigured(): Promise<boolean> {
  const status = await getDb().workerStatus.findUnique({
    where: { id: 1 },
    select: { smtpConfigured: true },
  });
  return status?.smtpConfigured ?? false;
}

/** The time when a limit ends, or null when it already ended. */
function unlocksAt(last: Date | null, minutes: number, now: Date): Date | null {
  if (!last) return null;
  const end = plusMinutes(last, minutes);
  return end > now ? end : null;
}

export async function getNotificationSettings(
  userId: string,
  now: Date = new Date(),
): Promise<NotificationSettings> {
  const db = getDb();
  const [user, pref, worker, lastSent, lastFinished] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } }),
    db.notificationPref.findUnique({ where: { userId } }),
    db.workerStatus.findUnique({
      where: { id: 1 },
      select: { smtpConfigured: true, timeZone: true },
    }),
    db.notification.findFirst({
      where: { userId, status: "SENT" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    db.notification.findFirst({
      where: { userId, status: { in: ["SENT", "FAILED"] } },
      orderBy: { createdAt: "desc" },
      select: { status: true, errorCode: true },
    }),
  ]);
  const state = pref?.emailState ?? "OFF";
  return {
    state,
    email: user.email,
    smtpConfigured: worker?.smtpConfigured ?? false,
    digestHour: DIGEST_HOUR,
    timeZone: worker?.timeZone ?? null,
    lastSentAt: lastSent?.sentAt?.toISOString() ?? null,
    lastError: lastFinished?.status === "FAILED" ? lastFinished.errorCode : null,
    confirmResendAt:
      state === "PENDING_CONFIRM"
        ? (unlocksAt(pref?.lastConfirmSentAt ?? null, CONFIRM_RESEND_MINUTES, now)?.toISOString() ??
          null)
        : null,
    testAvailableAt: unlocksAt(pref?.lastTestAt ?? null, TEST_MINUTES, now)?.toISOString() ?? null,
  };
}

// ---------- Turning alerts on and off ----------

/**
 * A new unsubscribe link for this person. The nonce is stored next to the token, so a link
 * from an earlier "on" period stops working when a new one starts.
 */
function freshUnsubscribe(userId: string): { unsubscribeNonce: string; unsubscribeToken: string } {
  const unsubscribeNonce = newNonce();
  return {
    unsubscribeNonce,
    unsubscribeToken: signToken("unsubscribe", userId, { nonce: unsubscribeNonce }),
  };
}

/** One row per person, created on the first "turn on". */
async function ensurePref(tx: Tx, userId: string): Promise<void> {
  await tx.notificationPref.createMany({
    data: [{ userId, ...freshUnsubscribe(userId) }],
    skipDuplicates: true,
  });
}

/** Account, address and instance limits for one more confirm mail. Throws when one is used up. */
async function reserveConfirmMail(tx: Tx, userId: string, countSoFar: number, now: Date) {
  if (countSoFar >= CONFIRM_MAILS_PER_ACCOUNT) {
    throw new AppError("RATE_LIMITED", CONFIRM_ACCOUNT_LIMIT);
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CONFIRM_LOCK_KEY})`;
  const { email } = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });
  const address = email.toLowerCase();
  await tx.confirmSend.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - CONFIRM_LOG_KEEP_MS) } },
  });
  const [forAddress, forInstance] = await Promise.all([
    tx.confirmSend.count({
      where: { email: address, createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
    }),
    tx.confirmSend.count({ where: { createdAt: { gt: new Date(now.getTime() - HOUR_MS) } } }),
  ]);
  if (forAddress >= CONFIRM_MAILS_PER_ADDRESS_PER_DAY || forInstance >= CONFIRM_MAILS_PER_HOUR) {
    throw new AppError("RATE_LIMITED", CONFIRM_BUSY);
  }
  await tx.confirmSend.create({ data: { email: address, createdAt: now } });
}

/** Two requests of the same person wait for each other here, so a rate limit cannot be raced. */
async function lockPref(tx: Tx, userId: string) {
  await tx.$queryRaw`SELECT user_id FROM notification_pref WHERE user_id = ${userId} FOR UPDATE`;
  return tx.notificationPref.findUniqueOrThrow({ where: { userId } });
}

async function cancelQueuedMail(
  tx: Tx,
  userId: string,
  kind?: "CONFIRM" | "TEST" | "INSTANT" | "DIGEST",
): Promise<void> {
  await tx.notification.updateMany({
    where: { userId, status: "QUEUED", ...(kind && { kind }) },
    data: { status: "CANCELLED", linkToken: null },
  });
}

async function turnOn(userId: string, now: Date): Promise<string | null> {
  return getDb().$transaction(async (tx) => {
    await ensurePref(tx, userId);
    const pref = await lockPref(tx, userId);
    if (pref.emailState === "ON") return null;
    if (unlocksAt(pref.lastConfirmSentAt, CONFIRM_RESEND_MINUTES, now)) {
      throw new AppError("RATE_LIMITED", WAIT_FOR_LINK);
    }
    // Turning alerts off and on again is the way to start counting from zero.
    const sentSoFar = pref.emailState === "OFF" ? 0 : pref.confirmSendCount;
    await reserveConfirmMail(tx, userId, sentSoFar, now);

    const nonce = newNonce();
    await tx.notificationPref.update({
      where: { userId },
      data: {
        emailState: "PENDING_CONFIRM",
        confirmNonce: nonce,
        lastConfirmSentAt: now,
        confirmSendCount: sentSoFar + 1,
        ...freshUnsubscribe(userId),
      },
    });
    // Older confirm mails that are still waiting would carry a dead link.
    await cancelQueuedMail(tx, userId, "CONFIRM");
    const linkToken = signToken("confirm", userId, {
      nonce,
      expiresAt: plusMinutes(now, CONFIRM_LINK_HOURS * 60),
    });
    const notification = await tx.notification.create({
      data: { userId, kind: "CONFIRM", linkToken },
      select: { id: true },
    });
    return enqueueJob(tx, {
      type: "SEND_EMAIL",
      payload: { notificationId: notification.id },
      userId,
    });
  });
}

async function turnOff(userId: string, unsubscribeNonce?: string | null): Promise<boolean> {
  return getDb().$transaction(async (tx) => {
    const changed = await tx.notificationPref.updateMany({
      // With a nonce this is an unsubscribe link: only the link of the current period counts.
      where: { userId, ...(unsubscribeNonce !== undefined && { unsubscribeNonce }) },
      data: { emailState: "OFF", confirmNonce: null },
    });
    if (changed.count > 0) await cancelQueuedMail(tx, userId);
    return changed.count > 0;
  });
}

export async function setEmailAlerts(
  userId: string,
  enabled: boolean,
  now: Date = new Date(),
): Promise<NotificationActionResponse> {
  let jobId: string | null = null;
  if (enabled) {
    if (!(await isSmtpConfigured())) throw new AppError("CONFLICT", NOT_SET_UP);
    jobId = await turnOn(userId, now);
  } else {
    await turnOff(userId);
  }
  return { settings: await getNotificationSettings(userId, now), jobId };
}

// ---------- Test mail ----------

export async function sendTestEmail(
  userId: string,
  now: Date = new Date(),
): Promise<NotificationActionResponse> {
  if (!(await isSmtpConfigured())) throw new AppError("CONFLICT", NOT_SET_UP);
  const jobId = await getDb().$transaction(async (tx) => {
    const exists = await tx.notificationPref.findUnique({
      where: { userId },
      select: { userId: true },
    });
    if (!exists) throw new AppError("CONFLICT", TURN_ON_FIRST);
    const pref = await lockPref(tx, userId);
    if (pref.emailState !== "ON") throw new AppError("CONFLICT", TURN_ON_FIRST);
    if (unlocksAt(pref.lastTestAt, TEST_MINUTES, now)) {
      throw new AppError("RATE_LIMITED", WAIT_FOR_TEST);
    }
    await tx.notificationPref.update({ where: { userId }, data: { lastTestAt: now } });
    const notification = await tx.notification.create({
      data: { userId, kind: "TEST" },
      select: { id: true },
    });
    return enqueueJob(tx, {
      type: "SEND_EMAIL",
      payload: { notificationId: notification.id },
      userId,
    });
  });
  return { settings: await getNotificationSettings(userId, now), jobId };
}

// ---------- Links in mails (no session; the signed token is the credential) ----------

/** Reads only. Link scanners and previews call this, so it must never change anything. */
export async function getLinkView(
  purpose: TokenPurpose,
  token: string,
  now: Date = new Date(),
): Promise<NotificationLinkView> {
  const verified = verifyToken(token, purpose, { now, allowExpired: purpose === "confirm" });
  if (!verified) throw invalidLink(purpose);
  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: verified.userId },
    select: { email: true },
  });
  if (!user) throw invalidLink(purpose);
  const pref = await db.notificationPref.findUnique({ where: { userId: verified.userId } });
  const view = (alreadyDone: boolean): NotificationLinkView => ({
    purpose,
    maskedEmail: maskEmail(user.email),
    alreadyDone,
  });

  if (purpose === "unsubscribe") {
    if (!pref || pref.emailState === "OFF") return view(true);
    if (pref.unsubscribeNonce !== verified.nonce) throw invalidLink("unsubscribe");
    return view(false);
  }
  if (pref?.emailState === "ON") return view(true);
  const expired = verified.expiresAt !== null && verified.expiresAt <= now;
  const current =
    pref?.emailState === "PENDING_CONFIRM" &&
    verified.nonce !== null &&
    pref.confirmNonce === verified.nonce;
  if (expired || !current) throw invalidLink("confirm");
  return view(false);
}

class NotConfirmed extends Error {}

/** Baseline and the guarded state change in one transaction (architecture section 6.4). */
async function confirmInTransaction(userId: string, nonce: string, now: Date): Promise<boolean> {
  try {
    await getDb().$transaction(async (tx) => {
      // Open findings the person already has are not mailed (N-D8). Closed ones stay eligible
      // so a Critical that returns later is still mailed. Findings first, pref last.
      await tx.finding.updateMany({
        where: { device: { userId }, state: "OPEN", notifiedAt: null },
        data: { notifiedAt: now },
      });
      const changed = await tx.notificationPref.updateMany({
        where: { userId, emailState: "PENDING_CONFIRM", confirmNonce: nonce },
        data: {
          emailState: "ON",
          confirmedAt: now,
          confirmNonce: null,
          ...freshUnsubscribe(userId),
        },
      });
      if (changed.count !== 1) throw new NotConfirmed();
    });
    return true;
  } catch (err) {
    if (err instanceof NotConfirmed) return false;
    throw err;
  }
}

async function isOn(userId: string): Promise<boolean> {
  const pref = await getDb().notificationPref.findUnique({
    where: { userId },
    select: { emailState: true },
  });
  return pref?.emailState === "ON";
}

export async function confirmEmailAlerts(
  token: string,
  now: Date = new Date(),
): Promise<ConfirmEmailAlertsResponse> {
  const verified = verifyToken(token, "confirm", { now });
  if (!verified || verified.nonce === null) {
    // A second click on an old but genuine link, after alerts are already on, is not an error.
    const old = verifyToken(token, "confirm", { now, allowExpired: true });
    if (old && (await isOn(old.userId))) return { state: "ON" };
    throw invalidLink("confirm");
  }
  if (await isOn(verified.userId)) return { state: "ON" };
  if (!(await isSmtpConfigured())) throw new AppError("CONFLICT", NOT_SET_UP);
  if (await confirmInTransaction(verified.userId, verified.nonce, now)) return { state: "ON" };
  // Someone else (a second click at the same moment) may have got there first.
  if (await isOn(verified.userId)) return { state: "ON" };
  throw invalidLink("confirm");
}

export async function unsubscribeEmailAlerts(
  token: string,
  now: Date = new Date(),
): Promise<UnsubscribeEmailAlertsResponse> {
  const verified = verifyToken(token, "unsubscribe", { now });
  if (!verified) throw invalidLink("unsubscribe");
  if (await turnOff(verified.userId, verified.nonce)) return { state: "OFF" };
  // Nothing changed: either alerts are already off (fine) or this is a link from an earlier period.
  const pref = await getDb().notificationPref.findUnique({
    where: { userId: verified.userId },
    select: { emailState: true },
  });
  if (pref && pref.emailState !== "OFF") throw invalidLink("unsubscribe");
  return { state: "OFF" };
}
