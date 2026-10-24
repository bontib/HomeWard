import type { DeviceType } from "@/lib/contracts";
import { Svg } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";
import { DEVICE_TYPES } from "./device-types";

export function DeviceIcon({
  type,
  size = "md",
  className,
}: {
  type: DeviceType;
  size?: "md" | "lg";
  className?: string;
}) {
  const info = DEVICE_TYPES[type];
  return (
    <span
      role="img"
      aria-label={info.label}
      className={cn(
        "rounded-control bg-surface-200 text-ink inline-grid flex-none place-items-center",
        size === "lg" ? "size-14" : "size-11",
        className,
      )}
    >
      <Svg paths={info.paths} className={size === "lg" ? "size-[30px]" : "size-6"} />
    </span>
  );
}
