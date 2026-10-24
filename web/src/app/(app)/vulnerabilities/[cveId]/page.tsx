import type { Metadata } from "next";
import { VulnerabilityDetailScreen } from "@/features/vulnerabilities/VulnerabilityDetailScreen";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Vulnerability" };

export default async function VulnerabilityPage({
  params,
}: {
  params: Promise<{ cveId: string }>;
}) {
  await requireSession();
  const { cveId } = await params;
  return <VulnerabilityDetailScreen cveId={decodeURIComponent(cveId)} />;
}
