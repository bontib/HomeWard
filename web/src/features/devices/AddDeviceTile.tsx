import Link from "next/link";
import { Icon } from "@/components/ui/icons";

export function AddDeviceTile({ href = "/devices/new" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="rounded-card border-line-strong text-brand hover:bg-brand-tint flex min-h-38 flex-col items-center justify-center gap-2 border-[1.5px] border-dashed bg-transparent p-4 text-[15px] font-semibold no-underline"
    >
      <Icon name="plus" />
      Add a device
      <small className="text-ink-muted text-xs leading-4 font-medium">
        Console, TV, PC or smart home
      </small>
    </Link>
  );
}
