import type { Metadata } from "next";
import { BackLink } from "@/features/common/BackLink";
import { AddDeviceForm } from "@/features/devices/AddDeviceForm";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Add a device" };

export default async function AddDevicePage() {
  await requireSession();
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6">
      <BackLink href="/">Cancel</BackLink>
      <div>
        <h1 className="t-page">Add a device</h1>
        <p className="t-body text-ink-muted">
          Tell us what it is and which version it runs. We&apos;ll check it against known
          vulnerabilities after you save.
        </p>
      </div>
      <AddDeviceForm />
    </div>
  );
}
