import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "md" | "sm";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-brand text-on-brand hover:bg-brand-hover",
  secondary: "bg-surface-100 text-ink border-line-strong hover:bg-surface-200",
  quiet: "border-transparent bg-transparent text-brand hover:bg-brand-tint",
  danger: "border-transparent bg-critical text-on-critical hover:opacity-90",
};

const SIZE: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 py-3",
  sm: "min-h-9 px-3 py-1.5",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(
    "inline-flex cursor-pointer items-center justify-center gap-2 rounded-control border text-[13px] leading-[18px] font-semibold no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant, size, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

type LinkButtonProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };

export function LinkButton({ variant, size, className, ...rest }: LinkButtonProps) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

/** Square 44 px button with only an icon. `label` is its accessible name. */
export function IconButton({
  label,
  className,
  children,
  type = "button",
  ...rest
}: Omit<ComponentProps<"button">, "aria-label"> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-control text-ink-muted hover:bg-surface-200 hover:text-ink grid size-11 cursor-pointer place-items-center border-0 bg-transparent",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
