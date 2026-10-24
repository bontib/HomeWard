"use client";
import { ErrorText } from "@/components/ui/ErrorText";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CreateDeviceSchema, type DeviceType, type ProductOption } from "@/lib/contracts";
import { Banner } from "@/components/ui/Banner";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Disclosure } from "@/components/ui/Disclosure";
import { Checkbox, Input } from "@/components/ui/Field";
import { Steps, type Step } from "@/components/ui/Steps";
import { fieldMessages } from "@/features/common/forms";
import { RiskBadge } from "@/features/risk/RiskBadge";
import { ProductSearch } from "@/features/products/ProductSearch";
import { errorMessage, fieldErrors } from "@/store/api";
import { DeviceIcon } from "./DeviceIcon";
import { DeviceTypePicker } from "./DeviceTypePicker";
import { VersionTag } from "./VersionTag";
import { useCreateDeviceMutation } from "./devicesApi";
import { DEVICE_TYPES } from "./device-types";

type ProductChoice = { kind: "catalog"; option: ProductOption } | { kind: "other"; name: string };

const ROOM_SUGGESTIONS = [
  "Living room",
  "Kitchen",
  "Bedroom",
  "Kids' room",
  "Study",
  "Hallway",
  "Garage",
];

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="t-heading">{title}</h2>
      {children}
    </Card>
  );
}

function ResultCard({
  type,
  name,
  product,
  version,
  room,
}: {
  type: DeviceType | null;
  name: string;
  product: ProductChoice | null;
  version: string | null;
  room: string;
}) {
  const productName = product?.kind === "catalog" ? product.option.title : product?.name || null;
  const meta = [productName, room.trim()].filter(Boolean).join(" · ");
  // Without a version we cannot compare anything, so the device will be Not tracked.
  const tracked = product?.kind === "catalog" && version !== null;
  return (
    <div className="rounded-card border-line bg-surface-100 shadow-rest flex max-w-sm flex-col gap-3 border p-4">
      <div className="flex items-center gap-3">
        <DeviceIcon type={type ?? "OTHER"} />
        <div className="min-w-0">
          <p className="t-heading">{name.trim() || "Your device"}</p>
          <p className="t-caption truncate">
            {meta || (type ? DEVICE_TYPES[type].label : "Pick a type")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {tracked ? (
          <RiskBadge level="pending">Not checked yet</RiskBadge>
        ) : (
          <RiskBadge level="unknown" />
        )}
        <VersionTag current={version} />
      </div>
      <p className="t-caption border-line border-t pt-3">
        {tracked
          ? "We'll check this after you save."
          : product?.kind === "catalog"
            ? "Without a version we can't check this device. It will show as Not tracked."
            : "We don't have public security data for this device yet."}
      </p>
    </div>
  );
}

export function AddDeviceForm() {
  const router = useRouter();
  const [create, { isLoading, error: serverError }] = useCreateDeviceMutation();

  const [type, setType] = useState<DeviceType | null>(null);
  const [product, setProduct] = useState<ProductChoice | null>(null);
  const [version, setVersion] = useState("");
  const [unknownVersion, setUnknownVersion] = useState(false);
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const effectiveVersion = unknownVersion || version.trim() === "" ? null : version.trim();
  const serverFields = fieldErrors(serverError);

  const steps: Step[] = [
    { label: "Type", done: type !== null },
    { label: "Brand & model", done: product !== null },
    { label: "Version", done: effectiveVersion !== null || unknownVersion },
    { label: "Name & room", done: name.trim() !== "" },
  ].map((s, i, all) => ({
    label: s.label,
    state: s.done ? "done" : all.findIndex((x) => !x.done) === i ? "now" : "todo",
  }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!type) {
      setErrors({ type: "Pick the kind of device." });
      return;
    }
    const productInput =
      product?.kind === "catalog"
        ? ({ kind: "catalog", cpe: product.option.cpe } as const)
        : ({ kind: "other", name: product?.name ?? "" } as const);
    const parsed = CreateDeviceSchema.safeParse({
      type,
      name,
      room,
      product: productInput,
      version: effectiveVersion,
    });
    if (!parsed.success) {
      setErrors(fieldMessages(parsed.error));
      return;
    }
    setErrors({});
    const result = await create(parsed.data);
    if ("data" in result && result.data) router.push(`/devices/${result.data.device.id}`);
  }

  const nameError = errors.name ?? serverFields.name;
  const versionError = errors.version ?? serverFields.version;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <Steps steps={steps} label="Steps to add a device" />

      <SectionCard title="1. What kind of device is it?">
        <DeviceTypePicker value={type} onChange={setType} />
        {errors.type ? <ErrorText>{errors.type}</ErrorText> : null}
      </SectionCard>

      <SectionCard title="2. Which brand and model?">
        {product?.kind === "other" ? (
          <div className="flex flex-col gap-3">
            <Input
              label="What is it called?"
              help="Optional. We can't check this one yet, so it will show as Not tracked."
              value={product.name}
              onChange={(e) => setProduct({ kind: "other", name: e.target.value })}
            />
            <div>
              <Button variant="quiet" size="sm" onClick={() => setProduct(null)}>
                Search the list instead
              </Button>
            </div>
          </div>
        ) : (
          <ProductSearch
            selectedCpe={product?.kind === "catalog" ? product.option.cpe : null}
            onSelect={(option) => setProduct({ kind: "catalog", option })}
            onChooseOther={(text) => setProduct({ kind: "other", name: text })}
          />
        )}
      </SectionCard>

      <SectionCard title="3. Which version is installed?">
        <Input
          label="Version"
          mono
          value={unknownVersion ? "" : version}
          disabled={unknownVersion}
          onChange={(e) => setVersion(e.target.value)}
          help={'Type it exactly as shown on the device, without the "v".'}
          error={versionError}
        />
        {type ? (
          <Disclosure
            summary={`Where do I find this on a ${DEVICE_TYPES[type].label.toLowerCase()}?`}
          >
            {DEVICE_TYPES[type].versionHelp}
          </Disclosure>
        ) : null}
        <Checkbox
          label="I don't know the version"
          checked={unknownVersion}
          onChange={(e) => setUnknownVersion(e.target.checked)}
        />
        {unknownVersion || version.trim() === "" ? (
          <Banner>
            Without a version we can&apos;t check this device. It will show as Not tracked.
          </Banner>
        ) : null}
      </SectionCard>

      <SectionCard title="4. What do you call it?">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Living room TV"
            error={nameError}
          />
          <Input
            label="Room"
            list="room-suggestions"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            help="Optional"
            error={errors.room ?? serverFields.room}
          />
          <datalist id="room-suggestions">
            {ROOM_SUGGESTIONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
      </SectionCard>

      <section aria-labelledby="result-heading" className="flex flex-col gap-3">
        <h2 id="result-heading" className="t-heading">
          Result
        </h2>
        <ResultCard
          type={type}
          name={name}
          product={product}
          version={effectiveVersion}
          room={room}
        />
      </section>

      {serverError && Object.keys(serverFields).length === 0 ? (
        <ErrorText>{errorMessage(serverError)}</ErrorText>
      ) : null}

      <div className="border-line flex flex-wrap justify-end gap-2 border-t pt-6">
        <LinkButton href="/" variant="secondary">
          Cancel
        </LinkButton>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Adding…" : "Add device"}
        </Button>
      </div>
    </form>
  );
}
