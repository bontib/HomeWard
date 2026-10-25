import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";

/** A fixed, clearly fake example, so people know what to expect before they turn alerts on. */
export function AlertSampleCard() {
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6" aria-labelledby="alert-sample-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="alert-sample-title" className="t-heading">
          This is what an alert looks like
        </h2>
        <Pill>Example</Pill>
      </div>
      <p className="t-caption">Always the device&apos;s name, how bad it is and one thing to do.</p>
      <figure
        aria-label="Example email"
        className="bg-surface-0 border-line rounded-control m-0 flex flex-col gap-3 border p-4"
      >
        <p className="t-label">Subject: Front door camera needs fixing now</p>
        <div className="t-body flex flex-col gap-2">
          <p>Front door camera needs fixing now.</p>
          <p>Critical: Security problem in Acme CamOS. Attackers are already using this problem.</p>
          <p>Update to 3.1.2 to fix this.</p>
        </div>
      </figure>
    </Card>
  );
}
