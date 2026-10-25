import { cn } from "./cn";

/** Stroke icon on a 24x24 grid, 1.75 stroke, round caps (see the design system). */
export function Svg({
  paths,
  className,
  title,
}: {
  paths: readonly string[];
  className?: string;
  /** Leave out when the icon sits next to text. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-5 flex-none", className)}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const ICONS = {
  home: ["M3 11l9-8 9 8", "M5 10v10h5v-6h4v6h5V10"],
  plus: ["M12 5v14", "M5 12h14"],
  search: ["M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0", "M20 20l-4-4"],
  settings: [
    "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
    "M12 2v3",
    "M12 19v3",
    "M2 12h3",
    "M19 12h3",
    "M5 5l2 2",
    "M17 17l2 2",
    "M19 5l-2 2",
    "M7 17l-2 2",
  ],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  signOut: ["M9 4H5v16h4", "M16 8l4 4-4 4", "M20 12H9"],
  chevronLeft: ["M15 5l-7 7 7 7"],
  chevronRight: ["M9 5l7 7-7 7"],
  alert: ["M12 3l10 18H2z", "M12 10v4", "M12 17.5h.01"],
  info: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M12 11v5", "M12 7.5h.01"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M18 14v6H4V6h6"],
  upload: ["M12 16V4", "M7 9l5-5 5 5", "M4 16v4h16v-4"],
  check: ["M5 12.5l4.5 4.5L19 7"],
  x: ["M6 6l12 12", "M18 6L6 18"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  shield: ["M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"],
  shieldCheck: ["M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z", "M8.5 12l2.5 2.5 4.5-5"],
  refresh: ["M20 11a8 8 0 0 0-14-4L4 9", "M4 4v5h5", "M4 13a8 8 0 0 0 14 4l2-2", "M20 20v-5h-5"],
  file: ["M6 3h8l4 4v14H6z", "M14 3v4h4"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
  bell: ["M6 16V11a6 6 0 0 1 12 0v5l2 2H4z", "M10 21h4"],
  clock: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M12 7v5l3 2"],
  dashCircle: ["M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M8 12h8"],
  // Same shape as the Critical badge, so "critical" looks the same everywhere.
  critical: ["M8 2h8l6 6v8l-6 6H8l-6-6V8z", "M12 7v6", "M12 16.5h.01"],
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  className,
  title,
}: {
  name: IconName;
  className?: string;
  title?: string;
}) {
  return <Svg paths={ICONS[name]} className={className} title={title} />;
}
