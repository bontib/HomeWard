import type { Metadata } from "next";
import { NotificationsScreen } from "@/features/notifications/NotificationsScreen";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireSession();
  return <NotificationsScreen />;
}
