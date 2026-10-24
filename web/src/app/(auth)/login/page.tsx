import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/features/auth/AuthShell";
import { LoginForm } from "@/features/auth/LoginForm";
import { safeNextPath } from "@/features/auth/schemas";
import { getSessionInfo } from "@/lib/auth";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeNextPath(next);
  if (await getSessionInfo(await headers())) redirect(target);
  return (
    <AuthShell>
      <LoginForm next={target} signupOpen={getEnv().ALLOW_SIGNUP} />
    </AuthShell>
  );
}
