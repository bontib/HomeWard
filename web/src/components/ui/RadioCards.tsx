import type { ReactNode } from "react";
import { cn } from "./cn";

export type RadioCardOption = { value: string; title: string; description?: ReactNode };

export function RadioCards({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: RadioCardOption[];
  value: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "rounded-control flex min-h-11 cursor-pointer items-center gap-3 border px-4 py-3",
            option.value === value ? "border-brand bg-brand-tint" : "border-line bg-surface-100",
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            className="accent-brand m-0 size-[18px] flex-none"
          />
          <span className="flex min-w-0 flex-col">
            <span className="t-body font-semibold">{option.title}</span>
            {option.description ? <span className="t-caption">{option.description}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
