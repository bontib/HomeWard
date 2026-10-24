"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";

/** Modal on the native <dialog>: focus trap, Esc to close and backdrop come from the browser. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      className="rounded-card border-line bg-surface-100 text-ink shadow-pop backdrop:bg-ink/40 m-auto w-[min(32rem,calc(100%-2rem))] border p-0"
    >
      {open ? (
        <div className="flex flex-col gap-4 p-6">
          <h2 id={titleId} className="t-title">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="t-body text-ink-muted">
              {description}
            </p>
          ) : null}
          {children}
          {footer ? <div className="flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
