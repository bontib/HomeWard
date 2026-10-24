# 0006 Images, CI, and verifying without Docker

Status: accepted (V1).

## Context
Images must run on amd64 and arm64 NAS boxes, stay small, and idle under ~512 MB total. Developer and agent sandboxes may have Node and cargo but no Docker and no Postgres.

## Decision
- **Local database without Docker:** `embedded-postgres` (npm, pinned 17.x, real Postgres binaries) as a web dev dependency. `web/scripts/dev-db.mjs` starts it on `127.0.0.1:54329` with data in `web/.devdb/`. Vitest `*.db.test.ts` files start one on a free port. Worker DB tests use `TEST_DATABASE_URL`. Checked in the sandbox: Postgres 17.10 starts, the init migration applies, `SKIP LOCKED` and `LISTEN/NOTIFY` work.
- **Docker for development** stays optional: `docker compose up -d db` keeps working.
- **Images:** both build on `$BUILDPLATFORM`. Web: Next standalone output; Prisma 7 with the pg adapter has no native engine; `images.unoptimized` avoids `sharp`; migrations run in the entrypoint. Worker: `cargo-zigbuild` to static musl for both targets, `rustls`, Alpine runtime with `tzdata`, Trivy copied from a pinned multi-arch `aquasec/trivy` image.
- **Compose:** `db` (tuned for small memory), `web`, `worker`; health checks on all three; the worker starts after `web` is healthy, so migrations have run.
- **CI on every PR:** web (validate, migration drift check, typecheck, lint, Vitest with a Postgres service, build) and worker (fmt, clippy `-D warnings`, tests with `REQUIRE_DB_TESTS=1`), plus a grep that forbids DDL in `worker/src`. On tags: multi-arch build and push, then Playwright against compose with an NVD/KEV stub (`NVD_BASE_URL`, `KEV_URL`) and a fake Trivy (`TRIVY_PATH`).

## Consequences
- Anyone with Node 22 can run the full stack and all DB tests. Trivy is not needed locally; its parsing is tested on fixtures.
- Dockerfiles, compose, multi-arch builds and the memory budget can only be checked in CI or on a machine with Docker. Phase 9 owns that check.
- `embedded-postgres` downloads about 30 MB on first install; it is a dev dependency and never ships in an image.
