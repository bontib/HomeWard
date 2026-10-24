"use client";
import type { DeviceSummary } from "@/lib/contracts";
import { Banner } from "@/components/ui/Banner";
import { LinkButton } from "@/components/ui/Button";
import { Chips, type ChipItem } from "@/components/ui/Chips";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/icons";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/features/common/QueryStates";
import { DeviceJobWatcher } from "@/features/jobs/DeviceJobWatcher";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { AddDeviceTile } from "./AddDeviceTile";
import { DeviceCard } from "./DeviceCard";
import { useListDevicesQuery } from "./devicesApi";
import {
  groupChanged,
  searchChanged,
  selectGroup,
  selectSearch,
  type DeviceGroup,
} from "./devicesFilterSlice";
import { countInGroup, filterDevices } from "./filterDevices";
import { NetworkSummary } from "./NetworkSummary";

function chipItems(devices: DeviceSummary[]): ChipItem<DeviceGroup>[] {
  return [
    { value: "all", label: "All", count: devices.length },
    { value: "attention", label: "Needs attention", count: countInGroup(devices, "attention") },
    { value: "consoles", label: "Game consoles" },
    { value: "media", label: "TV & media" },
    { value: "computers", label: "Computers" },
    { value: "smartHome", label: "Smart home" },
  ];
}

function WorstDeviceBanner({ device }: { device: DeviceSummary }) {
  return (
    <Banner
      variant="critical"
      title={`${device.name} needs an update now`}
      action={
        <LinkButton href={`/devices/${device.id}`} variant="danger">
          Fix now
        </LinkButton>
      }
    >
      {device.targetVersion
        ? `Update to ${device.targetVersion} to fix this.`
        : "Check the maker's website for an update."}
    </Banner>
  );
}

export function HomeScreen({ firstName }: { firstName: string }) {
  const dispatch = useAppDispatch();
  const search = useAppSelector(selectSearch);
  const group = useAppSelector(selectGroup);
  const { data, error, isLoading, refetch } = useListDevicesQuery();
  const devices = data?.devices ?? [];
  const visible = filterDevices(devices, search, group);
  const worst = devices.find((d) => d.status === "CRITICAL");

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-8">
      <PageHeader
        title="My home"
        subtitle={firstName ? `Hello, ${firstName}` : undefined}
        actions={
          <LinkButton href="/devices/new">
            <Icon name="plus" className="size-4" /> Add a device
          </LinkButton>
        }
      />

      {isLoading ? <LoadingBlock label="Loading your devices…" /> : null}
      {error ? <ErrorBlock error={error} onRetry={refetch} /> : null}

      {data && devices.length === 0 ? (
        <EmptyState
          icon="home"
          title="No devices yet"
          action={<LinkButton href="/devices/new">Add your first device</LinkButton>}
        >
          Add a console, TV, PC or smart home device with its software version, and we&apos;ll check
          it for known problems.
        </EmptyState>
      ) : null}

      {devices.length > 0 ? (
        <>
          <NetworkSummary devices={devices} />
          {worst ? <WorstDeviceBanner device={worst} /> : null}

          <section aria-labelledby="devices-heading" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 id="devices-heading" className="t-heading">
                Devices · {visible.length}
              </h2>
              <Input
                label="Find a device"
                type="search"
                leadingIcon={<Icon name="search" />}
                value={search}
                onChange={(e) => dispatch(searchChanged(e.target.value))}
                className="w-full sm:w-72"
              />
            </div>
            <Chips
              label="Filter devices"
              items={chipItems(devices)}
              value={group}
              onChange={(g) => dispatch(groupChanged(g))}
            />
            {visible.length === 0 ? (
              <p className="t-body text-ink-muted">
                No devices match. Try a different search or filter.
              </p>
            ) : null}
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-0">
              {visible.map((device) => (
                <li key={device.id} className="flex flex-col [&>a]:flex-1">
                  <DeviceCard device={device} />
                </li>
              ))}
              <li className="flex flex-col [&>a]:flex-1">
                <AddDeviceTile />
              </li>
            </ul>
          </section>
        </>
      ) : null}

      {devices.map((d) =>
        d.check.state === "CHECKING" && d.check.jobId ? (
          <DeviceJobWatcher key={d.id} jobId={d.check.jobId} deviceId={d.id} />
        ) : null,
      )}
    </div>
  );
}
