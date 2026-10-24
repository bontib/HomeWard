# 0001 Postgres is the job queue

Status: accepted (V1). Date: 2026-10-24.

## Context
Web and worker must talk only through Postgres (CLAUDE.md). Jobs must be picked up within a second (P4-1), survive missed notifies (D17), retry 3 times with 1 and 5 minute waits (D18), time out after 10 minutes, and never stay `RUNNING` after a crash. A NAS has little memory, so Trivy must not run twice at once.

## Decision
- Web inserts a `job` row and calls `pg_notify('jobs', id)` in the same transaction as the data it belongs to (`enqueueJob` in `web/src/lib/jobs.ts`).
- The worker listens on `jobs` and also polls every 30 s. It claims with one `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, ordered by `priority DESC, run_after, created_at`. `attempts` is counted at claim time.
- Two lanes, one job at a time each: **fast** (`SEARCH_PRODUCTS`, `RECOMPUTE_STATUS`, `DEV_NOOP`) and **slow** (`CHECK_DEVICE`, `RESCAN_ALL`, `UPDATE_TRIVY_DB`, `IMPORT_KEV`).
- Per-type timeout with `tokio::time::timeout`; Trivy is spawned with `kill_on_drop`.
- Retry: `QUEUED` again with `run_after = now() + 1 min`, then `+ 5 min`. `SBOM_INVALID` and `BAD_PAYLOAD` fail at once. `SEARCH_PRODUCTS` has one attempt.
- Finish updates are guarded by `status = 'RUNNING' AND locked_by = <instance>`.
- A reaper requeues or fails `RUNNING` jobs from other instances at start, and jobs older than 15 minutes every 30 s, with code `WORKER_LOST`.
- Device-level dedupe: web reuses a `QUEUED` check job instead of adding another (`device.check_job_id`).
- The cron schedule runs inside the worker (`croner`), with a catch-up run after the NAS was off.
- Exactly one worker container.
- Job types: `CHECK_DEVICE`, `RECOMPUTE_STATUS`, `SEARCH_PRODUCTS`, `RESCAN_ALL`, `UPDATE_TRIVY_DB`, `IMPORT_KEV`, `DEV_NOOP`. `CHECK_DEVICE` replaces the plan's `MATCH_CPE` and `SCAN_SBOM`: one device check covers the manual product and the SBOM, so "Check again" is one job and one poll.

## Consequences
- No broker, no extra container. Queue state is visible with plain SQL.
- Handlers must be safe to run twice. They do outside calls first, then write one device's results in one short transaction that locks the device row.
- The `job` table grows; finished jobs older than 30 days are deleted during `RESCAN_ALL`.
- Running two workers is safe for claims, but start-up reaping may retry the other worker's job once. We document "one worker".
- Details: `docs/architecture-v1.md` section 4.
