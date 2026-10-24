// Product search (ADR 0002, architecture section 4.8): reads the cache the worker fills.
// A miss or a stale entry queues one SEARCH_PRODUCTS job; the browser polls this route.
import type { Prisma } from "@/generated/prisma/client";
import type { ProductOption, ProductSearchResponse } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { AppError } from "./errors";

const MAX_QUEUED_SEARCHES = 10;
const MAX_PRODUCTS = 8;

type Tx = Prisma.TransactionClient;

/**
 * One statement decides whether this request must queue a fetch. It returns a row only when
 * the search is new, or old enough to refresh (ready for 30 days, failed for a minute,
 * pending for 2 minutes). Two tabs typing the same word queue one job.
 */
async function claimSearch(tx: Tx, query: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ query: string }[]>`
    INSERT INTO product_search (query, status, requested_at)
    VALUES (${query}, 'PENDING', now())
    ON CONFLICT (query) DO UPDATE
      SET status = 'PENDING', requested_at = now()
      WHERE (product_search.status = 'READY'   AND product_search.fetched_at   < now() - interval '30 days')
         OR (product_search.status = 'FAILED'  AND product_search.requested_at < now() - interval '1 minute')
         OR (product_search.status = 'PENDING' AND product_search.requested_at < now() - interval '2 minutes')
    RETURNING query`;
  return rows.length > 0;
}

async function queueSearch(tx: Tx, query: string): Promise<void> {
  const queued = await tx.job.count({ where: { type: "SEARCH_PRODUCTS", status: "QUEUED" } });
  // Throwing rolls back the claim above, so the next try can queue the search.
  if (queued >= MAX_QUEUED_SEARCHES) {
    throw new AppError("RATE_LIMITED", "Search is busy. Try again in a minute.");
  }
  const jobId = await enqueueJob(tx, { type: "SEARCH_PRODUCTS", payload: { query } });
  await tx.productSearch.update({ where: { query }, data: { jobId } });
}

export async function searchProducts(query: string): Promise<ProductSearchResponse> {
  return getDb().$transaction(async (tx) => {
    if (await claimSearch(tx, query)) await queueSearch(tx, query);

    const search = await tx.productSearch.findUniqueOrThrow({ where: { query } });
    const known = await tx.cpeProduct.findMany({ where: { cpe: { in: search.cpes } } });
    const byCpe = new Map(known.map((p) => [p.cpe, p]));
    const products: ProductOption[] = search.cpes.slice(0, MAX_PRODUCTS).flatMap((cpe) => {
      const p = byCpe.get(cpe);
      return p
        ? [{ cpe: p.cpe, title: p.title, vendor: p.vendor, latestVersion: p.latestVersion }]
        : [];
    });
    return { query, status: search.status, products };
  });
}
