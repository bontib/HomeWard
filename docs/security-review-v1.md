# Security review of V1 (commit 86d6dfa)

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | Medium | Login rate limit bypass with a spoofed `X-Forwarded-For` | Fixed |
| 2 | Low | Open redirect in `safeNextPath` (`/\evil.example`, `/<TAB>/evil.example`) | Fixed |
| 3 | Low | CSRF on our own POST/PATCH/DELETE routes | Fixed |
| 4 | Low | Sign-up open by default, no name length limit on the server | Fixed (docs + server limit); `autoSignIn` left as is |
| 5 | Low | No per-user limits on product searches, devices | Fixed |
| 6 | Low | No security headers | Fixed |
| 7 | Low | `reset-password.mjs` took the password as a command-line argument | Fixed |
| 8 | Low | `env_file: .env` gave every container every secret | Fixed |
| 9 | Low | Default database password, containers keep default privileges | Mitigated (README warning, `no-new-privileges`, `cap_drop: ALL` on web and worker) |
| 10 | - | Not in scope for this round | Skipped |
| 11 | Low | NVD and KEV clients followed any redirect and read unbounded bodies | Fixed |
| 12 | Low | Worker trusted `payload.deviceId` without checking `job.device_id` and owner | Fixed |
| 13, 14 | - | Not in scope for this round | Skipped |

## Notes per finding

1. The auth route (`src/app/api/auth/[...all]/route.ts`) removes `X-Forwarded-For`, `X-Real-IP`
   and similar headers before Better Auth sees the request, unless `TRUSTED_PROXY=true`
   (`src/lib/client-ip.ts`). Next.js route handlers cannot read the socket address, so without a
   trusted proxy all clients share one bucket per endpoint (5 sign-ins per minute for the whole
   app). That is strict but cannot be bypassed. `rateLimit.storage: "database"` was not used: it
   needs a `rate_limit` table, which is a schema change; the in-memory store is fine for one web
   container. Tests: `src/lib/client-ip.test.ts`.
2. `safeNextPath` rejects backslashes and control characters, parses with `new URL` against a
   dummy origin, requires the same origin and returns `pathname + search`. Tests:
   `src/lib/safe-next-path.test.ts`.
3. `withSession` (used by every route handler) now calls `assertSameSite`: for non-GET requests
   the `Origin` header must be `BETTER_AUTH_URL` or one of `TRUSTED_ORIGINS`; without `Origin`, a
   `Sec-Fetch-Site` of `cross-site` or `same-site` is refused. Requests with neither header
   (curl, scripts) pass because they cannot carry a victim's cookie. `parseJsonBody` requires
   `Content-Type: application/json`. New error code `FORBIDDEN` (403). People who open the app by
   a LAN address must list it in `TRUSTED_ORIGINS` (already required by Better Auth for login).
   The SBOM upload is multipart and covered by the Origin check. Tests: `src/server/http.test.ts`.
4. `ALLOW_SIGNUP` still defaults to `true`; README and `.env.example` say to set it to `false`
   after creating accounts. Names over 80 characters are refused by a Better Auth database hook
   (create and update). `autoSignIn: false` was skipped: it would change the sign-up flow that
   the frontend is building right now.
5. Product search: at most 3 queued searches per user (`job.user_id` is now set on
   `SEARCH_PRODUCTS`), on top of the global 10. At most 100 devices per user. Queued checks are
   bounded by that, because `enqueueCheck` reuses the waiting job of a device. Tests in
   `src/server/server.db.test.ts`.
6. `next.config.ts` sends CSP, `X-Content-Type-Options`, `Referrer-Policy: same-origin` and
   `X-Frame-Options: DENY`. The CSP needs `'unsafe-inline'` for scripts because Next.js writes
   inline bootstrap scripts (a nonce would make every page dynamic); `'unsafe-eval'` only in
   development. No `upgrade-insecure-requests`, since the app is often served over plain http on
   a LAN. Checked with `next build` and a headless Chromium load of `/login`: no violations,
   styles, scripts and fonts load.
7. `scripts/reset-password.mjs <email>` reads the password from a hidden prompt (use
   `docker compose exec -it`) or from stdin, or `--generate` prints a random one once.
8. Each compose service lists only the variables it uses. One `.env` is still all the user edits.
   `BETTER_AUTH_SECRET` is now required by compose (`:?`).
9. Refusing to start with the default database password would break the first run, so the README
   and `.env.example` warn instead. Web and worker run with `no-new-privileges` and
   `cap_drop: ALL`. The database container is left as the image expects.
11. `src/http_limits.rs`: redirects are followed only within the same host (max 3), bodies are
   read in chunks and cut off at 64 MB (NVD) and 20 MB (KEV), also when `Content-Length` is
   missing or wrong. Tests: `worker/tests/http_limits.rs`.
12. `src/job_guard.rs`: for `CHECK_DEVICE` and `RECOMPUTE_STATUS` the payload `deviceId` must equal
   `job.device_id` (NULL means the device was deleted, so the job is done), and when `job.user_id`
   is set the device must belong to that user. Otherwise the job fails with `BAD_PAYLOAD`.
