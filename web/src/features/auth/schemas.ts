import { z } from "zod";

export const MIN_PASSWORD = 12;

const email = z.string().trim().min(1, "Enter your email.").email("Enter a valid email address.");

export const LoginFormSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

export const SignupFormSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80, "Use 80 characters or fewer."),
  email,
  password: z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`),
});

export const ChangePasswordFormSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`),
});

/** Only allow paths inside this app, so a link cannot send people to another site. */
export function safeNextPath(next: string | undefined): string {
  if (!next || !next.startsWith("/")) return "/";
  // Browsers treat backslashes like slashes and drop tabs and newlines, so "/\\evil.example"
  // and "/<TAB>/evil.example" would leave the site. No legitimate path needs these.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  const base = "http://app.invalid";
  try {
    const url = new URL(next, base);
    if (url.origin !== base) return "/";
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}
