import type { DeviceType } from "@/lib/contracts";
import { Svg } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";
import { DEVICE_TYPES, DEVICE_TYPE_ORDER } from "./device-types";

export function DeviceTypePicker({
  value,
  onChange,
}: {
  value: DeviceType | null;
  onChange: (type: DeviceType) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Device type"
      className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2"
    >
      {DEVICE_TYPE_ORDER.map((type) => (
        <button
          key={type}
          type="button"
          aria-pressed={value === type}
          onClick={() => onChange(type)}
          className={cn(
            "rounded-control flex min-h-11 cursor-pointer flex-col items-center gap-2 border px-2 py-4 text-[13px] leading-[18px] font-semibold",
            value === type
              ? "border-brand bg-brand-tint text-brand"
              : "border-line bg-surface-100 text-ink hover:border-line-strong",
          )}
        >
          <Svg paths={DEVICE_TYPES[type].paths} className="size-7" />
          {DEVICE_TYPES[type].label}
        </button>
      ))}
    </div>
  );
}
