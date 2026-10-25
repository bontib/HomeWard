import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/ErrorText";
import { Icon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/Spinner";
import type { Note } from "./useNotificationActions";

/** "Send a test email" with the reason it is off written as text, because a disabled button can't be focused. */
export function TestEmailButton({
  blockedReason,
  sending,
  note,
  onSend,
}: {
  blockedReason: string | null;
  sending: boolean;
  note: Note | null;
  onSend: () => void;
}) {
  const reasonId = "test-email-reason";
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="secondary"
        className="w-full sm:w-auto"
        disabled={Boolean(blockedReason) || sending}
        aria-describedby={blockedReason ? reasonId : undefined}
        onClick={onSend}
      >
        {sending ? (
          <>
            <span aria-hidden className="inline-flex">
              <Spinner label="" className="size-4" />
            </span>
            Sending...
          </>
        ) : (
          "Send a test email"
        )}
      </Button>
      {blockedReason && !sending ? (
        <p id={reasonId} className="t-caption flex items-start gap-1.5">
          <Icon name="info" className="mt-px size-4" />
          <span>{blockedReason}</span>
        </p>
      ) : null}
      {note?.kind === "error" ? <ErrorText>{note.text}</ErrorText> : null}
      {note && note.kind !== "error" ? (
        <p role="status" className="t-body flex items-start gap-1.5">
          <Icon name="info" className="text-brand mt-0.5 size-4" />
          <span>{note.text}</span>
        </p>
      ) : null}
    </div>
  );
}
