"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./cn";

export function SubNav({
  items,
  label,
}: {
  items: { href: string; label: string }[];
  label: string;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="border-line flex flex-wrap gap-1 border-b">
      {items.map((item) => {
        const current = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 items-center border-b-2 px-4 text-[15px] font-semibold no-underline",
              current
                ? "border-brand text-brand"
                : "text-ink-muted hover:text-ink border-transparent",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
