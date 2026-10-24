import type { Metadata } from "next";
import { parseFilters } from "@/features/vulnerabilities/filters";
import { VulnerabilitiesScreen } from "@/features/vulnerabilities/VulnerabilitiesScreen";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Vulnerabilities" };

export default async function VulnerabilitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  return <VulnerabilitiesScreen filters={parseFilters(await searchParams)} />;
}
