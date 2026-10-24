import type { DeviceSummary } from "@/lib/contracts";
import { isNeedsAttention } from "@/features/risk/display";
import { DEVICE_GROUPS } from "./device-types";
import type { DeviceGroup } from "./devicesFilterSlice";

function inGroup(device: DeviceSummary, group: DeviceGroup): boolean {
  if (group === "all") return true;
  if (group === "attention") return isNeedsAttention(device.status);
  return (DEVICE_GROUPS[group] as readonly string[]).includes(device.type);
}

/** Search matches name or room, case-insensitive (backlog P3-3). */
export function filterDevices(
  devices: DeviceSummary[],
  search: string,
  group: DeviceGroup,
): DeviceSummary[] {
  const needle = search.trim().toLowerCase();
  return devices.filter((device) => {
    if (!inGroup(device, group)) return false;
    if (!needle) return true;
    return (
      device.name.toLowerCase().includes(needle) ||
      (device.room ?? "").toLowerCase().includes(needle)
    );
  });
}

export function countInGroup(devices: DeviceSummary[], group: DeviceGroup): number {
  return devices.filter((d) => inGroup(d, group)).length;
}
