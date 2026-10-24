import { api } from "@/store/api";

/** Tags to refresh once a device job ends (architecture section 3.4). */
export function deviceJobTags(deviceId: string) {
  return [
    { type: "Device" as const, id: deviceId },
    "DeviceList" as const,
    { type: "Components" as const, id: deviceId },
    "Findings" as const,
  ];
}

export function invalidateDeviceJob(deviceId: string) {
  return api.util.invalidateTags(deviceJobTags(deviceId));
}
