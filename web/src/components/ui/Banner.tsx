import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icons";

export function Banner({
  variant = "info",
  title,
  children,
  action,
  className,
}: {
  variant?: "info" | "critical";
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-card text-ink flex flex-wrap items-center gap-4 px-6 py-4",
        variant === "critical" ? "bg-critical-tint" : "bg-brand-tint",
        className,
      )}
    >
      <Icon name="info" className={variant === "critical" ? "text-critical" : "text-brand"} />
      <div className="min-w-0 flex-1 basis-60">
        {title ? <p className="t-heading">{title}</p> : null}
        {children ? <div className="t-body">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
