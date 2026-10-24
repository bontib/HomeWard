"use client";
import { ErrorText } from "@/components/ui/ErrorText";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FactList } from "@/components/ui/FactList";
import { BackLink } from "@/features/common/BackLink";
import { formatDate, timeAgo } from "@/features/common/format";
import { ErrorBlock, LoadingBlock } from "@/features/common/QueryStates";
import { FindingRow } from "@/features/findings/FindingRow";
import { ScanProgress } from "@/features/jobs/ScanProgress";
import { invalidateDeviceJob } from "@/features/jobs/invalidation";
import { jobErrorText } from "@/features/jobs/messages";
import { useJobWatcher } from "@/features/jobs/useJobWatcher";
import { deviceLevel } from "@/features/risk/display";
import { RiskBadge } from "@/features/risk/RiskBadge";
import { isNotFound, errorMessage } from "@/store/api";
import { useAppDispatch } from "@/store/hooks";
import { DeviceIcon } from "./DeviceIcon";
import { EditDeviceDialog } from "./EditDeviceDialog";
import { RemoveDeviceDialog } from "./RemoveDeviceDialog";
import { SoftwareCard } from "./SoftwareCard";
import { VersionTag } from "./VersionTag";
import { WhatToDoCard } from "./WhatToDoCard";
import { useGetDeviceQuery, useScanDeviceMutation } from "./devicesApi";
import { DEVICE_TYPES } from "./device-types";

export function DeviceDetailScreen({ id }: { id: string }) {
  const dispatch = useAppDispatch();
  const { data, error, isLoading, refetch } = useGetDeviceQuery(id);
  const [scan, { isLoading: starting, error: scanError }] = useScanDeviceMutation();
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const device = data?.device;
  const { job } = useJobWatcher(device?.check.jobId ?? null, () => {
    dispatch(invalidateDeviceJob(id));
  });

  if (isLoading) return <LoadingBlock label="Loading this device…" />;
  if (error && isNotFound(error)) {
    return (
      <div className="mx-auto flex max-w-[1040px] flex-col gap-4">
        <BackLink href="/">My home</BackLink>
        <EmptyState icon="info" title="We couldn't find that device.">
          It may have been removed.
        </EmptyState>
      </div>
    );
  }
  if (error || !device) return <ErrorBlock error={error} onRetry={refetch} />;

  const checking = device.check.state === "CHECKING";
  const level = checking ? "pending" : deviceLevel(device.status);
  const openFindings = device.findings.filter((f) => f.state === "OPEN");
  const ignored = device.findings.filter((f) => f.state === "IGNORED");
  const meta = [DEVICE_TYPES[device.type].label, device.room].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-6">
      <BackLink href="/">My home</BackLink>

      <header className="flex flex-wrap items-start gap-4">
        <DeviceIcon type={device.type} size="lg" />
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="t-page">{device.name}</h1>
          <p className="t-body text-ink-muted">{meta}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <RiskBadge level={level} />
            <VersionTag current={device.product?.version ?? null} target={device.targetVersion} />
            <span className="t-caption">
              {device.lastCheckedAt
                ? `Checked ${timeAgo(device.lastCheckedAt)}`
                : "Not checked yet"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditOpen(true)}>
            Edit device
          </Button>
          <Button variant="secondary" disabled={checking || starting} onClick={() => void scan(id)}>
            Check again
          </Button>
        </div>
      </header>

      {checking ? <ScanProgress job={job} /> : null}
      {device.check.state === "FAILED" ? (
        <ErrorText>{jobErrorText(device.check.errorCode)}</ErrorText>
      ) : null}
      {scanError ? <ErrorText>{errorMessage(scanError)}</ErrorText> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <WhatToDoCard
            device={device}
            onUpdated={() => setEditOpen(true)}
            onEdit={() => setEditOpen(true)}
          />

          <section aria-labelledby="vulns-heading" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="vulns-heading" className="t-heading">
                Known vulnerabilities · {openFindings.length}
              </h2>
              {openFindings.length > 1 ? <span className="t-caption">Worst first</span> : null}
            </div>
            {openFindings.length === 0 ? (
              <p className="t-body text-ink-muted">
                {device.status === "NOT_TRACKED"
                  ? "We can't check this device yet, so we can't list any."
                  : device.status === "PENDING" || device.lastCheckedAt === null
                    ? "We'll list them here after the first check."
                    : "None known as of the last check."}
              </p>
            ) : null}
            {openFindings.map((f) => (
              <FindingRow key={f.id} finding={f} deviceId={device.id} />
            ))}
            {ignored.length > 0 ? (
              <>
                <h3 className="t-label mt-2">Ignored · {ignored.length}</h3>
                {ignored.map((f) => (
                  <FindingRow key={f.id} finding={f} deviceId={device.id} />
                ))}
              </>
            ) : null}
          </section>

          <SoftwareCard device={device} />
        </div>

        <div className="flex flex-col gap-6">
          <Card aria-labelledby="about-heading" className="flex flex-col gap-4">
            <h2 id="about-heading" className="t-heading">
              About this device
            </h2>
            <FactList
              items={[
                { label: "Type", value: DEVICE_TYPES[device.type].label },
                ...(device.product?.vendor
                  ? [{ label: "Brand", value: device.product.vendor }]
                  : []),
                ...(device.product ? [{ label: "Product", value: device.product.name }] : []),
                ...(device.room ? [{ label: "Room", value: device.room }] : []),
                ...(device.product
                  ? [{ label: "Installed", value: <VersionTag current={device.product.version} /> }]
                  : []),
                { label: "Added", value: formatDate(device.createdAt) },
                ...(device.notes ? [{ label: "Notes", value: device.notes }] : []),
              ]}
            />
          </Card>

          <Card aria-labelledby="history-heading" className="flex flex-col gap-3">
            <h2 id="history-heading" className="t-heading">
              Version history
            </h2>
            {device.versionHistory.length === 0 ? (
              <p className="t-caption">No changes yet.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {device.versionHistory.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[13px] font-medium">
                      {h.fromVersion ?? "version ?"} → {h.toVersion ?? "version ?"}
                    </span>
                    <span className="t-caption">{formatDate(h.changedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Button variant="secondary" onClick={() => setRemoveOpen(true)}>
            Remove device
          </Button>
        </div>
      </div>

      <EditDeviceDialog open={editOpen} device={device} onClose={() => setEditOpen(false)} />
      <RemoveDeviceDialog open={removeOpen} device={device} onClose={() => setRemoveOpen(false)} />
    </div>
  );
}
