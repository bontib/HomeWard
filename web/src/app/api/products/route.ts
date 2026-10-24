import { ProductSearchQuerySchema } from "@/lib/contracts";
import { searchProducts } from "@/server/products";
import { json, parseQuery, route, withSession } from "@/server/http";

export const GET = route(async (req) => {
  const { userId } = await withSession(req);
  const { q } = parseQuery(req, ProductSearchQuerySchema);
  return json(await searchProducts(userId, q));
});
