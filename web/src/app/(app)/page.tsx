import type { Metadata } from "next";
import { HomeScreen } from "@/features/devices/HomeScreen";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = { title: "My home" };

export default async function MyHomePage() {
  const session = await requireSession();
  return <HomeScreen firstName={session.name.split(" ")[0] ?? ""} />;
}
