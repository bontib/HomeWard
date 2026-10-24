import Link from "next/link";
import { Icon } from "@/components/ui/icons";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="text-ink hover:text-ink flex items-center gap-3 px-2 no-underline">
      <span className="rounded-control bg-brand text-on-brand grid size-9 flex-none place-items-center">
        <Icon name="shieldCheck" />
      </span>
      <span className="t-title">HomeGuard</span>
    </Link>
  );
}
