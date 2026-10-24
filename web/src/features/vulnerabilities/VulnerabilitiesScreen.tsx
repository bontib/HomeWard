"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { riskLevel } from "@/lib/contracts";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { Table, Td, Th } from "@/components/ui/Table";
import { countOf } from "@/features/common/format";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/features/common/QueryStates";
import { useListDevicesQuery } from "@/features/devices/devicesApi";
import { cveLevel } from "@/features/risk/display";
import { RiskBadge } from "@/features/risk/RiskBadge";
import { cveTitle } from "./CveItem";
import { LEVELS, type VulnerabilityFilters } from "./filters";
import { useListVulnerabilitiesQuery, type VulnerabilityListArgs } from "./vulnerabilitiesApi";

/** The URL is the single source of truth for filters, so links and reloads keep them. */
export function VulnerabilitiesScreen({ filters }: { filters: VulnerabilityFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const args: VulnerabilityListArgs = filters;
  const { data, error, isLoading, refetch } = useListVulnerabilitiesQuery(args);
  const { data: deviceData } = useListDevicesQuery();

  function setFilter(next: Partial<VulnerabilityFilters>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    if (merged.deviceId) params.set("deviceId", merged.deviceId);
    if (merged.level) params.set("level", merged.level);
    if (merged.state !== "OPEN") params.set("state", merged.state);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  const findings = data?.findings ?? [];
  const filtered = Boolean(filters.deviceId || filters.level);

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-6">
      <PageHeader
        title="Vulnerabilities"
        subtitle="Known security problems on your devices, worst first"
      />

      <div className="flex flex-wrap items-end gap-4">
        <Select
          label="Device"
          value={filters.deviceId ?? ""}
          onChange={(e) => setFilter({ deviceId: e.target.value || undefined })}
          className="w-full sm:w-64"
        >
          <option value="">All devices</option>
          {(deviceData?.devices ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select
          label="How serious"
          value={filters.level ?? ""}
          onChange={(e) => setFilter({ level: LEVELS.find((l) => l === e.target.value) })}
          className="w-full sm:w-48"
        >
          <option value="">All</option>
          <option value="critical">Critical</option>
          <option value="vulnerable">Vulnerable</option>
          <option value="low">Low</option>
        </Select>
        <Segmented
          legend="Show problems that are"
          name="state"
          value={filters.state}
          onChange={(state) => setFilter({ state })}
          items={[
            { value: "OPEN", label: "Open" },
            { value: "IGNORED", label: "Ignored" },
          ]}
        />
      </div>

      {isLoading ? <LoadingBlock label="Loading vulnerabilities…" /> : null}
      {error ? <ErrorBlock error={error} onRetry={refetch} /> : null}

      {data && findings.length === 0 ? (
        <EmptyState
          icon="info"
          title={
            filters.state === "IGNORED" ? "Nothing ignored" : "No known problems at the last check."
          }
        >
          {filtered ? "Try removing a filter. " : ""}
          {data.notFullyCheckedDeviceCount > 0
            ? `${countOf(data.notFullyCheckedDeviceCount, "device", "devices")} can't be fully checked, so this list may be incomplete.`
            : "That only means nothing is known yet. New problems are found all the time."}
        </EmptyState>
      ) : null}

      {findings.length > 0 ? (
        <Card className="p-4">
          <Table>
            <caption className="sr-only">Open security problems, worst first</caption>
            <thead>
              <tr>
                <Th>Device</Th>
                <Th>Problem</Th>
                <Th>How serious</Th>
                <Th>Fixed in</Th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => {
                const { level, label } = cveLevel(riskLevel(f.vulnerability));
                return (
                  <tr key={f.id}>
                    <Td>
                      <Link href={`/devices/${f.device.id}`}>{f.device.name}</Link>
                    </Td>
                    <Td>
                      <Link
                        href={`/vulnerabilities/${encodeURIComponent(f.vulnerability.id)}`}
                        className="font-mono text-[13px]"
                      >
                        {f.vulnerability.id}
                      </Link>
                      <div className="t-caption">{cveTitle(f.component.name)}</div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <RiskBadge level={level}>{label}</RiskBadge>
                        {f.vulnerability.exploited ? (
                          <RiskBadge level="critical">Exploited in the wild</RiskBadge>
                        ) : null}
                      </div>
                    </Td>
                    <Td className="font-mono text-[13px]">
                      {f.fixedVersion ?? "No fix known yet"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {data && data.notFullyCheckedDeviceCount > 0 ? (
            <p className="t-caption mt-3">
              {countOf(data.notFullyCheckedDeviceCount, "device", "devices")} can&apos;t be fully
              checked.
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
