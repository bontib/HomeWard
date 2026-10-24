"use client";
import { ErrorText } from "@/components/ui/ErrorText";
import { useState } from "react";
import type { ComponentCheck, ComponentView, DeviceDetail } from "@/lib/contracts";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FileDrop } from "@/components/ui/FileDrop";
import { Table, Td, Th } from "@/components/ui/Table";
import { LoadingBlock } from "@/features/common/QueryStates";
import { cveLevel } from "@/features/risk/display";
import { RiskBadge } from "@/features/risk/RiskBadge";
import { errorMessage } from "@/store/api";
import { useListComponentsQuery, useUploadSbomMutation } from "./devicesApi";
import { SbomHelp } from "./SbomHelp";

const MAX_SBOM_BYTES = 20 * 1024 * 1024;
const PAGE_SIZE = 50;

const WHY_NOT_CHECKED: Record<ComponentCheck, string | null> = {
  CHECKED: null,
  PENDING: "Waiting to be checked.",
  NO_IDENTIFIER: "The file doesn't say which product this is.",
  NO_VERSION: "No version listed.",
  BAD_VERSION: "We can't compare this version.",
  UNSUPPORTED: "We can't check this kind of software yet.",
};

function ComponentStatus({ component }: { component: ComponentView }) {
  if (component.check !== "CHECKED") {
    return (
      <div className="flex flex-col gap-1">
        <RiskBadge level="unknown" className="w-fit" />
        <span className="t-caption">{WHY_NOT_CHECKED[component.check]}</span>
      </div>
    );
  }
  if (component.worstLevel) {
    const { level, label } = cveLevel(component.worstLevel);
    return (
      <RiskBadge level={level}>
        {label} · {component.openFindingCount}
      </RiskBadge>
    );
  }
  return <RiskBadge level="safe" />;
}

function ComponentTable({ components }: { components: ComponentView[] }) {
  const [shown, setShown] = useState(PAGE_SIZE);
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <caption className="sr-only">Software on this device</caption>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Version</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {components.slice(0, shown).map((c) => (
            <tr key={c.id}>
              <Td>{c.name}</Td>
              <Td className="font-mono text-[13px]">{c.version ?? "version ?"}</Td>
              <Td>
                <ComponentStatus component={c} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {components.length > shown ? (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setShown((n) => n + PAGE_SIZE)}>
            Show more ({components.length - shown} left)
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** "Software on this device": SBOM upload, help, and the list of parts. */
export function SoftwareCard({ device }: { device: DeviceDetail }) {
  const { data, isLoading } = useListComponentsQuery(device.id);
  const [upload, { isLoading: uploading, error }] = useUploadSbomMutation();
  const components = data?.components ?? [];
  const checking = device.check.state === "CHECKING";

  return (
    <Card aria-labelledby="software-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="software-heading" className="t-heading">
          Software on this device
        </h2>
        <p className="t-body text-ink-muted">
          For a PC or other computer, add a software list so we can check every program, not just
          one.
        </p>
      </div>

      {device.sbom ? (
        <p className="t-caption">
          Last file: <span className="font-mono">{device.sbom.fileName}</span>
        </p>
      ) : null}

      <FileDrop
        label={device.sbom ? "Replace the software list" : "Add a software list"}
        hint="CycloneDX or SPDX file in JSON format, up to 20 MB."
        accept=".json,application/json"
        maxBytes={MAX_SBOM_BYTES}
        busy={uploading || checking}
        onFile={(file) => void upload({ id: device.id, file })}
      />
      {error ? <ErrorText>{errorMessage(error)}</ErrorText> : null}
      <SbomHelp />

      {device.uncheckedCount > 0 ? (
        <p className="t-label">
          {device.uncheckedCount} {device.uncheckedCount === 1 ? "part" : "parts"} not checked. We
          can&apos;t say anything about them yet.
        </p>
      ) : null}
      {isLoading ? <LoadingBlock label="Loading the software list…" /> : null}
      {components.length > 0 ? <ComponentTable components={components} /> : null}
    </Card>
  );
}
