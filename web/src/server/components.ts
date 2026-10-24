import type { ComponentView } from "@/lib/contracts";
import { riskLevel, type RiskLevel } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { notFound } from "./errors";

const LEVEL_RANK: Record<RiskLevel, number> = { critical: 0, vulnerable: 1, low: 2 };
const NO_FINDINGS_RANK = 3;

/** Worst first, then parts we could not check, then by name. */
export async function listComponents(userId: string, deviceId: string): Promise<ComponentView[]> {
  const device = await getDb().device.findFirst({
    where: { id: deviceId, userId },
    select: {
      components: {
        select: {
          id: true,
          name: true,
          version: true,
          vendor: true,
          source: true,
          check: true,
          findings: {
            where: { state: "OPEN" },
            select: {
              vulnerability: { select: { cvssScore: true, severity: true, exploited: true } },
            },
          },
        },
      },
    },
  });
  if (!device) throw notFound("That device");

  const views = device.components.map((c) => {
    const levels = c.findings.map((f) => riskLevel(f.vulnerability));
    const worst = levels.sort((a, b) => LEVEL_RANK[a] - LEVEL_RANK[b])[0] ?? null;
    const view: ComponentView = {
      id: c.id,
      name: c.name,
      version: c.version,
      vendor: c.vendor,
      source: c.source,
      check: c.check,
      openFindingCount: levels.length,
      worstLevel: worst,
    };
    return view;
  });
  return views.sort(compareComponents);
}

function compareComponents(a: ComponentView, b: ComponentView): number {
  const rank = (v: ComponentView) => (v.worstLevel ? LEVEL_RANK[v.worstLevel] : NO_FINDINGS_RANK);
  const byLevel = rank(a) - rank(b);
  if (byLevel !== 0) return byLevel;
  const aChecked = a.check === "CHECKED";
  if (aChecked !== (b.check === "CHECKED")) return aChecked ? 1 : -1;
  return a.name.localeCompare(b.name);
}
