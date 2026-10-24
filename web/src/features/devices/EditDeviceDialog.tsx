"use client";
import { useState } from "react";
import { UpdateDeviceSchema, type DeviceDetail } from "@/lib/contracts";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Textarea } from "@/components/ui/Field";
import { fieldMessages } from "@/features/common/forms";
import { errorMessage, fieldErrors } from "@/store/api";
import { useUpdateDeviceMutation, type UpdateDeviceInput } from "./devicesApi";

function EditForm({
  device,
  onDone,
  onCancel,
}: {
  device: DeviceDetail;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [update, { isLoading, error: serverError }] = useUpdateDeviceMutation();
  const [name, setName] = useState(device.name);
  const [room, setRoom] = useState(device.room ?? "");
  const [notes, setNotes] = useState(device.notes ?? "");
  const [version, setVersion] = useState(device.product?.version ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const serverFields = fieldErrors(serverError);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // Send only what changed, so an untouched field never adds a history entry.
    const body: UpdateDeviceInput = {};
    if (name !== device.name) body.name = name;
    if (room !== (device.room ?? "")) body.room = room;
    if (notes !== (device.notes ?? "")) body.notes = notes;
    if (device.product && version !== (device.product.version ?? "")) body.version = version;

    if (Object.keys(body).length === 0) {
      onDone();
      return;
    }
    const parsed = UpdateDeviceSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(fieldMessages(parsed.error));
      return;
    }
    setErrors({});
    const result = await update({ id: device.id, body });
    if ("data" in result) onDone();
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Input
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name ?? serverFields.name}
      />
      <Input
        label="Room"
        value={room}
        onChange={(e) => setRoom(e.target.value)}
        error={errors.room ?? serverFields.room}
      />
      {device.product ? (
        <Input
          label="Version"
          mono
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          help={'Type it exactly as shown on the device, without the "v".'}
          error={errors.version ?? serverFields.version}
        />
      ) : null}
      <Textarea
        label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        error={errors.notes ?? serverFields.notes}
      />
      {serverError && Object.keys(serverFields).length === 0 ? (
        <p role="alert" className="t-label text-critical">
          {errorMessage(serverError)}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

export function EditDeviceDialog({
  open,
  device,
  onClose,
}: {
  open: boolean;
  device: DeviceDetail;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Edit device">
      <EditForm device={device} onDone={onClose} onCancel={onClose} />
    </Dialog>
  );
}
