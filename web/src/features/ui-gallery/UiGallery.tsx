"use client";
import { useState, type ReactNode } from "react";
import type { DeviceType } from "@/lib/contracts";
import { Avatar } from "@/components/ui/Avatar";
import { Banner } from "@/components/ui/Banner";
import { Button, IconButton, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chips } from "@/components/ui/Chips";
import { Dialog } from "@/components/ui/Dialog";
import { Disclosure } from "@/components/ui/Disclosure";
import { EmptyState } from "@/components/ui/EmptyState";
import { FactList } from "@/components/ui/FactList";
import { Checkbox, Input, Select, Switch, Textarea } from "@/components/ui/Field";
import { FileDrop } from "@/components/ui/FileDrop";
import { Icon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { RadioCards } from "@/components/ui/RadioCards";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/Spinner";
import { Steps } from "@/components/ui/Steps";
import { Table, Td, Th } from "@/components/ui/Table";
import { Tooltip } from "@/components/ui/Tooltip";
import { AddDeviceTile } from "@/features/devices/AddDeviceTile";
import { DeviceCard } from "@/features/devices/DeviceCard";
import { DeviceIcon } from "@/features/devices/DeviceIcon";
import { DeviceTypePicker } from "@/features/devices/DeviceTypePicker";
import { NetworkSummary } from "@/features/devices/NetworkSummary";
import { VersionTag } from "@/features/devices/VersionTag";
import {
  allStatusDevices,
  criticalFinding,
  lowVulnerability,
  mediumFinding,
} from "@/features/devices/fixtures";
import { CveItem } from "@/features/vulnerabilities/CveItem";
import { RiskBadge } from "@/features/risk/RiskBadge";
import type { DisplayLevel } from "@/features/risk/display";

const LEVELS: DisplayLevel[] = ["critical", "vulnerable", "update", "safe", "unknown", "pending"];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="t-title">{title}</h2>
      {children}
    </section>
  );
}

