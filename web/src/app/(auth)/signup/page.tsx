import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/features/auth/AuthShell";
import { SignupForm } from "@/features/auth/SignupForm";
import { getSessionInfo } from "@/lib/auth";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignupPage() {
  if (await getSessionInfo(await headers())) redirect("/");
  if (!getEnv().ALLOW_SIGNUP) {
    return (
      <AuthShell>
        <h2 className="t-title">Sign-up is turned off</h2>
        <p className="t-body text-ink-muted">
          Sign-up is turned off. Ask the person who runs this app.
        </p>
        <Link href="/login">Back to sign in</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell>
      <SignupForm />
    </AuthShell>
  );
}
