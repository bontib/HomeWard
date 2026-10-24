import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icons";

/** An error line with an icon, so a problem never relies on color alone. */
export function ErrorText({
  children,
  id,
  className,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <p
      id={id}
      role="alert"
      className={cn("t-label text-critical flex items-start gap-1.5", className)}
    >
      <Icon name="alert" className="mt-px size-4" />
      <span>{children}</span>
    </p>
  );
}
