import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "./test-db";

let db: TestDb;

beforeAll(async () => {
  db = await startTestDb();
}, 120_000);

afterAll(async () => {
  await db?.stop();
});

describe("0001_init migration", () => {
  it("creates the job table with snake_case columns", async () => {
    const { rows } = await db.pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'job'",
    );
    const names = rows.map((r) => r.column_name);
    expect(names).toEqual(expect.arrayContaining(["run_after", "max_attempts", "locked_by"]));
  });

  it("generates text ids in the database for rows the worker inserts", async () => {
    const { rows } = await db.pool.query(
      "INSERT INTO job (type, payload) VALUES ('DEV_NOOP', '{}') RETURNING id",
    );
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("lets two connections claim different jobs with SKIP LOCKED", async () => {
    await db.pool.query("DELETE FROM job");
    await db.pool.query(
      "INSERT INTO job (type, payload) VALUES ('DEV_NOOP', '{}'), ('DEV_NOOP', '{}')",
    );
    const claim = "SELECT id FROM job WHERE status = 'QUEUED' FOR UPDATE SKIP LOCKED LIMIT 1";
    const a = await db.pool.connect();
    const b = await db.pool.connect();
    try {
      await a.query("BEGIN");
      await b.query("BEGIN");
      const first = await a.query(claim);
      const second = await b.query(claim);
      expect(first.rows[0].id).not.toBe(second.rows[0].id);
    } finally {
      await a.query("ROLLBACK");
      await b.query("ROLLBACK");
      a.release();
      b.release();
    }
  });
});
