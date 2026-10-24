# 0004 The worker owns device status; progress is a separate field

Status: accepted (V1). Changes plan section 5 (`DeviceStatus` without `SCANNING` and `ERROR`).

## Context
Device status depends on findings, scores, KEV flags and which parts could be checked (D7, D8). It changes after a check, after ignore/reopen (P7-5), and after a KEV import. If both web and worker compute it, they drift. The plan also mixes risk (`CRITICAL`) with progress (`SCANNING`, `ERROR`) in one enum, so a failed re-check would hide a known critical problem.

## Decision
- `device.status` is risk only: `PENDING`, `CRITICAL`, `VULNERABLE`, `UPDATE_AVAILABLE`, `NO_KNOWN_VULNS`, `NOT_TRACKED`.
- Progress is `device.check_state` (`IDLE`, `CHECKING`, `FAILED`) plus `check_job_id` and `check_error_code`. Web sets `CHECKING` when it queues a check; the worker sets `IDLE` or `FAILED` when that same job ends.
- Only `worker/src/status.rs` writes `status`, `target_version`, `open_finding_count`, `component_count` and `unchecked_count`, in the same transaction as the findings.
- Ignore/reopen in web changes the finding and queues `RECOMPUTE_STATUS` (fast lane); the UI polls that job with the same hook as a check.
- Each component gets a `check` value (`CHECKED`, `NO_IDENTIFIER`, `NO_VERSION`, `BAD_VERSION`, `UNSUPPORTED`) so the UI can say "N parts not checked" and why.
- Phase 3 only, before the worker exists: web sets `NOT_TRACKED` on create. From Phase 5 web always queues `CHECK_DEVICE` and leaves `PENDING`.

## Consequences
- One status implementation, plus the thresholds in `risk.ts` for display, kept equal by a shared fixture (ADR 0003).
- After ignore, the device badge updates about a second later, not in the same response.
- Device lists need no aggregate queries: the counts are columns.
