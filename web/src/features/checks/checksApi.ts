import type { ChecksStatus } from "@/lib/contracts";
import { api } from "@/store/api";

export const checksApi = api.injectEndpoints({
  endpoints: (build) => ({
    getChecks: build.query<ChecksStatus, void>({
      query: () => "checks",
      providesTags: ["Checks"],
    }),
    runChecks: build.mutation<{ jobId: string }, void>({
      query: () => ({ url: "checks/run", method: "POST" }),
      invalidatesTags: ["Checks", "DeviceList"],
    }),
  }),
});

export const { useGetChecksQuery, useRunChecksMutation } = checksApi;
