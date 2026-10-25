import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { RiskBadge } from "@/features/risk/RiskBadge";
import { DIGEST_HOUR, type NotificationSettings } from "@/lib/contracts";
import { digestTimeText } from "./display";

function Row({
  title,
  badges,
  children,
}: {
  title: string;
  badges: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="t-label">{title}</h3>
      <div className="flex flex-wrap items-center gap-2">{badges}</div>
      <div className="t-body flex flex-col gap-1">{children}</div>
    </div>
  );
}

/** Information only: V1 has no choices, so there are no controls to get wrong. */
export function WhatWeEmailCard({
  settings,
}: {
  settings: Pick<NotificationSettings, "digestHour" | "timeZone"> | undefined;
}) {
  const time = digestTimeText(settings ?? { digestHour: DIGEST_HOUR, timeZone: null });
  return (
    <Card className="flex flex-col gap-5 p-4 sm:p-6" aria-labelledby="what-we-email-title">
      <h2 id="what-we-email-title" className="t-heading">
        What we email you
      </h2>
      <Row title="Right away" badges={<RiskBadge level="critical" />}>
        <p>A new Critical problem on one of your devices.</p>
        <p className="t-caption">
          At most one of these an hour. Anything held back goes into the daily summary.
        </p>
      </Row>
      <Row
        title={`Daily summary, ${time}`}
        badges={
          <>
            <RiskBadge level="critical" />
            <RiskBadge level="vulnerable" />
          </>
        }
      >
        <p>New Critical and Vulnerable problems, only on days when there are any.</p>
      </Row>
      <Row
        title="Not emailed"
        badges={
          <>
            <RiskBadge level="update" />
            <RiskBadge level="unknown" />
          </>
        }
      >
        <p>Update available, Low and Not tracked. Open My home to see these.</p>
      </Row>
      <p className="t-body text-ink-muted border-line flex items-start gap-2 border-t pt-4">
        <Icon name="info" className="mt-0.5 size-4" />
        <span>We only email about new problems. No email does not mean a device is safe.</span>
      </p>
    </Card>
  );
}
