import type { JobView } from "@/lib/contracts";
import { api } from "@/store/api";

export const jobsApi = api.injectEndpoints({
  endpoints: (build) => ({
    getJob: build.query<{ job: JobView }, string>({
      query: (id) => `jobs/${id}`,
    }),
  }),
});

export const { useGetJobQuery } = jobsApi;
