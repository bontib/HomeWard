import Link from "next/link";
import type { DeviceSummary } from "@/lib/contracts";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/components/ui/cn";
import { timeAgo, vendorName } from "@/features/common/format";
import { jobErrorText } from "@/features/jobs/messages";
import { deviceLevel, type DisplayLevel } from "@/features/risk/display";
import { RiskBadge } from "@/features/risk/RiskBadge";
import { DeviceIcon } from "./DeviceIcon";
import { VersionTag } from "./VersionTag";

const COUNT_COLOR: Partial<Record<DisplayLevel, string>> = {
  critical: "text-critical",
  vulnerable: "text-vulnerable",
  update: "text-update",
};

export function deviceMeta(device: Pick<DeviceSummary, "product" | "room">): string {
  const { product, room } = device;
  return [product?.vendor ? vendorName(product.vendor) : null, product?.name, room]
    .filter(Boolean)
    .join(" · ");
}

function footerText(device: DeviceSummary): string {
  if (device.check.state === "CHECKING") return "Checking…";
  if (device.check.state === "FAILED") return jobErrorText(device.check.errorCode);
  const n = device.openFindingCount;
  if (n > 0) return `${n} known ${n === 1 ? "vulnerability" : "vulnerabilities"}`;
  if (device.status === "NOT_TRACKED") return "We can't check this one yet";
  if (device.uncheckedCount > 0) {
    return `${device.uncheckedCount} ${device.uncheckedCount === 1 ? "part" : "parts"} not checked`;
  }
  return "";
}

export function DeviceCard({ device }: { device: DeviceSummary }) {
  const checking = device.check.state === "CHECKING";
  const level = checking ? "pending" : deviceLevel(device.status);
  const hasOpen = device.openFindingCount > 0 && !checking;
  const version = device.product?.version ?? null;

  return (
    <Link
      href={`/devices/${device.id}`}
      className="rounded-card border-line bg-surface-100 text-ink shadow-rest hover:text-ink hover:shadow-pop flex flex-col gap-3 border p-4 no-underline transition-shadow"
    >
      <span className="flex items-center gap-3">
        <DeviceIcon type={device.type} />
        <span className="min-w-0 flex-1">
          <span className="t-heading block">{device.name}</span>
          <span className="t-caption block truncate">{deviceMeta(device)}</span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <RiskBadge level={level} />
        {checking ? <Spinner label="Checking" className="size-4" /> : null}
        <VersionTag current={version} target={device.targetVersion} />
      </span>
      <span className="border-line flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span
          className={cn(
            "text-[13px] leading-[18px] font-semibold",
            hasOpen ? COUNT_COLOR[level] : "text-ink-muted",
          )}
        >
          {footerText(device)}
        </span>
        <span className="t-caption">
          {device.lastCheckedAt ? `Checked ${timeAgo(device.lastCheckedAt)}` : "Not checked yet"}
        </span>
      </span>
    </Link>
  );
}
