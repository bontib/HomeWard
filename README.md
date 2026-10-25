# HomeGuard

A self-hosted vulnerability tracker for home networks. Add your devices (console, PC, TV,
smart home) with a software version, or upload an SBOM, and see which known security
problems (CVEs) affect them. A simple home version of OWASP Dependency-Track.

Runs on a NAS or any Linux box with Docker. Three containers: `web`, `worker`, `db`.

Disk: plan for about 2 GB free. The Trivy vulnerability database alone is about 1 GB (it
lives in the `trivy-cache` volume), plus the images and your data.

## Install

1. Copy `.env.example` to `.env`.
2. Set `BETTER_AUTH_SECRET` (at least 32 random characters: `openssl rand -base64 32`),
   and `BETTER_AUTH_URL` (the address you open the app at).
   Change the database password in `POSTGRES_PASSWORD` too. The default (`homeguard`) is
   fine for a first try, but change it before anyone else can reach the machine.
3. `docker compose up -d --build`. This builds the images on your machine from this
   folder, so it works without any published image. The first build takes several minutes.
   The web container refuses to start, with a clear message in `docker compose logs web`,
   if `BETTER_AUTH_SECRET` is shorter than 32 characters or `DATABASE_URL` is wrong.
4. Open http://localhost:3000 and create the first account.
5. Sign-up is open to anyone who can reach the app. When everyone in the home has an
   account, set `ALLOW_SIGNUP=false` in `.env` and run `docker compose up -d` again.

If you open the app by another address (for example `http://192.168.1.20:3000`), list it in
`TRUSTED_ORIGINS` (requests from other addresses are refused). Only set `TRUSTED_PROXY=true`
if a reverse proxy you control sits in front. An optional free NVD API key (`NVD_API_KEY`) makes lookups faster.

The first start downloads the Trivy database and the CISA list of exploited CVEs. Until
then, SBOM checks wait and retry.

## Update

Building is the default. Fetch the new code, then rebuild:

```
git pull
docker compose up -d --build
```

Once a release exists you can pull tagged images instead: set `HOMEGUARD_OWNER` and
`HOMEGUARD_TAG` in `.env`, then run `docker compose pull && docker compose up -d`.

The web container applies database changes on start and stops if one fails. Web and worker
are released together with the same tag.

## Back up

```
docker compose exec db pg_dump -U homeguard homeguard > homeguard-backup.sql
```

Restore into an empty database (a fresh install, before you create accounts):

```
docker compose exec -T db psql -U homeguard -d homeguard < homeguard-backup.sql
```

If you changed `POSTGRES_USER` or `POSTGRES_DB` in `.env`, use those names. The `db-data` volume holds everything; the
`trivy-cache` volume can be rebuilt and does not need a backup.

## Reset a password

```
# Make up a password and print it once:
docker compose exec web node /app/tools/scripts/reset-password.mjs you@example.com --generate
# Or type your own at a hidden prompt:
docker compose exec -it web node /app/tools/scripts/reset-password.mjs you@example.com
```

The password is never a command-line argument, so it stays out of your shell history.
It needs at least 12 characters. The user is signed out everywhere.

## Daily checks

The worker re-checks all devices every night (`RESCAN_CRON`, default `0 3 * * *`, in the
time zone `TZ`). If the machine was off at that time, it catches up at the next start.
Run exactly one worker.

## Email alerts (optional)

HomeGuard can email each person about new problems: a mail right away for a new Critical
problem (at most one per hour), and a daily summary at 7 am of new Critical and Vulnerable
problems (only on days when there is something new). Nothing is mailed about problems a person
already had when they turned alerts on. No email does not mean a device is safe.

1. In `.env`, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` and, if your mail server needs a login,
   both `SMTP_USER` and `SMTP_PASSWORD`. Only the worker reads these; the web container never
   sees them. Set `TZ` to your own time zone: the daily summary goes out at 7 am in `TZ`
   (the default is UTC).
2. `docker compose up -d` again. `docker compose logs worker` shows one line, either
   "Email alerts are on: sending through ..." or "Email alerts are off: ..." with the name of
   the setting to fix. A wrong mail setting never stops the worker.
3. Each person opens Settings > Notifications, turns on "Email me about new problems",
   opens the link in the mail that arrives and presses the button. "Send a test email" proves
   that mail gets through. Mail goes to the address on the account.
4. Every mail has an unsubscribe link, and mail programs show their own unsubscribe button.

Port 465 uses TLS from the first byte, any other port needs STARTTLS. `SMTP_TLS=off` sends mail
unencrypted; use it only for a relay on your own network with no valid certificate. With
`SMTP_USER` and `SMTP_PASSWORD` it is accepted only when `SMTP_HOST` is a loopback or private
IP address (for example `192.168.1.5`); otherwise email alerts stay off and the worker log says why. The links in mails use `BETTER_AUTH_URL`, so it must be an address your phone can
open. Without `SMTP_HOST` the app works as before and the switch in Settings is disabled.

**Set `ALLOW_SIGNUP=false` once everyone has an account.** While sign-up is open and SMTP is
configured, a stranger who can reach the app can create an account with any address and make
HomeGuard send a confirmation mail to it. HomeGuard limits this (3 confirmation mails per
account until alerts are turned off and on again, 3 per address per day, 20 per hour for the whole
app), but closing sign-up removes the risk.

The links in mails carry a signed token in the URL (`/notifications/confirm?token=...`). If you put a
reverse proxy in front, its access log will contain those tokens. Keep that log private. A confirm
link works once and expires after 48 hours; an unsubscribe link only turns alerts off.

Changing `BETTER_AUTH_SECRET` signs everyone out and also stops the links in mails that were
already sent. Settings > Notifications still works. If the worker is restarted after 7 am it may
send that day's summary at start, once. Sending is "at least once": in the rare case that the
worker stops right after the mail server accepted a mail, that mail can arrive twice.

## What HomeGuard can and cannot tell you

Please read this. "No known vulnerabilities" is not "safe".

- It only knows CVEs that NVD and Trivy list. New problems appear in those lists days or
  weeks after they are found, and many devices (TVs, cameras, plugs) are never listed.
- Products without a CPE or package URL show as **Not tracked**. Parts of an SBOM that
  Trivy does not understand are counted as "not checked".
- A device is only matched by the product and version you tell us. A wrong or missing
  version gives no result.
- NVD can say a problem only affects a product on a certain platform. We do not check the
  platform, so you may see a problem that does not apply to you. You can ignore it.
- CVEs that NVD has not analysed yet (no product list) cannot be matched.
- Memory has not been measured yet. Trivy scans and database updates need more memory
  than idle; expect a few hundred MB extra for a short time.
- It does not scan your network, install agents or fix anything.

## Development

```
cd web && npm install && npm run db:dev      # Postgres on :54329 without Docker
cd web && npx prisma migrate deploy && npm run dev
cd worker && cargo run
cd worker && cargo test && cargo clippy -- -D warnings
```

For worker tests that need a database set `TEST_DATABASE_URL` to any database on a server
where the user may create databases (each test creates its own). See `docs/architecture-v1.md`.
