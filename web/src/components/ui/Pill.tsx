import type { ComponentProps } from "react";
import { cn } from "./cn";

export function Pill({ brand, className, ...rest }: ComponentProps<"span"> & { brand?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs leading-4 font-semibold whitespace-nowrap",
        brand ? "bg-brand-tint text-brand" : "bg-surface-200 text-ink",
        className,
      )}
      {...rest}
    />
  );
}
