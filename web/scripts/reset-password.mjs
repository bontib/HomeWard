// Sets a new password for one user and signs them out everywhere.
// Usage: node scripts/reset-password.mjs <email> [--generate]
// The password is never a command-line argument (it would land in shell history and `ps`).
// Without --generate it is read from a hidden prompt, or from stdin when piped.
// With --generate a random password is created and printed once.
// In Docker: docker compose exec web node /app/tools/scripts/reset-password.mjs <email> --generate
// Uses Better Auth's own password hasher, so the normal login accepts the new password.
import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

const MIN_LENGTH = 12;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readHidden(prompt) {
  return new Promise((resolve) => {
    process.stderr.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\u0003") process.exit(130); // Ctrl-C
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          return resolve(value);
        }
        if (ch === "\u007f") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function readPiped() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text.replace(/\r?\n$/, "");
}

async function readPassword() {
  if (!process.stdin.isTTY) return readPiped();
  const first = await readHidden("New password: ");
  const second = await readHidden("Repeat it: ");
  if (first !== second) fail("The passwords do not match.");
  return first;
}

const args = process.argv.slice(2);
const generate = args.includes("--generate");
const [email] = args.filter((a) => !a.startsWith("--"));
if (!email) fail("Usage: node scripts/reset-password.mjs <email> [--generate]");
if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set.");

const newPassword = generate ? randomBytes(15).toString("base64url") : await readPassword();
if (newPassword.length < MIN_LENGTH)
  fail(`The password must have at least ${MIN_LENGTH} characters.`);

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
  if (generate) console.log(`New password (shown once): ${newPassword}`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  throw err;
} finally {
  await client.end();
}
