# Contract fixtures

Files that both the web tests (Vitest) and the worker tests (cargo) read, so the two sides cannot drift apart. No code here. See `docs/adr/0003-cross-boundary-contracts.md`.

- `jobs/<JOB_TYPE>.json`: one valid payload per job type. Both sides must accept it.
- `jobs/invalid/<JOB_TYPE>.<reason>.json`: payloads both sides must reject.
- `risk-levels.json`: `levels` (score, severity, exploited -> level) and `deviceStatus` (open findings and component checks -> device status).
- `notifications.json`: `digestHour`, the local hour of the daily summary (web shows it, worker schedules it).

Change a fixture in the same PR as the code on both sides.
