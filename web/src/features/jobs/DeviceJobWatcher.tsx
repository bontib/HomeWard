"use client";
import { useAppDispatch } from "@/store/hooks";
import { invalidateDeviceJob } from "./invalidation";
import { useJobWatcher } from "./useJobWatcher";

/**
 * Renders nothing. Watches one device's check job after a reload and refreshes
 * the device data when it ends.
 */
export function DeviceJobWatcher({ jobId, deviceId }: { jobId: string; deviceId: string }) {
  const dispatch = useAppDispatch();
  useJobWatcher(jobId, () => {
    dispatch(invalidateDeviceJob(deviceId));
  });
  return null;
}
