import { AppShell } from "@/features/shell/AppShell";
import { requireSession } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return <AppShell user={{ name: session.name, email: session.email }}>{children}</AppShell>;
}
