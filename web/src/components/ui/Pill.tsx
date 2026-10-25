import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export type PillTone = "neutral" | "brand" | "update" | "critical" | "unknown";

const TONE: Record<PillTone, string> = {
  neutral: "bg-surface-200 text-ink",
  brand: "bg-brand-tint text-brand",
  update: "bg-update-tint text-update",
  critical: "bg-critical-tint text-critical",
  unknown: "bg-unknown-tint text-unknown",
};

/**
 * Small label. `icon` sits before the text; it is hidden from screen readers, so the text
 * must say everything. Use it whenever the tone carries meaning.
 */
export function Pill({
  tone = "neutral",
  icon,
  className,
  children,
  ...rest
}: ComponentProps<"span"> & { tone?: PillTone; icon?: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs leading-4 font-semibold whitespace-nowrap",
        icon ? "pl-2" : undefined,
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span aria-hidden className="inline-flex flex-none [&>svg]:size-3.5">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
