"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/Spinner";
import type { NotificationLinkView } from "@/lib/contracts";
import {
  useConfirmEmailAlertsMutation,
  useGetNotificationLinkQuery,
  useUnsubscribeEmailAlertsMutation,
} from "./api";
import { confirmHeading } from "./display";
import { errorCodeOf, messageOr } from "./errors";

type Purpose = NotificationLinkView["purpose"];

const COPY = {
  confirm: {
    ready:
      "We'll email you about new Critical problems right away, and a daily summary of new Critical and Vulnerable problems. We won't email you about problems you already have.",
    action: "Turn on email alerts",
    working: "Turning on...",
    done: "Email alerts are on.",
    doneBody: "We only email about new problems. No email does not mean a device is safe.",
    failed: "We couldn't turn on email alerts. Try again in a minute.",
    invalid: "This link has expired. Turn on alerts again in Settings > Notifications.",
  },
  unsubscribe: {
    ready:
      "You won't get alerts or daily summaries any more. Your devices are still checked every day. Open My home to see the results.",
    action: "Stop email alerts",
    working: "Stopping...",
    done: "Email alerts are off.",
    doneBody: "You can turn them on again in Settings.",
    failed: "We couldn't stop email alerts. Try again in a minute.",
    invalid: "This link doesn't work. You can turn alerts off in Settings > Notifications.",
  },
} as const;

type Screen =
  | { kind: "loading" }
  | { kind: "ready"; maskedEmail: string }
  | { kind: "working"; maskedEmail: string }
  | { kind: "done" }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string; retry: "link" | "action"; maskedEmail?: string };

function Heading({
  children,
  icon,
  tone,
}: {
  children: ReactNode;
  icon?: IconName;
  tone?: "critical" | "brand";
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  // Move focus after each change, so a screen reader hears the new state.
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="flex flex-col items-start gap-4">
      {icon ? (
        <span
          className={
            tone === "critical"
              ? "bg-critical-tint text-critical grid size-12 place-items-center rounded-full"
              : "bg-brand-tint text-brand grid size-12 place-items-center rounded-full"
          }
        >
          <Icon name={icon} className="size-6" />
        </span>
      ) : null}
      <h1 ref={ref} tabIndex={-1} className="t-page outline-none">
        {children}
      </h1>
    </div>
  );
}

/** One page for both links: it asks first, and only the button changes anything. */
export function LinkLandingPage({ purpose, token }: { purpose: Purpose; token: string | null }) {
  const copy = COPY[purpose];
  const link = useGetNotificationLinkQuery({ purpose, token: token ?? "" }, { skip: !token });
  const [confirm] = useConfirmEmailAlertsMutation();
  const [unsubscribe] = useUnsubscribeEmailAlertsMutation();
  const [override, setOverride] = useState<Screen | null>(null);

  function baseScreen(): Screen {
    if (!token) return { kind: "invalid", message: copy.invalid };
    if (link.isLoading || link.isUninitialized) return { kind: "loading" };
    if (link.error) {
      if (errorCodeOf(link.error) === "INVALID_LINK") {
        return { kind: "invalid", message: messageOr(link.error, copy.invalid) };
      }
      return {
        kind: "error",
        message: "We couldn't check this link. Try again in a minute.",
        retry: "link",
      };
    }
    if (link.data?.alreadyDone) return { kind: "done" };
    return { kind: "ready", maskedEmail: link.data?.maskedEmail ?? "" };
  }

  const screen = override ?? baseScreen();

  async function press(maskedEmail: string) {
    if (!token) return;
    setOverride({ kind: "working", maskedEmail });
    try {
      await (purpose === "confirm" ? confirm({ token }) : unsubscribe({ token })).unwrap();
      setOverride({ kind: "done" });
    } catch (error) {
      const code = errorCodeOf(error);
      if (code === "INVALID_LINK") {
        setOverride({ kind: "invalid", message: messageOr(error, copy.invalid) });
      } else {
        setOverride({
          kind: "error",
          message: code === "CONFLICT" ? messageOr(error, copy.failed) : copy.failed,
          retry: "action",
          maskedEmail,
        });
      }
    }
  }

  return (
    <Card className="flex flex-col gap-6 p-6 sm:p-8" aria-live="polite">
      {screen.kind === "loading" ? (
        <div className="text-ink-muted flex items-center gap-3" aria-busy="true">
          <Spinner label="Checking your link" />
          <span className="t-body">Checking your link...</span>
        </div>
      ) : null}

      {screen.kind === "ready" || screen.kind === "working" ? (
        <>
          <Heading>{confirmHeading(screen.maskedEmail, purpose)}</Heading>
          <p className="t-body">{copy.ready}</p>
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <Button
              disabled={screen.kind === "working"}
              aria-busy={screen.kind === "working"}
              onClick={() => void press(screen.maskedEmail)}
            >
              {screen.kind === "working" ? (
                <>
                  <span aria-hidden className="inline-flex">
                    <Spinner label="" className="text-on-brand size-4" />
                  </span>
                  {copy.working}
                </>
              ) : (
                copy.action
              )}
            </Button>
            {purpose === "confirm" && screen.kind === "ready" ? (
              <LinkButton href="/" variant="quiet">
                No, not now
              </LinkButton>
            ) : null}
          </div>
        </>
      ) : null}

      {screen.kind === "done" ? (
        <>
          <Heading icon="bell" tone="brand">
            {copy.done}
          </Heading>
          <p className="t-body">{copy.doneBody}</p>
          <LinkButton href="/settings/notifications" variant="secondary" className="self-start">
            Go to Settings
          </LinkButton>
        </>
      ) : null}

      {screen.kind === "invalid" ? (
        <>
          <Heading icon="critical" tone="critical">
            This link doesn&apos;t work.
          </Heading>
          <p className="t-body">{screen.message}</p>
          <LinkButton href="/settings/notifications" variant="secondary" className="self-start">
            Go to Settings
          </LinkButton>
        </>
      ) : null}

      {screen.kind === "error" ? (
        <>
          <Heading icon="critical" tone="critical">
            {screen.message}
          </Heading>
          <Button
            className="self-start"
            onClick={() => {
              if (screen.retry === "link") void link.refetch();
              setOverride(null);
            }}
          >
            Try again
          </Button>
        </>
      ) : null}
    </Card>
  );
}
