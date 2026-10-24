import { cn } from "./cn";

export function Spinner({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <svg
      role="status"
      aria-label={label}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      className={cn("text-brand size-5 flex-none animate-spin", className)}
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
