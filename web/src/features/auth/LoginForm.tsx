"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { fieldMessages } from "@/features/common/forms";
import { signIn } from "@/lib/auth-client";
import { LoginFormSchema } from "./schemas";

export function LoginForm({ next, signupOpen }: { next: string; signupOpen: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = LoginFormSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldMessages(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    const { error } = await signIn.email(parsed.data);
    if (error) {
      setBusy(false);
      setFormError(
        error.status === 429
          ? "Too many tries. Wait a minute and try again."
          : "Email or password is wrong.",
      );
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <>
      <div>
        <h2 className="t-title">Welcome back</h2>
        <p className="t-body text-ink-muted">Sign in to check on your home network.</p>
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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        {formError ? (
          <p role="alert" className="t-label text-critical">
            {formError}
          </p>
        ) : null}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      {signupOpen ? (
        <p className="t-body text-ink-muted text-center">
          New to HomeGuard? <Link href="/signup">Create an account</Link>
        </p>
      ) : null}
    </>
  );
}
