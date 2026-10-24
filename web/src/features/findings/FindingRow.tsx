"use client";
import { ErrorText } from "@/components/ui/ErrorText";
import Link from "next/link";
import { useState } from "react";
import type { DeviceFinding, DeviceType } from "@/lib/contracts";
import { Button } from "@/components/ui/Button";
import { CveItem } from "@/features/vulnerabilities/CveItem";
import { errorMessage } from "@/store/api";
import { IgnoreFindingDialog } from "./IgnoreFindingDialog";
import { useUpdateFindingMutation } from "./findingsApi";

/** A CveItem with Ignore / Reopen. Used on device pages and in the vulnerabilities list. */
export function FindingRow({
  finding,
  deviceId,
  device,
}: {
  finding: DeviceFinding;
  deviceId: string;
  /** Pass to show which device the problem is on. */
  device?: { id: string; name: string; type: DeviceType };
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [update, { isLoading, error, reset }] = useUpdateFindingMutation();
  const ignored = finding.state === "IGNORED";
  const target = { id: finding.id, deviceId, vulnerabilityId: finding.vulnerability.id };

  async function ignore(reason: string) {
    const result = await update({ ...target, body: { state: "IGNORED", reason } });
    if (!("error" in result)) setDialogOpen(false);
  }

  return (
    <>
      <CveItem
        vulnerability={finding.vulnerability}
        productName={finding.component.name}
        fixedVersion={finding.fixedVersion}
        ignored={ignored}
        ignoredReason={finding.ignoredReason}
        meta={
          device ? (
            <p className="t-caption">
              On <Link href={`/devices/${device.id}`}>{device.name}</Link>
            </p>
          ) : null
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {ignored ? (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Reopen ${finding.vulnerability.id}`}
                disabled={isLoading}
                onClick={() => update({ ...target, body: { state: "OPEN" } })}
              >
                Reopen
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Ignore ${finding.vulnerability.id}`}
                onClick={() => setDialogOpen(true)}
              >
                Ignore
              </Button>
            )}
            {ignored && error ? <ErrorText>{errorMessage(error)}</ErrorText> : null}
          </div>
        }
      />
      <IgnoreFindingDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          reset();
        }}
        onConfirm={ignore}
        busy={isLoading}
        serverError={dialogOpen ? error : null}
      />
    </>
  );
}
