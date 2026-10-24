import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage } from "@/store/api";

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="text-ink-muted flex items-center gap-3 py-8">
      <Spinner label={label} />
      <span className="t-body">{label}</span>
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-card border-critical bg-critical-tint flex flex-col items-start gap-3 border p-6"
    >
      <p className="t-heading">We couldn&apos;t load this.</p>
      <p className="t-body">{errorMessage(error)}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {subtitle ? <p className="t-caption">{subtitle}</p> : null}
        <h1 className="t-page">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
