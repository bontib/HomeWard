import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export function EmptyState({
  icon = "shield",
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border-line-strong flex flex-col items-center gap-3 border border-dashed px-6 py-8 text-center">
      <Icon name={icon} className="text-ink-muted size-8" />
      <h2 className="t-heading">{title}</h2>
      {children ? <p className="t-body text-ink-muted max-w-prose">{children}</p> : null}
      {action}
    </div>
  );
}
