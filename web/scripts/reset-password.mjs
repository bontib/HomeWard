// Sets a new password for one user and signs them out everywhere.
// Usage: node scripts/reset-password.mjs <email> <new-password>
// In Docker: docker compose exec web node scripts/reset-password.mjs <email> <new-password>
// Uses Better Auth's own password hasher, so the normal login accepts the new password.
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

const MIN_LENGTH = 12;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [email, newPassword] = process.argv.slice(2);
if (!email || !newPassword) fail("Usage: node scripts/reset-password.mjs <email> <new-password>");
if (newPassword.length < MIN_LENGTH)
  fail(`The password must have at least ${MIN_LENGTH} characters.`);
if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set.");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const user = await client.query("SELECT id FROM app_user WHERE lower(email) = lower($1)", [
    email,
  ]);
  if (user.rowCount === 0) fail(`No account found for ${email}.`);
  const userId = user.rows[0].id;

  const hash = await hashPassword(newPassword);
  const updated = await client.query(
    "UPDATE account SET password = $1, updated_at = now() WHERE user_id = $2 AND provider_id = 'credential'",
    [hash, userId],
  );
  if (updated.rowCount === 0) fail(`${email} has no password login to reset.`);

  await client.query("DELETE FROM session WHERE user_id = $1", [userId]);
  await client.query("COMMIT");
  console.log(`Password changed for ${email}. They are signed out everywhere.`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  throw err;
} finally {
  await client.end();
}
