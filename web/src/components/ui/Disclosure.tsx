import type { ReactNode } from "react";

/** Native details/summary: keyboard and screen reader support for free. */
export function Disclosure({
  summary,
  children,
  defaultOpen,
}: {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="rounded-control bg-surface-200 px-4 py-3">
      <summary className="t-label text-brand min-h-6 cursor-pointer">{summary}</summary>
      <div className="t-body mt-2">{children}</div>
    </details>
  );
}
