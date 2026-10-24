import { cn } from "./cn";

export type ChipItem<T extends string> = { value: T; label: string; count?: number };

/** Filter chips. Each is a toggle button; exactly one is pressed. */
export function Chips<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: ChipItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={item.value === value}
          onClick={() => onChange(item.value)}
          className={cn(
            "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[13px] leading-[18px] font-semibold",
            item.value === value
              ? "border-ink bg-ink text-surface-100"
              : "border-line bg-surface-100 text-ink hover:border-line-strong",
          )}
        >
          {item.label}
          {item.count !== undefined ? <span aria-hidden>· {item.count}</span> : null}
          {item.count !== undefined ? <span className="sr-only">({item.count})</span> : null}
        </button>
      ))}
    </div>
  );
}
