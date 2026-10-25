import { SubNav } from "@/components/ui/SubNav";

const ITEMS = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings/checks", label: "Checks" },
  { href: "/settings/notifications", label: "Notifications" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[880px] flex-col gap-6">
      <h1 className="t-page">Settings</h1>
      <SubNav label="Settings" items={ITEMS} />
      {children}
    </div>
  );
}
