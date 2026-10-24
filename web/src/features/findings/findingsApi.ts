import type { z } from "zod";
import type { DeviceFinding, UpdateFindingSchema } from "@/lib/contracts";
import { api } from "@/store/api";
import { waitForJob } from "@/features/jobs/waitForJob";

export type UpdateFindingInput = z.input<typeof UpdateFindingSchema>;

type UpdateFindingArg = {
  id: string;
  deviceId: string;
  vulnerabilityId: string;
  body: UpdateFindingInput;
};

export const findingsApi = api.injectEndpoints({
  endpoints: (build) => ({
    updateFinding: build.mutation<{ finding: DeviceFinding; jobId: string }, UpdateFindingArg>({
      query: ({ id, body }) => ({ url: `findings/${id}`, method: "PATCH", body }),
      invalidatesTags: (_r, _e, { deviceId, vulnerabilityId }) => [
        { type: "Device", id: deviceId },
        "Findings",
        { type: "Vulnerability", id: vulnerabilityId },
      ],
      // The status is recalculated by the worker. Refresh the device and list when it is done.
      async onQueryStarted({ deviceId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          await waitForJob(dispatch, data.jobId);
          dispatch(api.util.invalidateTags([{ type: "Device", id: deviceId }, "DeviceList"]));
        } catch {
          // The mutation error is shown by the dialog.
        }
      },
    }),
  }),
});

export const { useUpdateFindingMutation } = findingsApi;
