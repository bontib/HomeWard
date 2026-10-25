"use client";
import { useId, type ReactNode } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorText } from "@/components/ui/ErrorText";
import { Switch } from "@/components/ui/Field";
import { Icon } from "@/components/ui/icons";
import { Pill, type PillTone } from "@/components/ui/Pill";
import { Spinner } from "@/components/ui/Spinner";
import { formatDateTime, timeAgo } from "@/features/common/format";
import type { NotificationSettings } from "@/lib/contracts";
import { alertView, resendText, testBlockedReason, type AlertView } from "./display";
import { TestEmailButton } from "./TestEmailButton";
import type { Busy, Note } from "./useNotificationActions";
import { useNow } from "./useNow";

const CANT_SEND_TEXT =
  "Email alerts are on for you, but this HomeGuard can't send email right now. Ask the person who runs it to check the email settings.";

type PillSpec = { tone: PillTone; icon: ReactNode; text: string };

function pillFor(view: AlertView, busy: Busy): PillSpec {
  if (busy === "turning-on") {
    return { tone: "brand", icon: <Spinner label="" className="size-3.5" />, text: "Sending link" };
  }
  if (busy === "turning-off") {
    return {
      tone: "neutral",
      icon: <Spinner label="" className="size-3.5" />,
      text: "Turning off",
    };
  }
  switch (view) {
    case "not-set-up":
      return { tone: "unknown", icon: <Icon name="info" />, text: "Not set up" };
    case "off":
      return { tone: "neutral", icon: <Icon name="dashCircle" />, text: "Off" };
    case "pending":
      return { tone: "update", icon: <Icon name="clock" />, text: "Waiting for you" };
    case "on":
      return { tone: "brand", icon: <Icon name="bell" />, text: "On" };
    case "cant-send":
      return { tone: "critical", icon: <Icon name="critical" />, text: "Can't send" };
  }
}

function stateLine(view: AlertView, busy: Busy, email: string): string | null {
  if (busy === "turning-on") return `Sending a link to ${email}...`;
  if (busy === "turning-off") return "Turning off...";
  switch (view) {
    case "not-set-up":
      return "Email alerts aren't set up on this HomeGuard yet. Ask the person who runs it.";
    case "off":
      return "Off. Turn it on and we'll send a link to confirm.";
    case "pending":
      return `We sent a link to ${email}. Open it to turn on alerts.`;
    case "on":
      return `On. Sent to ${email}.`;
    case "cant-send":
      return null; // the banner says it
  }
}

export function LastEmailLine({ settings }: { settings: NotificationSettings }) {
  if (settings.lastError) {
    return (
      <p className="t-body text-critical flex items-start gap-1.5">
        <Icon name="critical" className="mt-0.5 size-4" />
        <span>
          Last email couldn&apos;t be sent. We&apos;ll try again with the next daily summary.
        </span>
      </p>
    );
  }
  if (settings.lastSentAt) {
    return (
      <p className="t-body">
        Last email sent{" "}
        <time dateTime={settings.lastSentAt} title={`${formatDateTime(settings.lastSentAt)} UTC`}>
          {timeAgo(settings.lastSentAt)}
        </time>
        .
      </p>
    );
  }
  return <p className="t-body">No email sent yet.</p>;
}

export function EmailAlertsCard({
  settings,
  busy,
  note,
  testNote,
  testSending,
  onSetEnabled,
  onSendTest,
}: {
  settings: NotificationSettings;
  busy: Busy;
  note: Note | null;
  testNote: Note | null;
  testSending: boolean;
  onSetEnabled: (enabled: boolean) => void;
  onSendTest: () => void;
}) {
  const view = alertView(settings);
  const lineId = useId();
  const titleId = useId();
  const later = [settings.confirmResendAt, settings.testAvailableAt].filter(Boolean).sort().at(-1);
  const now = useNow(later ?? null);
  const pill = pillFor(view, busy);
  const line = stateLine(view, busy, settings.email);
  const wait = resendText(settings.confirmResendAt, now);
  const showSwitch = view !== "pending" || busy !== null;
  const showLastEmail =
    view === "on" ||
    view === "cant-send" ||
    (view === "off" && Boolean(settings.lastSentAt || settings.lastError));

  return (
    <Card aria-labelledby={titleId} className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="t-heading">
          Email alerts
        </h2>
        <Pill tone={pill.tone} icon={pill.icon}>
          {pill.text}
        </Pill>
      </div>

      {showSwitch ? (
        <Switch
          label="Email me about new problems"
          checked={view === "on" || view === "cant-send"}
          disabled={view === "not-set-up" || busy !== null}
          aria-busy={busy !== null}
          aria-describedby={lineId}
          onChange={(event) => onSetEnabled(event.target.checked)}
          className="min-h-11 py-0"
        />
      ) : null}

      {line ? (
        <p id={lineId} className="t-body">
          {line}
        </p>
      ) : null}

      {view === "off" && busy === null ? (
        <p className="t-body">Your address: {settings.email}</p>
      ) : null}

      {view === "not-set-up" ? (
        <p className="t-caption">
          They can set this up in the .env file. The README has the steps.
        </p>
      ) : null}

      {view === "cant-send" ? (
        <Banner variant="critical">
          <span id={lineId}>{CANT_SEND_TEXT}</span>
        </Banner>
      ) : null}

      {view === "pending" && busy === null ? (
        <div className="flex flex-col gap-3">
          <p className="t-caption">
            The link works for 48 hours. Alerts are not on until you open it.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="secondary"
              disabled={wait !== null}
              aria-describedby={wait ? `${lineId}-wait` : undefined}
              onClick={() => onSetEnabled(true)}
            >
              Send the link again
            </Button>
            <Button variant="quiet" onClick={() => onSetEnabled(false)}>
              Turn off email alerts
            </Button>
          </div>
          {wait ? (
            <p id={`${lineId}-wait`} className="t-caption flex items-start gap-1.5">
              <Icon name="info" className="mt-px size-4" />
              <span>{wait}</span>
            </p>
          ) : null}
          <p className="t-caption">Nothing in the inbox? Look in your spam folder.</p>
        </div>
      ) : null}

      <div role="status" className={note && note.kind !== "error" ? "t-caption" : "sr-only"}>
        {note && note.kind !== "error" ? note.text : null}
      </div>
      {note?.kind === "error" ? <ErrorText>{note.text}</ErrorText> : null}

      <div className="border-line flex flex-col gap-4 border-t pt-4">
        {showLastEmail ? <LastEmailLine settings={settings} /> : null}
        <TestEmailButton
          blockedReason={testBlockedReason(settings, now)}
          sending={testSending}
          note={testNote}
          onSend={onSendTest}
        />
      </div>
    </Card>
  );
}
