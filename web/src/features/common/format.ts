const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/** "just now", "2 hours ago", "3 days ago". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${plural(Math.floor(diff / MINUTE), "minute", "minutes")} ago`;
  if (diff < DAY) return `${plural(Math.floor(diff / HOUR), "hour", "hours")} ago`;
  return `${plural(Math.floor(diff / DAY), "day", "days")} ago`;
}

/** "12 March 2026". Fixed locale so server and browser agree. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function countOf(n: number, one: string, many: string): string {
  return plural(n, one, many);
}

/** First two sentences, for CVE summaries (decision D11). */
export function firstTwoSentences(text: string): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g);
  if (!sentences) return text;
  return sentences.slice(0, 2).join("").trim();
}
