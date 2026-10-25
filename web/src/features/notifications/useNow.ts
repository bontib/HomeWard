"use client";
import { useEffect, useState } from "react";

/** Current time in ms. Ticks every 15 s while `until` is in the future, so countdowns update. */
export function useNow(until: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  const waiting = until !== null && new Date(until).getTime() > now;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [waiting]);
  return now;
}
