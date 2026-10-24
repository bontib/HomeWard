# 0003 One place for each cross-boundary contract

Status: accepted (V1).

## Context
TypeScript and Rust both read and write job payloads, enum columns and risk thresholds. No code generation tool fits both without adding a build step we would have to keep running.

## Decision
| Contract | Source of truth | TS side | Rust side | Guard |
|---|---|---|---|---|
| Enum values | `web/prisma/schema.prisma` | Zod enums in `web/src/lib/contracts/enums.ts` | `sqlx::Type` enums in `worker/src/contract.rs` | Vitest compares Zod with the Prisma generated enums; `worker/tests/contract.rs` parses the `enum` blocks in `schema.prisma` |
| Job payloads | `docs/architecture-v1.md` section 4.1 | `JobPayloadSchemas` in `web/src/lib/contracts/jobs.ts` | serde structs in `contract.rs` | Both parse every file in `contracts/jobs/` and reject `contracts/jobs/invalid/` |
| Risk thresholds and device status | `docs/architecture-v1.md` section 5 | `web/src/lib/contracts/risk.ts` | `worker/src/status.rs` | Both run `contracts/risk-levels.json` |
| HTTP API | `docs/architecture-v1.md` section 3 | `web/src/lib/contracts/api.ts` | n/a | Route tests parse responses with the types |

- Payloads carry IDs, not data. The worker reads current rows.
- Error codes cross the boundary as `JobErrorCode`. The UI owns the plain text for each code; internal error text never leaves the `job.error` column.
- A contract change is one PR that touches the doc, both sides and the fixtures. The architect reviews it.

## Consequences
- Small duplication (two enum lists, two status functions), caught by tests in CI on every PR.
- No generator, no shared package between Node and Cargo.
