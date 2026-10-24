import type { Metadata } from "next";
import { DeviceDetailScreen } from "@/features/devices/DeviceDetailScreen";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Device" };

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  return <DeviceDetailScreen id={id} />;
}
