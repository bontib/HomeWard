"use client";
import { ErrorText } from "@/components/ui/ErrorText";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { fieldMessages } from "@/features/common/forms";
import { signUp } from "@/lib/auth-client";
import { MIN_PASSWORD, SignupFormSchema, nameFromEmail } from "./schemas";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = SignupFormSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldMessages(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    const { error } = await signUp.email({
      ...parsed.data,
      name: nameFromEmail(parsed.data.email),
    });
    if (error) {
      setBusy(false);
      // Same text for every failure, so the page does not reveal which emails exist.
      setFormError("We couldn't create an account. Try signing in.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <div>
        <h2 className="t-title">Create an account</h2>
        <p className="t-body text-ink-muted">Your devices stay private to you.</p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          help={`At least ${MIN_PASSWORD} characters.`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        {formError ? <ErrorText>{formError}</ErrorText> : null}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className="t-body text-ink-muted text-center">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
