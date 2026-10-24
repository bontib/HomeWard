"use client";
import { ErrorText } from "@/components/ui/ErrorText";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { ChangePasswordFormSchema, MIN_PASSWORD } from "@/features/auth/schemas";
import { fieldMessages } from "@/features/common/forms";
import { changePassword } from "@/lib/auth-client";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    setFormError(null);
    const parsed = ChangePasswordFormSchema.safeParse({
      currentPassword: current,
      newPassword: next,
    });
    if (!parsed.success) {
      setErrors(fieldMessages(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    const { error } = await changePassword({ ...parsed.data, revokeOtherSessions: true });
    setBusy(false);
    if (error) {
      setFormError(
        error.code === "INVALID_PASSWORD"
          ? "That's not your current password."
          : "Something went wrong. Try again.",
      );
      return;
    }
    setCurrent("");
    setNext("");
    setDone(true);
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-4">
      <Input
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        error={errors.currentPassword}
      />
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        help={`At least ${MIN_PASSWORD} characters.`}
        value={next}
        onChange={(e) => setNext(e.target.value)}
        error={errors.newPassword}
      />
      {formError ? <ErrorText>{formError}</ErrorText> : null}
      {done ? (
        <p role="status" className="t-label text-safe">
          Password changed. You were signed out on your other devices.
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
