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
