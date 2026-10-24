import type { DeviceDetail } from "@/lib/contracts";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card, type CardTone } from "@/components/ui/Card";
import { RiskBadge } from "@/features/risk/RiskBadge";
import { formatDate } from "@/features/common/format";
import { DEVICE_TYPES } from "./device-types";

const TONE: Partial<Record<DeviceDetail["status"], CardTone>> = {
  CRITICAL: "critical",
  VULNERABLE: "vulnerable",
  UPDATE_AVAILABLE: "update",
};

const LABEL_COLOR: Partial<Record<DeviceDetail["status"], string>> = {
  CRITICAL: "text-critical",
  VULNERABLE: "text-vulnerable",
  UPDATE_AVAILABLE: "text-update",
};

/** Why a device is "Not tracked", in words a home user can act on. */
export function notTrackedReason(device: DeviceDetail): string {
  const product = device.product;
  if (!product || !product.cpe) {
    return "We don't have public security data for this device yet. Pick it from the list when you edit it, and we'll check it.";
  }
  if (!product.version) return "Add the version it runs, and we'll check it.";
  if (product.check === "BAD_VERSION")
    return "We can't compare this version. Check that you typed it as shown on the device.";
  return "We can't check this device yet.";
}

export function WhatToDoCard({
  device,
  onUpdated,
  onEdit,
}: {
  device: DeviceDetail;
  /** "I've updated it": opens the version editor. */
  onUpdated: () => void;
  onEdit: () => void;
}) {
  const info = DEVICE_TYPES[device.type];

  if (device.openFindingCount > 0) {
    const title = device.targetVersion
      ? `Update ${device.name} to ${device.targetVersion}`
      : "Check the maker's website for an update";
    return (
      <Card
        tone={TONE[device.status] ?? "plain"}
        aria-labelledby="todo-heading"
        className="flex flex-col gap-4"
      >
        <div>
          <p className={`t-label ${LABEL_COLOR[device.status] ?? ""}`}>What to do</p>
          <h2 id="todo-heading" className="t-title">
            {title}
          </h2>
          <p className="t-body text-ink-muted">
            {device.targetVersion
              ? "Update to this version to fix the problems below."
              : "No fix is listed yet. Look for a newer version from the maker, and check again later."}
          </p>
        </div>
        <ol className="t-body m-0 flex list-decimal flex-col gap-2 pl-6">
          <li>{info.versionHelp}</li>
          <li>
            Choose Check for update (or the same wording) and install it. Wait until the device
            restarts.
          </li>
          <li>Come back here and tap &quot;I&apos;ve updated it&quot;.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onUpdated}>I&apos;ve updated it</Button>
        </div>
        <Banner>
          Can&apos;t update right now? Turn it off, or keep it off the internet, until you can.
        </Banner>
      </Card>
    );
  }

  if (device.status === "NOT_TRACKED") {
    return (
      <Card aria-labelledby="todo-heading" className="flex flex-col gap-3">
        <RiskBadge level="unknown" className="w-fit" />
        <h2 id="todo-heading" className="t-title">
          We can&apos;t check this device yet
        </h2>
        <p className="t-body text-ink-muted">{notTrackedReason(device)}</p>
        <div>
          <Button variant="secondary" onClick={onEdit}>
            Edit device
          </Button>
        </div>
      </Card>
    );
  }

  if (device.status === "NO_KNOWN_VULNS") {
    return (
      <Card aria-labelledby="todo-heading" className="flex flex-col gap-3">
        <RiskBadge level="safe" className="w-fit" />
        <h2 id="todo-heading" className="t-title">
          No known vulnerabilities
        </h2>
        <p className="t-body text-ink-muted">
          {device.lastCheckedAt
            ? `Checked against NVD on ${formatDate(device.lastCheckedAt)}. `
            : "Checked against NVD. "}
          This does not mean the device is safe. New problems are found all the time, so we check
          again regularly.
        </p>
        {device.uncheckedCount > 0 ? (
          <p className="t-body">
            {device.uncheckedCount} {device.uncheckedCount === 1 ? "part" : "parts"} not checked.
            See the software list below.
          </p>
        ) : null}
      </Card>
    );
  }

  return (
    <Card aria-labelledby="todo-heading" className="flex flex-col gap-2">
      <h2 id="todo-heading" className="t-title">
        Waiting for the first check
      </h2>
      <p className="t-body text-ink-muted">We&apos;ll check this device in a moment.</p>
    </Card>
  );
}
