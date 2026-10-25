"use client";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Field";
import { useGetNotificationSettingsQuery } from "./api";
import { AlertSampleCard } from "./AlertSampleCard";
import { EmailAlertsCard } from "./EmailAlertsCard";
import { useNotificationActions } from "./useNotificationActions";
import { WhatWeEmailCard } from "./WhatWeEmailCard";

const POLL_MS = 15_000;

function LoadingCard() {
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6" aria-busy="true">
      <h2 className="t-heading">Email alerts</h2>
      <Switch label="Email me about new problems" disabled checked={false} readOnly />
      <div className="text-ink-muted flex items-center gap-3">
        <Spinner label="Loading email settings" />
        <span className="t-body">Loading...</span>
      </div>
    </Card>
  );
}

export function NotificationsScreen() {
  // Polling picks up a confirmed link (opened in another tab) and the countdowns.
  const { data, isLoading, refetch } = useGetNotificationSettingsQuery(undefined, {
    pollingInterval: POLL_MS,
    skipPollingIfUnfocused: true,
  });
  const actions = useNotificationActions(data);

  return (
    <div className="flex flex-col gap-6">
      {data ? (
        <EmailAlertsCard
          settings={data}
          busy={actions.busy}
          note={actions.note}
          testNote={actions.testNote}
          testSending={actions.testSending}
          onSetEnabled={(enabled) => void actions.setEnabled(enabled)}
          onSendTest={() => void actions.sendTest()}
        />
      ) : isLoading ? (
        <LoadingCard />
      ) : (
        <Banner
          variant="critical"
          title="We couldn't load your email settings."
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      )}
      <WhatWeEmailCard settings={data} />
      <AlertSampleCard />
    </div>
  );
}
