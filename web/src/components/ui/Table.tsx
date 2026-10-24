import type { ComponentProps } from "react";
import { cn } from "./cn";

/** Scrolls sideways inside its box on small screens. */
export function Table({ className, ...rest }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table
        className={cn("w-full border-collapse text-[15px] leading-[22px]", className)}
        {...rest}
      />
    </div>
  );
}

export function Th({ className, ...rest }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "border-line text-ink-muted border-b px-4 pb-3 text-left text-xs leading-4 font-semibold whitespace-nowrap",
        className,
      )}
      {...rest}
    />
  );
}

export function Td({ className, ...rest }: ComponentProps<"td">) {
  return <td className={cn("border-line border-b px-4 py-3 align-middle", className)} {...rest} />;
}
