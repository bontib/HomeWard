"use client";
import { ErrorText } from "@/components/ui/ErrorText";
import { useEffect } from "react";
import type { DataSourceId, JobStatus, RecentCheck, SourceView } from "@/lib/contracts";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FactList } from "@/components/ui/FactList";
import { Icon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/Spinner";
import { Table, Td, Th } from "@/components/ui/Table";
import { formatDateTime, timeAgo } from "@/features/common/format";
import { ErrorBlock, LoadingBlock } from "@/features/common/QueryStates";
import { jobErrorText } from "@/features/jobs/messages";
import { errorMessage } from "@/store/api";
import { useGetChecksQuery, useRunChecksMutation } from "./checksApi";

const POLL_MS = 5000;

const SOURCE_NAME: Record<DataSourceId, string> = {
  NVD: "Vulnerability list (NVD)",
  TRIVY_DB: "Scanner data (Trivy)",
  KEV: "Problems attackers are using (CISA)",
};

function SourceRow({ id, source }: { id: DataSourceId; source: SourceView }) {
  return (
    <tr>
      <Td>{SOURCE_NAME[id]}</Td>
      <Td>{source.dataUpdatedAt ? timeAgo(source.dataUpdatedAt) : "Not yet"}</Td>
      <Td>
        {source.lastErrorCode ? (
          <ErrorText>{jobErrorText(source.lastErrorCode)}</ErrorText>
        ) : source.lastSuccessAt ? (
          <span className="inline-flex items-center gap-1">
            <Icon name="check" className="size-4" /> Working
          </span>
        ) : (
          "Waiting for the first update"
        )}
      </Td>
    </tr>
  );
}

function JobResult({ check }: { check: RecentCheck }) {
  const status: JobStatus = check.status;
  if (status === "DONE") {
    return (
      <span className="inline-flex items-center gap-1">
        <Icon name="check" className="size-4" /> Done
      </span>
    );
  }
  if (status === "FAILED") {
    return <ErrorText>{jobErrorText(check.errorCode)}</ErrorText>;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Spinner label="Checking" className="size-4" /> Checking…
    </span>
  );
}

function checkTarget(check: RecentCheck): string {
  if (check.device) return check.device.name;
  return check.type === "RESCAN_ALL" ? "All devices" : "Removed device";
}

export function ChecksScreen() {
  const { data, error, isLoading, refetch, fulfilledTimeStamp } = useGetChecksQuery();
  const [run, { isLoading: starting, error: runError }] = useRunChecksMutation();

  const busy = Boolean(data && (data.checkingDeviceCount > 0 || data.activeRescanJobId));
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => void refetch(), POLL_MS);
    return () => clearTimeout(timer);
  }, [busy, refetch, fulfilledTimeStamp]);

  if (isLoading) return <LoadingBlock label="Loading checks…" />;
  if (error || !data) return <ErrorBlock error={error} onRetry={refetch} />;

  const { scanner, sources, recent } = data;

  return (
    <div className="flex flex-col gap-6">
      <Card aria-labelledby="scanner-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="scanner-heading" className="t-heading">
              {scanner.on ? "The scanner is on" : "The scanner is off"}
            </h2>
            <p className="t-body text-ink-muted">
              {scanner.on
                ? "It checks your devices every day and whenever you change one."
                : "Checks won't run until the scanner is back. Ask the person who runs this app."}
            </p>
          </div>
          <Button onClick={() => void run()} disabled={busy || starting || !scanner.on}>
            {busy ? "Checking…" : "Check all now"}
          </Button>
        </div>
        {runError ? <ErrorText>{errorMessage(runError)}</ErrorText> : null}
        <FactList
          items={[
            {
              label: "Last check",
              value: scanner.lastCheckAt ? timeAgo(scanner.lastCheckAt) : "Not yet",
            },
            {
              label: "Next check",
              value: scanner.nextCheckAt ? formatDateTime(scanner.nextCheckAt) : "Not planned",
            },
            {
              label: "Check schedule",
              value: scanner.rescanCron ? (
                <span>
                  <span className="font-mono text-[13px]">{scanner.rescanCron}</span> (Set in .env)
                </span>
              ) : (
                "Set in .env"
              ),
            },
            {
              label: "Vulnerability list key",
              value: scanner.nvdApiKeySet ? "Using an API key" : "No API key (slower)",
            },
          ]}
        />
      </Card>

      <Card aria-labelledby="sources-heading" className="flex flex-col gap-3 p-4">
        <h2 id="sources-heading" className="t-heading px-2 pt-2">
          Where the data comes from
        </h2>
        <Table>
          <thead>
            <tr>
              <Th>Source</Th>
              <Th>Updated</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(SOURCE_NAME) as DataSourceId[]).map((id) => (
              <SourceRow key={id} id={id} source={sources[id]} />
            ))}
          </tbody>
        </Table>
      </Card>

      <Card aria-labelledby="recent-heading" className="flex flex-col gap-3 p-4">
        <h2 id="recent-heading" className="t-heading px-2 pt-2">
          Recent checks
        </h2>
        {recent.length === 0 ? (
          <p className="t-body text-ink-muted px-2 pb-2">No checks yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>What</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((check) => (
                <tr key={check.jobId}>
                  <Td>{formatDateTime(check.finishedAt ?? check.createdAt)}</Td>
                  <Td>{checkTarget(check)}</Td>
                  <Td>
                    <JobResult check={check} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
