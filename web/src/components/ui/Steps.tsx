import { cn } from "./cn";
import { Icon } from "./icons";

export type Step = { label: string; state: "done" | "now" | "todo" };

export function Steps({ steps, label = "Progress" }: { steps: Step[]; label?: string }) {
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-wrap gap-2 p-0">
      {steps.map((step, i) => (
        <li
          key={step.label}
          aria-current={step.state === "now" ? "step" : undefined}
          className={cn(
            "flex items-center gap-2 pr-4 text-[13px] font-semibold",
            step.state === "now" ? "text-ink" : "text-ink-muted",
          )}
        >
          <span
            className={cn(
              "grid size-7 place-items-center rounded-full border-[1.5px] text-[13px] font-bold",
              step.state === "done" && "border-brand bg-brand text-on-brand",
              step.state === "now" && "border-brand text-brand",
              step.state === "todo" && "border-line-strong text-ink-muted",
            )}
          >
            {step.state === "done" ? <Icon name="check" className="size-4" /> : i + 1}
          </span>
          {step.label}
          {step.state === "done" ? <span className="sr-only"> (done)</span> : null}
        </li>
      ))}
    </ol>
  );
}
