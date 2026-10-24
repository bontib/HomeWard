"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/icons";
import { useListDevicesQuery } from "@/features/devices/devicesApi";
import { isNeedsAttention } from "@/features/risk/display";
import { signOut } from "@/lib/auth-client";
import { Logo } from "./Logo";

type NavItem = { href: string; label: string; icon: IconName; match: (path: string) => boolean };

const NAV: NavItem[] = [
  { href: "/", label: "My home", icon: "home", match: (p) => p === "/" },
  { href: "/devices/new", label: "Add a device", icon: "plus", match: (p) => p === "/devices/new" },
  {
    href: "/vulnerabilities",
    label: "Vulnerabilities",
    icon: "list",
    match: (p) => p.startsWith("/vulnerabilities"),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: "settings",
    match: (p) => p.startsWith("/settings"),
  },
];

function NavList({ attention, pathname }: { attention: number; pathname: string }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {NAV.map((item) => {
        const current = item.match(pathname);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "rounded-control flex min-h-11 items-center gap-3 px-3 text-[15px] font-semibold no-underline",
                current
                  ? "bg-brand-tint text-brand"
                  : "text-ink hover:bg-surface-200 hover:text-ink",
              )}
            >
              <Icon name={item.icon} />
              {item.label}
              {item.href === "/" && attention > 0 ? (
                <span className="bg-critical-tint text-critical ml-auto rounded-full px-2 py-px text-xs leading-4 font-bold">
                  <span aria-hidden>{attention}</span>
                  <span className="sr-only">
                    {attention} {attention === 1 ? "device needs" : "devices need"} attention
                  </span>
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function UserFooter({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="border-line mt-auto flex items-center gap-3 border-t p-3">
      <Avatar name={name || email} />
      <div className="min-w-0 flex-1">
        <p className="t-label truncate">{name || email}</p>
        {name ? <p className="t-caption truncate">{email}</p> : null}
      </div>
      <IconButton label="Sign out" onClick={handleSignOut}>
        <Icon name="signOut" />
      </IconButton>
    </div>
  );
}

export function AppShell({
  user,
  children,
}: {
  user: { name: string; email: string };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { data } = useListDevicesQuery();
  const attention = (data?.devices ?? []).filter((d) => isNeedsAttention(d.status)).length;
  // The menu is open only for the page it was opened on, so it closes by itself on navigation.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const menuOpen = openOn === pathname;

  return (
    <div className="bg-surface-0 flex min-h-screen flex-col md:flex-row">
      <a
        href="#main"
        className="focus:rounded-control focus:bg-surface-100 sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2"
      >
        Skip to main content
      </a>

      {/* Phone: top bar with a menu button. */}
      <header className="border-line bg-surface-100 sticky top-0 z-20 border-b md:hidden">
        <div className="flex items-center justify-between px-2 py-2">
          <Logo />
          <IconButton
            label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setOpenOn(menuOpen ? null : pathname)}
          >
            <Icon name={menuOpen ? "x" : "menu"} />
          </IconButton>
        </div>
        {menuOpen ? (
          <div id="mobile-menu" className="border-line flex flex-col gap-4 border-t px-2 pt-2 pb-2">
            <nav aria-label="Main">
              <NavList attention={attention} pathname={pathname} />
            </nav>
            <UserFooter {...user} />
          </div>
        ) : null}
      </header>

      {/* Tablet and up: sidebar. */}
      <aside className="border-line bg-surface-100 sticky top-0 hidden h-screen w-58 flex-none flex-col gap-6 border-r px-4 py-6 md:flex">
        <Logo />
        <nav aria-label="Main">
          <NavList attention={attention} pathname={pathname} />
        </nav>
        <UserFooter {...user} />
      </aside>

      <main id="main" className="min-w-0 flex-1 px-4 py-6 md:p-8">
        {children}
      </main>
    </div>
  );
}
