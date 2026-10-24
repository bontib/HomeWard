"use client";
import { useState } from "react";
import { UpdateFindingSchema } from "@/lib/contracts";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Field";
import { errorMessage } from "@/store/api";

/** Asks for a short reason, then calls `onConfirm`. The reason is checked with the API's schema. */
export function IgnoreFindingDialog({
  open,
  onClose,
  onConfirm,
  busy,
  serverError,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  busy: boolean;
  serverError: unknown;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const parsed = UpdateFindingSchema.safeParse({ state: "IGNORED", reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Add a short reason.");
      return;
    }
    setError(null);
    if (parsed.data.state === "IGNORED") onConfirm(parsed.data.reason);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Ignore this problem?"
      description="It stays on the list as ignored and no longer counts toward the device's risk. You can reopen it later."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || reason.trim() === ""}>
            Ignore problem
          </Button>
        </>
      }
    >
      <Textarea
        label="Why are you ignoring it?"
        help="For example: Not exposed to the internet."
        value={reason}
        maxLength={200}
        onChange={(e) => setReason(e.target.value)}
        error={error ?? (serverError ? errorMessage(serverError) : null)}
      />
      {reason.trim() === "" ? <p className="t-caption">Add a short reason.</p> : null}
    </Dialog>
  );
}
