import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { FactList } from "@/components/ui/FactList";
import { ChangePasswordForm } from "@/features/settings/ChangePasswordForm";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const session = await requireSession();
  return (
    <div className="flex flex-col gap-6">
      <Card aria-labelledby="account-heading" className="flex flex-col gap-4">
        <h2 id="account-heading" className="t-heading">
          Your account
        </h2>
        <FactList
          items={[
            { label: "Name", value: session.name },
            { label: "Email", value: session.email },
          ]}
        />
      </Card>
      <Card aria-labelledby="password-heading" className="flex flex-col gap-4">
        <h2 id="password-heading" className="t-heading">
          Change password
        </h2>
        <ChangePasswordForm />
      </Card>
    </div>
  );
}
