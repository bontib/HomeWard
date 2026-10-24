"use client";
import { useRouter } from "next/navigation";
import type { DeviceDetail } from "@/lib/contracts";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { errorMessage } from "@/store/api";
import { useDeleteDeviceMutation } from "./devicesApi";

export function RemoveDeviceDialog({
  open,
  device,
  onClose,
}: {
  open: boolean;
  device: DeviceDetail;
  onClose: () => void;
}) {
  const router = useRouter();
  const [remove, { isLoading, error }] = useDeleteDeviceMutation();

  async function confirm() {
    const result = await remove(device.id);
    if (!("error" in result)) router.push("/");
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Remove ${device.name}?`}
      description="This deletes the device, its software list and its problems from HomeGuard. It doesn't change the device itself."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} disabled={isLoading}>
            {isLoading ? "Removing…" : "Remove device"}
          </Button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="t-label text-critical">
          {errorMessage(error)}
        </p>
      ) : null}
    </Dialog>
  );
}
