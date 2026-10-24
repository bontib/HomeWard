import type { Metadata } from "next";
import { ChecksScreen } from "@/features/checks/ChecksScreen";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Checks" };

export default async function ChecksPage() {
  await requireSession();
  return <ChecksScreen />;
}