export function UiGallery() {
  const [type, setType] = useState<DeviceType | null>("CONSOLE");
  const [chip, setChip] = useState("all");
  const [radio, setRadio] = useState<string | null>("a");
  const [seg, setSeg] = useState("OPEN");
  const [dialog, setDialog] = useState(false);

  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-10 p-6">
      <h1 className="t-page">UI parts</h1>
      <p className="t-body text-ink-muted">
        Developer page. Every shared part, in the current theme.
      </p>

      <Section title="Type">
        <p className="t-display">Display 32</p>
        <p className="t-title">Title 22</p>
        <p className="t-heading">Heading 17</p>
        <p className="t-body">Body 15, plain words for people at home.</p>
        <p className="t-label">Label 13</p>
        <p className="t-caption">Caption 12</p>
        <p className="t-mono">v3.1.0 CVE-2026-10231</p>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="danger">Danger</Button>
          <Button size="sm">Small</Button>
          <Button disabled>Disabled</Button>
          <LinkButton href="/">Link button</LinkButton>
          <IconButton label="Settings">
            <Icon name="settings" />
          </IconButton>
          <Tooltip text="Hint on hover and focus">
            <Button variant="secondary">Tooltip</Button>
          </Tooltip>
          <Spinner />
          <Avatar name="Bon" />
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Text" placeholder="Living room TV" help="Help text" />
          <Input label="With icon" leadingIcon={<Icon name="search" />} />
          <Input label="With error" error="Give your device a name." />
          <Input label="Version" mono defaultValue="25.02" />
          <Select label="Select" defaultValue="b">
            <option value="a">A</option>
            <option value="b">B</option>
          </Select>
          <Textarea label="Notes" />
          <Checkbox label="I don't know the version" />
          <Switch label="Switch" description="Describes what it does" />
        </div>
        <Segmented
          legend="State"
          name="seg"
          value={seg}
          onChange={setSeg}
          items={[
            { value: "OPEN", label: "Open" },
            { value: "IGNORED", label: "Ignored" },
          ]}
        />
        <RadioCards
          legend="Products"
          name="radio"
          value={radio}
          onChange={setRadio}
          options={[
            { value: "a", title: "Sony PlayStation 5", description: "Latest version 25.02" },
            { value: "b", title: "Sony PlayStation 4" },
          ]}
        />
        <Chips
          label="Filter"
          value={chip}
          onChange={setChip}
          items={[
            { value: "all", label: "All", count: 11 },
            { value: "x", label: "Needs attention", count: 5 },
          ]}
        />
        <FileDrop
          label="Add a software list"
          hint="JSON, up to 20 MB."
          maxBytes={20 * 1024 * 1024}
          onFile={() => undefined}
        />
      </Section>

      <Section title="Surfaces">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <p className="t-body">Card</p>
          </Card>
          <Card tone="critical">
            <p className="t-body">Card with critical border</p>
          </Card>
        </div>
        <Banner title="Info banner">Plain text.</Banner>
        <Banner
          variant="critical"
          title="Critical banner"
          action={<Button variant="danger">Fix now</Button>}
        >
          Update to 3.1.2 to fix this.
        </Banner>
        <div className="flex gap-2">
          <Pill>Pill</Pill>
          <Pill tone="brand" icon={<Icon name="bell" />}>
            On
          </Pill>
        </div>
        <Steps
          steps={[
            { label: "Type", state: "done" },
            { label: "Brand & model", state: "now" },
            { label: "Version", state: "todo" },
          ]}
        />
        <Disclosure summary="Where do I find this?">Open Settings, then About.</Disclosure>
        <FactList
          items={[
            { label: "Type", value: "Camera" },
            { label: "Installed", value: <VersionTag current="3.1.0" /> },
          ]}
        />
        <Table>
          <thead>
            <tr>
              <Th>Device</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>Camera</Td>
              <Td>
                <RiskBadge level="critical" />
              </Td>
            </tr>
          </tbody>
        </Table>
        <EmptyState title="No devices yet">Add your first device.</EmptyState>
        <div>
          <Button variant="secondary" onClick={() => setDialog(true)}>
            Open dialog
          </Button>
          <Dialog
            open={dialog}
            onClose={() => setDialog(false)}
            title="Dialog title"
            description="Short description."
            footer={<Button onClick={() => setDialog(false)}>Close</Button>}
          />
        </div>
      </Section>

      <Section title="Risk badges and versions">
        <div className="flex flex-wrap gap-2">
          {LEVELS.map((l) => (
            <RiskBadge key={l} level={l} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <VersionTag current="3.1.0" target="3.1.2" />
          <VersionTag current="10.0.26100" />
          <VersionTag current={null} />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["CONSOLE", "PC", "TV", "CAMERA", "NAS", "OTHER"] as DeviceType[]).map((t) => (
            <DeviceIcon key={t} type={t} />
          ))}
          <DeviceIcon type="ROUTER" size="lg" />
        </div>
      </Section>

      <Section title="Device parts">
        <DeviceTypePicker value={type} onChange={setType} />
        <NetworkSummary devices={allStatusDevices} />
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-0">
          {allStatusDevices.map((d) => (
            <li key={d.id}>
              <DeviceCard device={d} />
            </li>
          ))}
          <li>
            <AddDeviceTile />
          </li>
        </ul>
      </Section>

      <Section title="Vulnerabilities">
        <CveItem
          vulnerability={criticalFinding.vulnerability}
          productName="E1 Outdoor"
          fixedVersion="3.1.2"
        />
        <CveItem
          vulnerability={mediumFinding.vulnerability}
          productName="E1 Outdoor"
          fixedVersion="3.1.1"
        />
        <CveItem vulnerability={lowVulnerability} productName="E1 Outdoor" fixedVersion={null} />
        <CveItem
          vulnerability={mediumFinding.vulnerability}
          productName="E1 Outdoor"
          fixedVersion="3.1.1"
          ignored
          ignoredReason="Not exposed to the internet"
        />
      </Section>
    </div>
  );
}
