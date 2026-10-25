import { describe, expect, it } from "vitest";
import {
  alertView,
  digestTimeText,
  hourText,
  minutesUntil,
  resendText,
  testBlockedReason,
} from "./display";
import {
  alertsOff,
  alertsOn,
  cannotSend,
  makeSettings,
  NOW,
  smtpMissing,
  waitingForYou,
} from "./fixtures";

const now = Date.parse(NOW);

describe("alertView", () => {
  it("derives every card state from the data", () => {
    expect(alertView(smtpMissing)).toBe("not-set-up");
    expect(alertView(alertsOff)).toBe("off");
    expect(alertView(waitingForYou)).toBe("pending");
    expect(alertView(alertsOn)).toBe("on");
    expect(alertView(cannotSend)).toBe("cant-send");
  });

  it("does not show a pending request as on", () => {
    expect(alertView(makeSettings({ state: "PENDING_CONFIRM", smtpConfigured: false }))).toBe(
      "not-set-up",
    );
  });
});

describe("digest time", () => {
  it("writes the hour the way people say it", () => {
    expect(hourText(7)).toBe("7 am");
    expect(hourText(0)).toBe("12 am");
    expect(hourText(12)).toBe("12 pm");
    expect(hourText(13)).toBe("1 pm");
  });

  it("names the server time zone, or just says server time before the worker has run", () => {
    expect(digestTimeText({ digestHour: 7, timeZone: "Europe/Amsterdam" })).toBe(
      "7 am (server time, Europe/Amsterdam)",
    );
    expect(digestTimeText({ digestHour: 7, timeZone: null })).toBe("7 am (server time)");
  });
});

describe("countdowns", () => {
  it("rounds up to whole minutes and stops at zero", () => {
    expect(minutesUntil("2026-10-25T12:07:10.000Z", now)).toBe(8);
    expect(minutesUntil("2026-10-25T12:00:30.000Z", now)).toBe(1);
    expect(minutesUntil("2026-10-25T11:59:00.000Z", now)).toBe(0);
    expect(minutesUntil(null, now)).toBe(0);
  });

  it("writes the wait for the resend button", () => {
    expect(resendText("2026-10-25T12:08:00.000Z", now)).toBe("You can ask again in 8 minutes.");
    expect(resendText("2026-10-25T12:01:00.000Z", now)).toBe("You can ask again in 1 minute.");
    expect(resendText(null, now)).toBeNull();
  });
});

describe("testBlockedReason", () => {
  it("is empty when alerts are on and email works", () => {
    expect(testBlockedReason(alertsOn, now)).toBeNull();
  });

  it("explains each reason in words", () => {
    expect(testBlockedReason(smtpMissing, now)).toBe("Email isn't set up on this HomeGuard.");
    expect(testBlockedReason(cannotSend, now)).toBe("Email isn't set up on this HomeGuard.");
    expect(testBlockedReason(alertsOff, now)).toBe("Turn on email alerts first.");
    expect(testBlockedReason(waitingForYou, now)).toBe("Turn on email alerts first.");
    expect(
      testBlockedReason(makeSettings({ testAvailableAt: "2026-10-25T12:03:00.000Z" }), now),
    ).toBe("Wait a few minutes before sending another test email.");
  });
});
