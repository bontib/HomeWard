import type { z } from "zod";
import type {
  ComponentView,
  CreateDeviceSchema,
  DeviceDetail,
  DeviceSummary,
  UpdateDeviceSchema,
} from "@/lib/contracts";
import { api } from "@/store/api";

export type CreateDeviceInput = z.input<typeof CreateDeviceSchema>;
export type UpdateDeviceInput = z.input<typeof UpdateDeviceSchema>;

type DeviceWithJob = { device: DeviceDetail; jobId: string | null };

export const devicesApi = api.injectEndpoints({
  endpoints: (build) => ({
    listDevices: build.query<{ devices: DeviceSummary[] }, void>({
      query: () => "devices",
      providesTags: (result) => [
        "DeviceList",
        ...(result?.devices ?? []).map((d) => ({ type: "Device" as const, id: d.id })),
      ],
    }),
    getDevice: build.query<{ device: DeviceDetail }, string>({
      query: (id) => `devices/${id}`,
      providesTags: (_r, _e, id) => [{ type: "Device", id }],
    }),
    createDevice: build.mutation<DeviceWithJob, CreateDeviceInput>({
      query: (body) => ({ url: "devices", method: "POST", body }),
      invalidatesTags: (result) => [
        "DeviceList",
        ...(result ? [{ type: "Device" as const, id: result.device.id }] : []),
      ],
    }),
    updateDevice: build.mutation<DeviceWithJob, { id: string; body: UpdateDeviceInput }>({
      query: ({ id, body }) => ({ url: `devices/${id}`, method: "PATCH", body }),
      invalidatesTags: (_r, _e, { id }) => ["DeviceList", { type: "Device", id }],
    }),
    deleteDevice: build.mutation<void, string>({
      query: (id) => ({ url: `devices/${id}`, method: "DELETE" }),
      invalidatesTags: ["DeviceList", "Findings", "Checks"],
    }),
    scanDevice: build.mutation<{ jobId: string }, string>({
      query: (id) => ({ url: `devices/${id}/scan`, method: "POST" }),
      invalidatesTags: (_r, _e, id) => [{ type: "Device", id }],
    }),
    uploadSbom: build.mutation<DeviceWithJob & { jobId: string }, { id: string; file: File }>({
      query: ({ id, file }) => {
        const body = new FormData();
        body.append("file", file);
        return { url: `devices/${id}/sbom`, method: "POST", body };
      },
      invalidatesTags: (_r, _e, { id }) => [{ type: "Device", id }],
    }),
    listComponents: build.query<{ components: ComponentView[] }, string>({
      query: (id) => `devices/${id}/components`,
      providesTags: (_r, _e, id) => [{ type: "Components", id }],
    }),
  }),
});

export const {
  useListDevicesQuery,
  useGetDeviceQuery,
  useCreateDeviceMutation,
  useUpdateDeviceMutation,
  useDeleteDeviceMutation,
  useScanDeviceMutation,
  useUploadSbomMutation,
  useListComponentsQuery,
} = devicesApi;
