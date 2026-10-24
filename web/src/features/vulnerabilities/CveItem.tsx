import Link from "next/link";
import type { ReactNode } from "react";
import type { VulnerabilitySummary } from "@/lib/contracts";
import { effectiveScore, riskLevel } from "@/lib/contracts";
import { cn } from "@/components/ui/cn";
import { firstTwoSentences } from "@/features/common/format";
import { cveLevel, type DisplayLevel } from "@/features/risk/display";
import { RiskBadge } from "@/features/risk/RiskBadge";

const SCORE_TONE: Record<DisplayLevel, string> = {
  critical: "bg-critical-tint text-critical",
  vulnerable: "bg-vulnerable-tint text-vulnerable",
  update: "bg-update-tint text-update",
  safe: "bg-safe-tint text-safe",
  unknown: "bg-unknown-tint text-unknown",
  pending: "bg-unknown-tint text-unknown",
};

export function cveTitle(productName: string | null): string {
  return productName ? `Security problem in ${productName}` : "Security problem";
}

export function CveItem({
  vulnerability,
  productName,
  fixedVersion,
  ignored,
  ignoredReason,
  meta,
  actions,
}: {
  vulnerability: VulnerabilitySummary;
  productName: string | null;
  fixedVersion: string | null;
  ignored?: boolean;
  ignoredReason?: string | null;
  /** Extra line under the title, for example the device name. */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  const { level, label } = cveLevel(riskLevel(vulnerability));
  const score = effectiveScore(vulnerability);
  return (
    <article
      className={cn(
        "rounded-control border-line bg-surface-100 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border p-4",
        ignored && "opacity-80",
      )}
    >
      <div
        title="Score out of 10"
        className={cn(
          "rounded-control row-span-3 grid size-12 place-items-center font-mono text-[15px] font-medium",
          SCORE_TONE[level],
        )}
      >
        <span aria-hidden>
          {vulnerability.cvssScore !== null ? vulnerability.cvssScore.toFixed(1) : "–"}
        </span>
        <span className="sr-only">
          {score !== null ? `Score ${score.toFixed(1)} out of 10` : "No score yet"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/vulnerabilities/${encodeURIComponent(vulnerability.id)}`}
          className="text-ink-muted font-mono text-[13px] leading-[18px] font-medium"
        >
          {vulnerability.id}
        </Link>
        <RiskBadge level={level}>{label}</RiskBadge>
        {vulnerability.exploited ? (
          <RiskBadge level="critical">Exploited in the wild</RiskBadge>
        ) : null}
        {ignored ? <RiskBadge level="unknown">Ignored</RiskBadge> : null}
      </div>
      <h3 className="t-body m-0 font-semibold">{cveTitle(productName)}</h3>
      <div className="col-start-2 flex flex-col gap-2">
        {meta}
        {vulnerability.summary ? (
          <p className="t-body text-ink-muted m-0">{firstTwoSentences(vulnerability.summary)}</p>
        ) : null}
        <p className="t-label m-0">
          {fixedVersion ? (
            <>
              Fixed in <span className="font-mono">{fixedVersion}</span>
            </>
          ) : (
            "No fix known yet."
          )}
        </p>
        {ignored && ignoredReason ? (
          <p className="t-caption">Your reason: {ignoredReason}</p>
        ) : null}
        {actions}
      </div>
    </article>
  );
}
