// Helpers for the mail specs: read the mail sink, and poke the database where a spec needs
// a job that has no button (a full rescan, the daily summary).
import { Client } from "pg";
import { expect } from "@playwright/test";
import { DATABASE_URL, MAIL_SINK_URL } from "./stack";

export type Mail = {
  to: string;
  subject: string;
  headers: Record<string, string>;
  body: string;
};

export async function mailsFor(email: string): Promise<Mail[]> {
  const res = await fetch(`${MAIL_SINK_URL}/messages?to=${encodeURIComponent(email)}`);
  return (await res.json()) as Mail[];
}

/** Waits for a mail to the address whose subject matches, and returns the newest one. */
export async function waitForMail(email: string, subject: RegExp | string): Promise<Mail> {
  const matches = (m: Mail) =>
    typeof subject === "string" ? m.subject === subject : subject.test(m.subject);
  let found: Mail | undefined;
  await expect
    .poll(async () => (found = (await mailsFor(email)).filter(matches).at(-1)), {
      message: `a mail "${subject}" to ${email}`,
    })
    .toBeTruthy();
  return found as Mail;
}

export async function mailsWithSubject(email: string, subject: RegExp): Promise<Mail[]> {
  return (await mailsFor(email)).filter((m) => subject.test(m.subject));
}

/** The first link in the body that contains `pathPart`, as an absolute URL. */
export function linkIn(mail: Mail, pathPart: string): string {
  const match = mail.body.match(
    new RegExp(`https?://\\S*${pathPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\S*`),
  );
  if (!match) throw new Error(`no ${pathPart} link in mail "${mail.subject}":\n${mail.body}`);
  return match[0];
}

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function userIdOf(db: Client, email: string): Promise<string> {
  const { rows } = await db.query('SELECT id FROM app_user WHERE email = $1', [email]);
  return rows[0].id as string;
}

/** Waits until none of this user's jobs is queued or running, twice in a row (a job can queue the next). */
export async function waitForIdle(email: string): Promise<void> {
  let quiet = 0;
  await expect
    .poll(
      async () => {
        const active = await withDb(async (db) => {
          const userId = await userIdOf(db, email);
          const { rows } = await db.query(
            "SELECT count(*)::int AS n FROM job WHERE user_id = $1 AND status IN ('QUEUED','RUNNING')",
            [userId],
          );
          return rows[0].n as number;
        });
        quiet = active === 0 ? quiet + 1 : 0;
        return quiet;
      },
      { message: `jobs of ${email} to finish`, intervals: [500] },
    )
    .toBeGreaterThanOrEqual(2);
}

/** Queues a RESCAN_ALL for one user, like the daily rescan does. */
export async function queueRescan(email: string): Promise<void> {
  await withDb(async (db) => {
    const userId = await userIdOf(db, email);
    const { rows } = await db.query(
      `INSERT INTO job (type, payload, priority, max_attempts, user_id)
       VALUES ('RESCAN_ALL', $1::jsonb, 5, 3, $2) RETURNING id`,
      [JSON.stringify({ userId }), userId],
    );
    await db.query("SELECT pg_notify('jobs', $1)", [rows[0].id]);
  });
}

/** Queues the 07:00 summary job now. */
export async function queueDigest(): Promise<void> {
  await withDb(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO job (type, payload, priority, max_attempts)
       VALUES ('SEND_DIGEST', '{}'::jsonb, 0, 3) RETURNING id`,
    );
    await db.query("SELECT pg_notify('jobs', $1)", [rows[0].id]);
  });
}

/** Waits for the newest SEND_DIGEST job to finish. */
export async function waitForDigestDone(): Promise<void> {
  await expect
    .poll(
      () =>
        withDb(async (db) => {
          const { rows } = await db.query(
            "SELECT status FROM job WHERE type = 'SEND_DIGEST' ORDER BY created_at DESC LIMIT 1",
          );
          return rows[0]?.status;
        }),
      { message: "the summary job to finish" },
    )
    .toMatch(/DONE|FAILED/);
}
