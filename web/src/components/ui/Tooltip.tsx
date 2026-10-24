import { cloneElement, useId, type ReactElement } from "react";

/** Short hint shown on hover and keyboard focus. Not for essential information. */
export function Tooltip({
  text,
  children,
}: {
  text: string;
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      {cloneElement(children, { "aria-describedby": id })}
      <span
        id={id}
        role="tooltip"
        className="rounded-field bg-ink text-surface-100 shadow-pop pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max max-w-60 -translate-x-1/2 px-2 py-1 text-xs group-focus-within:block group-hover:block"
      >
        {text}
      </span>
    </span>
  );
}
