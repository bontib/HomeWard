"use client";
import { useId, useRef, useState } from "react";
import { cn } from "./cn";
import { Icon } from "./icons";
import { Spinner } from "./Spinner";

/** Drop a file or press the button. Checks size here for a fast message; the server checks again. */
export function FileDrop({
  label,
  hint,
  accept,
  maxBytes,
  busy,
  onFile,
}: {
  label: string;
  hint?: string;
  accept?: string;
  maxBytes: number;
  busy?: boolean;
  onFile: (file: File) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function take(file: File | undefined) {
    if (!file) return;
    if (file.size > maxBytes) {
      setError(`This file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
      return;
    }
    setError(null);
    onFile(file);
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files[0]);
        }}
        className={cn(
          "rounded-card flex flex-col items-center gap-2 border-[1.5px] border-dashed px-4 py-6 text-center",
          over ? "border-brand bg-brand-tint" : "border-line-strong",
        )}
      >
        {busy ? <Spinner label="Uploading" /> : <Icon name="upload" className="text-ink-muted" />}
        <label htmlFor={inputId} className="t-label">
          {label}
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={accept}
          disabled={busy}
          className="sr-only"
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-control border-line-strong bg-surface-100 hover:bg-surface-200 min-h-11 cursor-pointer border px-4 text-[13px] font-semibold disabled:opacity-45"
        >
          Choose a file
        </button>
        {hint ? <p className="t-caption">{hint}</p> : null}
      </div>
      {error ? (
        <p role="alert" className="t-label text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}
