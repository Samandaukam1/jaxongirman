import { formatClock, formatDayMonth } from "@/lib/datetime";

/** A message's time in the list: the clock today, the day and month before. */
export function chatListTime(value: string): string {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString() ? formatClock(date) : formatDayMonth(date);
}

export function chatClock(value: string): string {
  return formatClock(new Date(value));
}

/** "mm:ss" for voice and video lengths. */
export function mediaLength(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** The divider between days in a conversation: today, yesterday, or the date. */
export function chatDay(value: string, words: { today: string; yesterday: string }): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (sameDay(date, today)) return words.today;
  if (sameDay(date, yesterday)) return words.yesterday;
  return formatDayMonth(date);
}

/**
 * When someone was last here, as a messenger says it: just now, minutes ago,
 * today or yesterday at a time, or the date.
 */
export function lastSeen(value: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const date = new Date(value);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return t("seen.justNow");
  if (minutes < 60) return t("seen.minutes", { count: minutes });
  const today = new Date();
  if (sameDay(date, today)) return t("seen.today", { time: formatClock(date) });
  if (sameDay(date, new Date(today.getTime() - 86_400_000))) return t("seen.yesterday", { time: formatClock(date) });
  return t("seen.date", { date: formatDayMonth(date) });
}
