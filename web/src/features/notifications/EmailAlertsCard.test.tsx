// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailAlertsCard } from "./EmailAlertsCard";
import {
  alertsOff,
  alertsOn,
  cannotSend,
  makeSettings,
  NOW,
  smtpMissing,
  waitingForYou,
} from "./fixtures";
import type { NotificationSettings } from "@/lib/contracts";
import type { Busy, Note } from "./useNotificationActions";

function setup(
  settings: NotificationSettings,
  extra: { busy?: Busy; note?: Note | null; testNote?: Note | null; testSending?: boolean } = {},
) {
  const onSetEnabled = vi.fn();
  const onSendTest = vi.fn();
  render(
    <EmailAlertsCard
      settings={settings}
      busy={extra.busy ?? null}
      note={extra.note ?? null}
      testNote={extra.testNote ?? null}
      testSending={extra.testSending ?? false}
      onSetEnabled={onSetEnabled}
      onSendTest={onSendTest}
    />,
  );
  return { onSetEnabled, onSendTest };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe("EmailAlertsCard", () => {
  it("says email is not set up and disables the switch", () => {
    setup(smtpMissing);
    expect(screen.getByText("Not set up")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Email me about new problems" })).toBeDisabled();
    expect(screen.getByText(/aren't set up on this HomeGuard yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send a test email" })).toBeDisabled();
    expect(screen.getByText("Email isn't set up on this HomeGuard.")).toBeInTheDocument();
  });

  it("shows Off with the address and asks for the switch to be turned on", async () => {
    const { onSetEnabled } = setup(alertsOff);
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByText(/Off\. Turn it on and we'll send a link/)).toBeInTheDocument();
    expect(screen.getByText(`Your address: ${alertsOff.email}`)).toBeInTheDocument();
    expect(screen.getByText("Turn on email alerts first.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Email me about new problems" }));
    expect(onSetEnabled).toHaveBeenCalledWith(true);
  });

  it("does not flip the switch while the request runs", () => {
    setup(alertsOff, { busy: "turning-on" });
    const toggle = screen.getByRole("switch", { name: "Email me about new problems" });
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Sending link")).toBeInTheDocument();
    expect(screen.getByText("Sending a link to you@example.com...")).toBeInTheDocument();
  });

  it("waits for the person: resend counts down, turn off is always there", async () => {
    const { onSetEnabled } = setup(waitingForYou);
    expect(screen.getByText("Waiting for you")).toBeInTheDocument();
    expect(screen.getByText(/We sent a link to you@example.com/)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("button", { name: "Send the link again" })).toBeDisabled();
    expect(screen.getByText("You can ask again in 8 minutes.")).toBeInTheDocument();
    expect(screen.getByText(/spam folder/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Turn off email alerts" }));
    expect(onSetEnabled).toHaveBeenCalledWith(false);
  });

  it("shows the confirm-mail cap as error text and keeps a way to turn alerts off", async () => {
    const text =
      "We already sent several confirmation emails. Turn email alerts off and on again to start over.";
    const { onSetEnabled } = setup(
      { ...waitingForYou, confirmResendAt: "2026-10-25T11:50:00.000Z" },
      { note: { kind: "error", text } },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(text);
    await userEvent.click(screen.getByRole("button", { name: "Turn off email alerts" }));
    expect(onSetEnabled).toHaveBeenCalledWith(false);
  });

  it("lets the person ask again once the wait is over", async () => {
    const { onSetEnabled } = setup({
      ...waitingForYou,
      confirmResendAt: "2026-10-25T11:50:00.000Z",
    });
    await userEvent.click(screen.getByRole("button", { name: "Send the link again" }));
    expect(onSetEnabled).toHaveBeenCalledWith(true);
  });

  it("shows On with the brand pill text, the last email and an active test button", async () => {
    const { onSendTest } = setup(alertsOn);
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText("On. Sent to you@example.com.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Email me about new problems" })).toBeChecked();
    expect(screen.getByText("2 hours ago")).toHaveAttribute("datetime", "2026-10-25T10:00:00.000Z");
    await userEvent.click(screen.getByRole("button", { name: "Send a test email" }));
    expect(onSendTest).toHaveBeenCalled();
  });

  it("says no email was sent yet instead of leaving a gap", () => {
    setup(makeSettings({ lastSentAt: null }));
    expect(screen.getByText("No email sent yet.")).toBeInTheDocument();
  });

  it("shows a failed last email with an icon and words", () => {
    setup(makeSettings({ lastError: "SMTP_FAILED" }));
    expect(screen.getByText(/Last email couldn't be sent/)).toBeInTheDocument();
  });

  it("says it can't send, keeps the switch on so it can be turned off", () => {
    setup(cannotSend);
    expect(screen.getByText("Can't send")).toBeInTheDocument();
    expect(screen.getByText(/can't send email right now/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Email me about new problems" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Send a test email" })).toBeDisabled();
  });

  it("gives the rate-limit wait as text beside a disabled test button", () => {
    setup(makeSettings({ testAvailableAt: "2026-10-25T12:03:00.000Z" }));
    expect(screen.getByRole("button", { name: "Send a test email" })).toBeDisabled();
    expect(
      screen.getByText("Wait a few minutes before sending another test email."),
    ).toBeInTheDocument();
  });

  it("shows sending, then the result, in words", () => {
    setup(alertsOn, { testSending: true });
    expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
  });

  it("announces results and shows errors with text", () => {
    setup(alertsOff, {
      note: {
        kind: "error",
        text: "We couldn't change your email settings. Try again in a minute.",
      },
      testNote: {
        kind: "status",
        text: "Sent to you@example.com. Check your inbox. It can take a minute.",
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't change your email settings");
    expect(screen.getByText(/Check your inbox/)).toBeInTheDocument();
  });

  it("never calls the situation safe", () => {
    for (const s of [smtpMissing, alertsOff, waitingForYou, alertsOn, cannotSend]) {
      const { container, unmount } = render(
        <EmailAlertsCard
          settings={s}
          busy={null}
          note={null}
          testNote={null}
          testSending={false}
          onSetEnabled={() => undefined}
          onSendTest={() => undefined}
        />,
      );
      expect(container.textContent).not.toMatch(/\bsafe\b|all good|all clear/i);
      unmount();
    }
  });
});
