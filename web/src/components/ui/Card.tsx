import type { ComponentProps } from "react";
import { cn } from "./cn";

export type CardTone = "plain" | "critical" | "vulnerable" | "update" | "brand";

const TONE: Record<CardTone, string> = {
  plain: "border-line",
  critical: "border-critical",
  vulnerable: "border-vulnerable",
  update: "border-update",
  brand: "border-brand",
};

export function Card({
  tone = "plain",
  className,
  ...rest
}: ComponentProps<"section"> & { tone?: CardTone }) {
  return (
    <section
      className={cn(
        "rounded-card bg-surface-100 shadow-rest box-border border p-6",
        TONE[tone],
        className,
      )}
      {...rest}
    />
  );
}
