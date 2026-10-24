import type { ReactNode } from "react";
import type { DeviceSummary } from "@/lib/contracts";
import { cn } from "@/components/ui/cn";
import { countOf, timeAgo } from "@/features/common/format";
import { deviceLevel, LEVEL_LABEL, type DisplayLevel } from "@/features/risk/display";

const ORDER: DisplayLevel[] = ["critical", "vulnerable", "update", "safe", "unknown", "pending"];

const FILL: Record<DisplayLevel, string> = {
  critical: "bg-critical",
  vulnerable: "bg-vulnerable",
  update: "bg-update",
  safe: "bg-safe",
  unknown: "bg-line-strong",
  pending: "bg-line",
};

export type LevelCounts = Record<DisplayLevel, number>;

export function countLevels(devices: DeviceSummary[]): LevelCounts {
  const counts: LevelCounts = {
    critical: 0,
    vulnerable: 0,
    update: 0,
    safe: 0,
    unknown: 0,
    pending: 0,
  };
  for (const device of devices) counts[deviceLevel(device.status)] += 1;
  return counts;
}

/** One honest headline. The word "safe" is not used (decision D4). */
export function summaryHeadline(counts: LevelCounts, hasUncheckedParts = false): string {
  if (counts.critical > 0) {
    return counts.critical === 1
      ? "1 device needs fixing now"
      : `${counts.critical} devices need fixing now`;
  }
  if (counts.vulnerable > 0) {
    return counts.vulnerable === 1
      ? "1 device is vulnerable"
      : `${counts.vulnerable} devices are vulnerable`;
  }
  if (counts.update > 0) return "Some updates are waiting";
  if (counts.safe > 0) {
    const allChecked = counts.unknown === 0 && counts.pending === 0 && !hasUncheckedParts;
    return allChecked
      ? "No known problems on your devices"
      : "No known problems on the devices we could check";
  }
  if (counts.pending > 0) return "Checking your devices…";
  return "We can't check these devices yet";
}

export function NetworkSummary({
  devices,
  action,
}: {
  devices: DeviceSummary[];
  action?: ReactNode;
}) {
  const counts = countLevels(devices);
  const lastChecked = devices
    .map((d) => d.lastCheckedAt)
    .filter((t): t is string => t !== null)
    .sort()
    .at(-1);
  const withUncheckedParts = devices.filter(
    (d) => d.status !== "NOT_TRACKED" && d.uncheckedCount > 0,
  ).length;
  const partial = counts.unknown + withUncheckedParts;
  const visible = ORDER.filter((level) => level !== "pending" || counts.pending > 0);
  const barLabel = visible.map((l) => `${counts[l]} ${LEVEL_LABEL[l].toLowerCase()}`).join(", ");

  return (
    <section
      aria-label="Summary"
      className="rounded-card border-line bg-surface-100 shadow-rest flex flex-col gap-4 border p-6"
    >
      <div>
        <p className="t-caption">
          {countOf(devices.length, "device", "devices")} ·{" "}
          {lastChecked ? `checked ${timeAgo(lastChecked)}` : "not checked yet"}
        </p>
        <h2 className="t-display">{summaryHeadline(counts, withUncheckedParts > 0)}</h2>
      </div>
      <div
        role="img"
        aria-label={barLabel}
        className="bg-surface-200 flex h-2.5 gap-0.5 overflow-hidden rounded-full"
      >
        {visible
          .filter((l) => counts[l] > 0)
          .map((l) => (
            <span key={l} className={cn("block", FILL[l])} style={{ flex: counts[l] }} />
          ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-[13px] leading-[18px]">
        {visible.map((l) => (
          <li key={l} className="flex items-center gap-2">
            <span aria-hidden className={cn("size-2.5 rounded-full", FILL[l])} />
            <span>
              <b>{counts[l]}</b> {LEVEL_LABEL[l].toLowerCase()}
            </span>
          </li>
        ))}
      </ul>
      {partial > 0 ? (
        <p className="t-caption">
          {countOf(partial, "device", "devices")} can&apos;t be fully checked. &quot;No known
          vulnerabilities&quot; only means nothing is known yet. It does not mean a device is safe.
        </p>
      ) : (
        <p className="t-caption">
          &quot;No known vulnerabilities&quot; only means nothing is known yet. It does not mean a
          device is safe.
        </p>
      )}
      {action}
    </section>
  );
}
