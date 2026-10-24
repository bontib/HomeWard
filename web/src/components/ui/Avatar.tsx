export function Avatar({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className="bg-surface-200 text-ink grid size-9 flex-none place-items-center rounded-full text-[13px] font-bold"
    >
      {initial}
    </span>
  );
}
