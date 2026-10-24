import type { ReactNode } from "react";
import { Svg } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";
import { LEVEL_LABEL, type DisplayLevel } from "./display";

const ICON: Record<DisplayLevel, string[]> = {
  safe: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M8 12h8"],
  update: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M12 16V8", "M8.5 11.5L12 8l3.5 3.5"],
  vulnerable: ["M12 3l10 18H2z", "M12 10v4", "M12 17.5h.01"],
  critical: ["M8 2h8l6 6v8l-6 6H8l-6-6V8z", "M12 7v6", "M12 16.5h.01"],
  unknown: [
    "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
    "M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14",
    "M12 17.5h.01",
  ],
  pending: ["M12 3a9 9 0 1 0 9 9", "M12 7v5l3 2"],
};

const TONE: Record<DisplayLevel, string> = {
  safe: "bg-safe-tint text-safe",
  update: "bg-update-tint text-update",
  vulnerable: "bg-vulnerable-tint text-vulnerable",
  critical: "bg-critical-tint text-critical",
  unknown: "bg-unknown-tint text-unknown",
  pending: "bg-unknown-tint text-unknown",
};

/** Pill with an icon and words. Never color alone. */
export function RiskBadge({
  level,
  children,
  className,
}: {
  level: DisplayLevel;
  /** Replaces the default label, for example "Exploited in the wild". */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full py-[3px] pr-2.5 pl-2 text-[13px] leading-[18px] font-semibold",
        TONE[level],
        className,
      )}
    >
      <Svg paths={ICON[level]} className="size-3.5" />
      {children ?? LEVEL_LABEL[level]}
    </span>
  );
}
