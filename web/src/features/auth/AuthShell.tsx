import type { ReactNode } from "react";
import { Logo } from "@/features/shell/Logo";
import { RiskBadge } from "@/features/risk/RiskBadge";

/** Split layout from the design: pitch on the left, form on the right. Stacks on phones. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-surface-0 grid min-h-screen grid-cols-1 md:grid-cols-2">
      <div className="bg-brand-tint flex flex-col gap-6 p-6 md:justify-between md:p-12">
        <Logo />
        <div className="flex max-w-xl flex-col gap-4">
          <h1 className="t-page md:text-[40px] md:leading-[46px]">
            See which devices in your home need an update
          </h1>
          <p className="t-body text-ink-muted">
            Add your consoles, TV, PC and smart home gear once. HomeGuard checks their software
            against known vulnerabilities and tells you what to do, in plain words.
          </p>
          <ul className="m-0 hidden list-none flex-wrap gap-2 p-0 md:flex">
            <li>
              <RiskBadge level="critical" />
            </li>
            <li>
              <RiskBadge level="vulnerable" />
            </li>
            <li>
              <RiskBadge level="update" />
            </li>
            <li>
              <RiskBadge level="safe" />
            </li>
            <li>
              <RiskBadge level="unknown" />
            </li>
          </ul>
        </div>
        <p className="t-caption hidden md:block">
          Plain answers about your devices, not a security console.
        </p>
      </div>
      <main className="flex items-center justify-center p-6 md:p-12">
        <div className="flex w-full max-w-md flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}
