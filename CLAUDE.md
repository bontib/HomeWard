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

## Designs
- `docs/design/homeguard/` (screenshots in `screens/`, tokens and markup in `source/`) shows how the screens could look. It is a reference, not a strict spec.
- The plan's requirements win over the designs. The `ux-designer` agent may adjust screens, flows and copy to match the plan (scope, non-goals, honest "Not tracked" wording). Record each change in `docs/design/` and section 9 of the plan.
- Keep the visual language (tokens, type, icons, component style) unless there is a reason to change it.

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
| Visual design                 | `frontend-design`, starting from `docs/design/homeguard/`   |

## Agents
Team roles live in `.claude/agents/`:
| Agent                 | Role                                                              |
|-----------------------|-------------------------------------------------------------------|
| `product-owner`       | Stories, acceptance criteria, scope, backlog (`docs/backlog.md`)  |
| `architect`           | Designs per phase, guards architecture rules, ADRs (`docs/adr/`)  |
| `backend-engineer`    | Prisma, API routes, `src/server/`, auth, Rust worker              |
| `frontend-engineer`   | Pages, components, tokens, Redux / RTK Query                      |
| `ux-designer`         | Flows, screen specs, copy, accessibility (`docs/design/`)         |
| `e2e-tester`          | Playwright tests in `web/e2e/`                                    |
| `security-researcher` | Code review for security bugs only. No pentests, no fixes         |

## Commands
```bash
docker compose up -d --build     # whole stack (build is the default install path, no published images yet)
docker compose up -d db          # dev database only
cd web && npm run db:dev         # dev database without Docker (embedded Postgres, port 54329)
cd web && npm run dev            # web on :3000
cd web && npx prisma migrate dev # new migration
cd web && npm run lint && npm run typecheck && npm test && npm run build
cd web && npm run e2e            # Playwright; starts its own Postgres, mock NVD, fake Trivy and the real worker (E2E_SKIP_BUILD=1 reuses .next)
cd worker && cargo run           # worker
cd worker && cargo test && cargo clippy --all-targets -- -D warnings   # set REQUIRE_DB_TESTS=1 so DB tests cannot skip silently
```

## Working rules learned in V1
- Design docs to read first: `docs/architecture-v1.md` (schema, API contract, job protocol, file ownership) and `docs/adr/`. They override the older plan where they differ. Acceptance state: `docs/v1-acceptance.md`.
- Sandboxes may have no Docker or Postgres. Use `npm run db:dev` (embedded Postgres) and `npm run e2e`. Say clearly what could not be run (compose, arm64, memory, real Trivy/NVD) instead of claiming it works.
- Parallel work: split by the ownership table in `docs/architecture-v1.md` section 6.1. Shared code lives only in `web/src/lib/contracts/`; backend changes it, frontend reviews. Freeze schema + contracts before starting both tracks.
- Subagents do not `git commit`; the lead commits after checking. Git identity is set per repo, never global.
- Pin versions that `latest` would break (Prisma 7.10, TypeScript 5.9). Do not reformat `package.json` or the lockfile.
- Honesty rules in the UI: a pending, checking, unchecked or not-tracked device must never read as safe. No check mark on "No known vulnerabilities". Every error and risk has an icon plus text.
- Security defaults that bit us: never trust client `X-Forwarded-For` (rate limits); check `Origin` on all state-changing routes and require `application/json`; validate `?next=` redirects with URL parsing; cap request bodies and JSON depth; per-user limits on jobs and devices; CSP and frame headers; secrets passed per service, not one `env_file` for all; no passwords on the command line.
- Worker SQL gotchas: quote reserved words (`check`), open sessions in UTC (Prisma `timestamp(3)` has no zone), delete stale rows by id not by timestamp comparison, make every job safe to run twice.
- Check a finished feature in a real browser and with `npm run e2e`, not only unit tests. Unit tests passed while empty states still read as "safe".
- Running `next dev` writes `web/AGENTS.md`; it is disabled in `next.config.ts` (`agentRules: false`). Delete it if it appears.
