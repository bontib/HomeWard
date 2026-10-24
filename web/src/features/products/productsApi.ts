import type { ProductSearchResponse } from "@/lib/contracts";
import { api } from "@/store/api";

export const productsApi = api.injectEndpoints({
  endpoints: (build) => ({
    searchProducts: build.query<ProductSearchResponse, string>({
      query: (q) => `products?q=${encodeURIComponent(q)}`,
    }),
  }),
});

export const { useSearchProductsQuery } = productsApi;
