# HomeGuard

A self-hosted vulnerability tracker for home networks. Add your devices (console, PC, TV,
smart home) with a software version, or upload an SBOM, and see which known security
problems (CVEs) affect them. A simple home version of OWASP Dependency-Track.

Runs on a NAS or any Linux box with Docker. Three containers: `web`, `worker`, `db`.

## Install

1. Copy `.env.example` to `.env`.
2. Set `BETTER_AUTH_SECRET` (at least 32 random characters: `openssl rand -base64 32`),
   `BETTER_AUTH_URL` (the address you open the app at) and `HOMEGUARD_OWNER`.
   Change the database password in `POSTGRES_PASSWORD` too.
3. `docker compose up -d`
4. Open http://localhost:3000 and create the first account.
5. When everyone in the home has an account, set `ALLOW_SIGNUP=false` and run
   `docker compose up -d` again.

If you open the app by another address (for example `http://192.168.1.20:3000`), list it in
`TRUSTED_ORIGINS`. An optional free NVD API key (`NVD_API_KEY`) makes lookups faster.

The first start downloads the Trivy database and the CISA list of exploited CVEs. Until
then, SBOM checks wait and retry.

## Update

```
docker compose pull
docker compose up -d
```

The web container applies database changes on start and stops if one fails. Web and worker
are released together with the same tag.

## Back up

```
docker compose exec db pg_dump -U homeguard homeguard > homeguard-backup.sql
```

Restore into an empty database with `psql`. The `db-data` volume holds everything; the
`trivy-cache` volume can be rebuilt and does not need a backup.

## Reset a password

```
docker compose exec web node /app/tools/scripts/reset-password.mjs you@example.com a-new-password
```

The password needs at least 12 characters. The user is signed out everywhere.

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
- Memory: about 300 MB while idle. A Trivy scan or database update needs a few hundred
  MB more for a short time.
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
