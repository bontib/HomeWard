import { cn } from "./cn";

export function Segmented<T extends string>({
  legend,
  name,
  items,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  items: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
      <legend className="sr-only">{legend}</legend>
      {items.map((item) => (
        <label
          key={item.value}
          className={cn(
            "rounded-control box-border flex min-h-11 cursor-pointer items-center gap-2 border px-4 text-[13px] font-semibold",
            item.value === value
              ? "border-brand bg-brand-tint text-brand"
              : "border-line bg-surface-100",
          )}
        >
          <input
            type="radio"
            name={name}
            value={item.value}
            checked={item.value === value}
            onChange={() => onChange(item.value)}
            className="accent-brand m-0"
          />
          {item.label}
        </label>
      ))}
    </fieldset>
  );
}
