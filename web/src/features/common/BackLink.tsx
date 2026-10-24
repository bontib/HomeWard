import Link from "next/link";
import { Icon } from "@/components/ui/icons";

export function BackLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="t-label inline-flex min-h-11 w-fit items-center gap-1 no-underline"
    >
      <Icon name="chevronLeft" className="size-4" />
      {children}
    </Link>
  );
}
