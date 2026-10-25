import { DIGEST_HOUR, type NotificationSettings } from "@/lib/contracts";

/** What the card shows. Derived from the data, never stored (architecture section 7.1). */
export type AlertView = "not-set-up" | "off" | "pending" | "on" | "cant-send";

export function alertView(settings: NotificationSettings): AlertView {
  if (settings.state === "ON") return settings.smtpConfigured ? "on" : "cant-send";
  if (!settings.smtpConfigured) return "not-set-up";
  return settings.state === "PENDING_CONFIRM" ? "pending" : "off";
}

/** 7 -> "7 am", 0 -> "12 am", 13 -> "1 pm". */
export function hourText(hour: number): string {
  const h = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DIGEST_HOUR;
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 === 0 ? 12 : h % 12} ${suffix}`;
}

/** "7 am (server time, Europe/Amsterdam)". The zone is unknown until the worker has run. */
export function digestTimeText(settings: Pick<NotificationSettings, "digestHour" | "timeZone">) {
  const zone = settings.timeZone ? `server time, ${settings.timeZone}` : "server time";
  return `${hourText(settings.digestHour)} (${zone})`;
}

/** Whole minutes left until `iso`, at least 1 while it is still in the future, else 0. */
export function minutesUntil(iso: string | null, now: number): number {
  if (!iso) return 0;
  const left = new Date(iso).getTime() - now;
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

export function resendText(confirmResendAt: string | null, now: number): string | null {
  const minutes = minutesUntil(confirmResendAt, now);
  if (minutes === 0) return null;
  return `You can ask again in ${minutes === 1 ? "1 minute" : `${minutes} minutes`}.`;
}

export const TEST_WAIT_TEXT = "Wait a few minutes before sending another test email.";

/** Why "Send a test email" is off, as text. Null when the button works. */
export function testBlockedReason(settings: NotificationSettings, now: number): string | null {
  if (!settings.smtpConfigured) return "Email isn't set up on this HomeGuard.";
  if (settings.state !== "ON") return "Turn on email alerts first.";
  if (minutesUntil(settings.testAvailableAt, now) > 0) return TEST_WAIT_TEXT;
  return null;
}

/** Masked address is kept for the landing pages; this only builds the heading text. */
export function confirmHeading(maskedEmail: string, purpose: "confirm" | "unsubscribe"): string {
  return purpose === "confirm"
    ? `Turn on email alerts for ${maskedEmail}?`
    : `Stop email alerts for ${maskedEmail}?`;
}
