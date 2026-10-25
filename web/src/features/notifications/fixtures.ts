import type { NotificationLinkView, NotificationSettings } from "@/lib/contracts";

export const NOW = "2026-10-25T12:00:00.000Z";

/** A working setup with alerts on. Override only what a test is about. */
export function makeSettings(overrides: Partial<NotificationSettings> = {}): NotificationSettings {
  return {
    state: "ON",
    email: "you@example.com",
    smtpConfigured: true,
    digestHour: 7,
    timeZone: "Europe/Amsterdam",
    lastSentAt: "2026-10-25T10:00:00.000Z",
    lastError: null,
    confirmResendAt: null,
    testAvailableAt: null,
    ...overrides,
  };
}

export const smtpMissing = makeSettings({
  state: "OFF",
  smtpConfigured: false,
  timeZone: null,
  lastSentAt: null,
});
export const alertsOff = makeSettings({ state: "OFF", lastSentAt: null });
export const waitingForYou = makeSettings({
  state: "PENDING_CONFIRM",
  lastSentAt: null,
  confirmResendAt: "2026-10-25T12:08:00.000Z",
});
export const alertsOn = makeSettings();
export const cannotSend = makeSettings({ smtpConfigured: false });

export function makeLink(overrides: Partial<NotificationLinkView> = {}): NotificationLinkView {
  return {
    purpose: "confirm",
    maskedEmail: "y***@example.com",
    alreadyDone: false,
    ...overrides,
  };
}
