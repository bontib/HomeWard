# CLAUDE.md

Self-hosted vulnerability tracker for home networks. Users add their devices (console, PC, TV, smart home) with a software version, or upload an SBOM, and see which CVEs affect them. A simple, home-user version of OWASP Dependency-Track. Runs on a NAS via `docker compose`.

Full plan: `docs/implementation-plan.md`. Read it before starting a new phase.

## Stack
- `web/`: Next.js (App Router, TypeScript strict). UI and API. Better Auth, Prisma, PostgreSQL, Redux Toolkit + RTK Query, Zod, Tailwind.
- `worker/`: Rust (tokio, sqlx, reqwest, serde, tracing). Runs jobs: SBOM parsing, Trivy scans, NVD/CPE matching, scheduled rescans.
- Trivy is the scanner. NVD API 2.0 is the CVE source. We do not build our own scanner.

## Architecture rules
- Web and worker talk **only through Postgres**: insert a `Job` row + `pg_notify('jobs', id)`. The worker claims jobs with `FOR UPDATE SKIP LOCKED`.
- **Prisma owns the schema** and migrations. The worker never runs migrations or changes tables.
- Slow or heavy work (scans, parsing, NVD calls, version matching) goes in the worker. Not in Next.js.
- Every device query filters by the signed-in `userId`.
- "No known vulnerabilities" is not "safe". Products without a CPE/purl are shown as **Not tracked**.

## Web code rules
- Route handler = check session → validate with Zod → call a function in `src/server/` → return JSON. No business logic in route files.
- Pages are thin server components (auth check) that render a client feature component.
- Server data → RTK Query (with tags). Shared UI state → small Redux slice in `src/features/<feature>/`. Form and local state → `useState`. Do not put form state in Redux.
- Reuse components. Primitives live in `src/components/ui/`, domain components in `src/features/<feature>/`. Check for an existing component before writing a new one.
- Style through design tokens (CSS variables). No hard-coded colors. Severity and status always show icon + text, not color alone.

## Rust code rules
- One file per job type in `worker/src/jobs/`.
- Errors: `thiserror` for library modules, `anyhow` only in `main.rs` / job runner. No `unwrap()` outside tests.
- Log with `tracing`, include `job_id` in spans.
- Respect NVD rate limits (5 req/30 s without key, 50 with key). Cache everything.

## Writing style (code and UI)
- Write like a careful programmer: small functions that do one thing, clear names, no clever tricks.
- Prefer simple and boring over abstract. No abstraction until there are two real uses.
- Comments explain *why*, not *what*. Keep them rare.
- UI wording is plain and short for non-technical home users. "Update to 10.2 to fix this", not "Remediation available".
- Tests for logic: version/CPE matching, SBOM parsing, Trivy output parsing, `src/server/` functions. Use fixtures, never call the real NVD API in tests.

## Skills to use
| Work on                       | Skill                                                       |
|-------------------------------|-------------------------------------------------------------|
| Rust code                     | `rust-best-practices`, `rust-engineer`, `rust-async-patterns` |
| Database schema / SQL         | `supabase-postgres-best-practices`                          |
| Prisma                        | `prisma-orm-setup`, `prisma-client-api`, `prisma-cli`        |
| Auth                          | `better-auth-best-practices`, `better-auth-security-best-practices` |
| Next.js / React               | `nextjs-app-router-patterns`, `vercel-react-best-practices`, `next-dev-loop` |
| Component structure           | `vercel-composition-patterns`                               |
| Redux                         | `build-modern-redux-apps-modern-redux`, `model-redux-state-*`, `manage-server-data-adopt-rtk-query` |
| Visual design                 | `frontend-design` (until the official designs arrive)       |

## Commands
Fill these in as the project is scaffolded (Phase 0).
```bash
docker compose up -d db          # dev database
cd web && npm run dev            # web on :3000
cd web && npx prisma migrate dev # new migration
cd worker && cargo run           # worker
cd worker && cargo test && cargo clippy -- -D warnings
```
