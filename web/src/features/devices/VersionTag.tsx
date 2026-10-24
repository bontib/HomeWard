import { cn } from "@/components/ui/cn";

function withV(version: string): string {
  return /^\d/.test(version) ? `v${version}` : version;
}

/** Mono tag: "v3.1.0 → 3.1.2". The arrow shows only when we know a fixed version. */
export function VersionTag({
  current,
  target,
  className,
}: {
  current: string | null;
  target?: string | null;
  className?: string;
}) {
  const showTarget = Boolean(current && target && target !== current);
  return (
    <span
      className={cn(
        "rounded-field bg-surface-200 text-ink inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[13px] leading-[18px] font-medium",
        className,
      )}
    >
      <span>{current ? withV(current) : "version ?"}</span>
      {showTarget ? (
        <>
          <span aria-hidden className="text-ink-muted">
            →
          </span>
          <span className="sr-only">update to</span>
          <span className="text-brand">{target}</span>
        </>
      ) : null}
    </span>
  );
}
