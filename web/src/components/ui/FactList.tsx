import type { ReactNode } from "react";

export function FactList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-[15px] leading-[22px]">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="t-label text-ink-muted">{item.label}</dt>
          <dd className="m-0 text-right">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
