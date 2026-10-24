import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";

type FieldFrameProps = {
  label: string;
  help?: ReactNode;
  error?: string | null;
  className?: string;
};

type Wired = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

function useWiring(error: string | null | undefined, help: ReactNode) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, help ? helpId : null].filter(Boolean).join(" ");
  const wired: Wired = {
    id,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": error ? true : undefined,
  };
  return { id, helpId, errorId, wired };
}

function Frame({
  id,
  helpId,
  errorId,
  label,
  help,
  error,
  className,
  children,
}: FieldFrameProps & { id: string; helpId: string; errorId: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="t-label text-ink">
        {label}
      </label>
      {children}
      {help ? (
        <p id={helpId} className="t-caption">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="t-label text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "box-border w-full rounded-field border border-line-strong bg-surface-100 text-ink text-[15px] leading-[22px] placeholder:text-ink-muted aria-[invalid=true]:border-critical focus:outline-2 focus:outline-offset-1 focus:outline-brand disabled:opacity-60";

type InputProps = Omit<ComponentProps<"input">, "id"> &
  FieldFrameProps & { leadingIcon?: ReactNode; mono?: boolean };

export function Input({ label, help, error, className, leadingIcon, mono, ...rest }: InputProps) {
  const { id, helpId, errorId, wired } = useWiring(error, help);
  return (
    <Frame {...{ id, helpId, errorId, label, help, error, className }}>
      <div className="relative">
        {leadingIcon ? (
          <span className="text-ink-muted pointer-events-none absolute top-3 left-3">
            {leadingIcon}
          </span>
        ) : null}
        <input
          {...wired}
          {...rest}
          className={cn(
            CONTROL,
            "h-11 px-3",
            leadingIcon ? "pl-10" : undefined,
            mono && "font-mono",
          )}
        />
      </div>
    </Frame>
  );
}

export function Textarea({
  label,
  help,
  error,
  className,
  ...rest
}: Omit<ComponentProps<"textarea">, "id"> & FieldFrameProps) {
  const { id, helpId, errorId, wired } = useWiring(error, help);
  return (
    <Frame {...{ id, helpId, errorId, label, help, error, className }}>
      <textarea {...wired} rows={3} {...rest} className={cn(CONTROL, "px-3 py-2")} />
    </Frame>
  );
}

export function Select({
  label,
  help,
  error,
  className,
  children,
  ...rest
}: Omit<ComponentProps<"select">, "id"> & FieldFrameProps) {
  const { id, helpId, errorId, wired } = useWiring(error, help);
  return (
    <Frame {...{ id, helpId, errorId, label, help, error, className }}>
      <select {...wired} {...rest} className={cn(CONTROL, "h-11 px-3")}>
        {children}
      </select>
    </Frame>
  );
}

export function Checkbox({
  label,
  className,
  ...rest
}: Omit<ComponentProps<"input">, "type"> & { label: ReactNode }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-center gap-3 text-[15px]", className)}>
      <input type="checkbox" className="accent-brand size-[18px]" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({
  label,
  description,
  className,
  ...rest
}: Omit<ComponentProps<"input">, "type" | "role"> & { label: string; description?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-4 py-4", className)}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="t-label text-ink">{label}</span>
        {description ? <span className="t-caption">{description}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="bg-line-strong after:bg-surface-100 checked:bg-brand relative h-[26px] w-11 flex-none cursor-pointer appearance-none rounded-full transition-colors after:absolute after:top-[3px] after:left-[3px] after:size-5 after:rounded-full after:transition-transform after:content-[''] checked:after:translate-x-[18px]"
        {...rest}
      />
    </label>
  );
}
