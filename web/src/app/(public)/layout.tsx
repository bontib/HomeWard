import type { Metadata } from "next";
import { Logo } from "@/features/shell/Logo";

// The links carry a token. Keep these pages out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Pages anyone can open from a mail: no sign-in, no app shell. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-0 flex min-h-screen flex-col items-center gap-6 p-6 md:justify-center">
      <Logo />
      <main className="w-full max-w-[480px]">{children}</main>
    </div>
  );
}
