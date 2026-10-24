# 0002 NVD only in the worker; product search through a cache and a job

Status: accepted (V1). Confirms D6. Supersedes plan section 10, Phase 5 ("web calls the NVD CPE search directly").

## Context
NVD allows 5 requests per 30 s without a key. If both containers call NVD, neither can keep to the limit. Product search is interactive: the user types "xbox" and expects options.

## Decision
- All NVD, CISA KEV and Trivy access is in the worker. One NVD client with one shared rate limiter.
- `GET /api/products?q=` reads `product_search` (one row per normalized query, holding the ordered CPE list) and `cpe_product`.
  - Fresh row (READY, under 30 days): answer `READY` at once.
  - Missing, stale, failed over 1 minute ago, or pending over 2 minutes: one `INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING` marks it `PENDING`; only the request that gets a row back queues `SEARCH_PRODUCTS` (priority 20, fast lane, one attempt).
  - More than 10 searches queued: `429`.
- The browser polls the same URL every second while `PENDING`. After 10 s it shows "Search is taking longer than usual. Try again in a minute." (P5-2).
- `CHECK_DEVICE` caches each product's CVEs (`cpe_product_cve`, raw NVD configurations on `vulnerability`) for 7 days, which also covers the 7-day CVE refresh (P8-2).

## Consequences
- The first search for a new word takes the time of one NVD call plus up to 1 s of polling. Repeat searches are instant, for every user.
- Search shares the NVD budget with checks. A separate fast lane means a long check does not hold search back; the limiter can still make it wait a few seconds without a key.
- One more job type and one more table. No HTTP between web and worker.
- Typing creates at most one job per distinct normalized word after the 300 ms debounce.
