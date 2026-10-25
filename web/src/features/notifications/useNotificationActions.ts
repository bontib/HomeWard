"use client";
import { useState } from "react";
import type { JobView, NotificationSettings } from "@/lib/contracts";
import { useJobWatcher } from "@/features/jobs/useJobWatcher";
import { useAppDispatch } from "@/store/hooks";
import { api } from "@/store/api";
import { notificationsApi, useSendTestEmailMutation, useSetEmailAlertsMutation } from "./api";
import { TEST_WAIT_TEXT } from "./display";
import { errorCodeOf, messageOr } from "./errors";

export type Busy = "turning-on" | "turning-off" | null;
export type Note = { kind: "status" | "info" | "error"; text: string };

type WatchedJob = { id: string; kind: "confirm" | "test" };

/**
 * Everything the settings screen does to the server, with the texts for each outcome.
 * The card and the test button only get plain values and callbacks.
 */
export function useNotificationActions(settings: NotificationSettings | undefined) {
  const dispatch = useAppDispatch();
  const [setEmailAlerts] = useSetEmailAlertsMutation();
  const [sendTestEmail] = useSendTestEmailMutation();
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [testNote, setTestNote] = useState<Note | null>(null);
  const [testSending, setTestSending] = useState(false);
  const [watched, setWatched] = useState<WatchedJob | null>(null);

  // The answer already holds the new settings. Show them at once, so the card never
  // flashes the old state while the refetch runs.
  function showNew(next: NotificationSettings) {
    dispatch(
      notificationsApi.util.updateQueryData("getNotificationSettings", undefined, () => next),
    );
  }

  function refresh() {
    dispatch(api.util.invalidateTags(["Notifications"]));
  }

  // The mail goes out through the worker, so the job result tells us if it really left.
  useJobWatcher(watched?.id ?? null, (job: JobView) => {
    const failed = job.status === "FAILED";
    if (watched?.kind === "test") {
      setTestSending(false);
      setTestNote(
        failed
          ? { kind: "error", text: "We couldn't send the test email. Try again in a minute." }
          : {
              kind: "status",
              text: `Sent to ${settings?.email ?? "your address"}. Check your inbox. It can take a minute.`,
            },
      );
    } else if (failed) {
      setNote({ kind: "error", text: "We couldn't send the link. Try again in a minute." });
    }
    refresh();
  });

  async function setEnabled(enabled: boolean) {
    setBusy(enabled ? "turning-on" : "turning-off");
    setNote(null);
    try {
      const result = await setEmailAlerts({ enabled }).unwrap();
      showNew(result.settings);
      if (enabled && result.jobId) setWatched({ id: result.jobId, kind: "confirm" });
      setNote({
        kind: "status",
        text: enabled ? `We sent a link to ${result.settings.email}.` : "Email alerts are off.",
      });
      if (!enabled) setTestNote(null);
    } catch (error) {
      setNote({
        kind: "error",
        text: messageOr(error, "We couldn't change your email settings. Try again in a minute."),
      });
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setTestSending(true);
    setTestNote(null);
    try {
      const result = await sendTestEmail().unwrap();
      showNew(result.settings);
      if (result.jobId) {
        setWatched({ id: result.jobId, kind: "test" });
      } else {
        setTestSending(false);
      }
    } catch (error) {
      setTestSending(false);
      const rateLimited = errorCodeOf(error) === "RATE_LIMITED";
      setTestNote(
        rateLimited
          ? { kind: "info", text: messageOr(error, TEST_WAIT_TEXT) }
          : {
              kind: "error",
              text: messageOr(error, "We couldn't send the test email. Try again in a minute."),
            },
      );
    }
  }

  return { busy, note, testNote, testSending, setEnabled, sendTest };
}
