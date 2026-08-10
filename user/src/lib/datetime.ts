/**
 * Uzbek dates and live countdowns.
 *
 * Hermes ships without a full ICU, so `Intl` cannot be trusted to produce
 * "9-avgust, yakshanba" on a device. Everything here is formatted by hand, the
 * same way `format.ts` already handles relative time.
 */

import { useEffect, useState } from "react";

const MONTHS = [
  "yanvar", "fevral", "mart", "aprel", "may", "iyun",
  "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
] as const;

const MONTHS_SHORT = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"] as const;

const WEEKDAYS = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "9-avgust, yakshanba" — the header's date line. */
export function formatLongDate(date: Date): string {
  return `${date.getDate()}-${MONTHS[date.getMonth()]}, ${WEEKDAYS[date.getDay()]}`;
}

/** "9-avg, 17:04" — for cards, where the weekday would be noise. */
export function formatShortDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getDate()}-${MONTHS_SHORT[date.getMonth()]}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "9-avgust 2026" — dates far enough away that the time is irrelevant. */
export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getDate()}-${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatClock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * A clock a component may read during render.
 *
 * `Date.now()` in a render body is impure — two renders of the same props can
 * disagree — so the current time is held in state and advanced by an effect.
 * Pass `active: false` and no interval is created at all, which is what keeps a
 * list of finished surveys from running one timer per row.
 */
export function useNow(active = true, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

export type Countdown = {
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
};

export function countdownTo(target: string | Date | null | undefined, now: number = Date.now()): Countdown | null {
  if (!target) return null;
  const time = (typeof target === "string" ? new Date(target) : target).getTime();
  if (Number.isNaN(time)) return null;
  const totalMs = time - now;
  if (totalMs <= 0) return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0 };
  const seconds = Math.floor(totalMs / 1000);
  return {
    expired: false,
    days: Math.floor(seconds / 86_400),
    hours: Math.floor((seconds % 86_400) / 3_600),
    minutes: Math.floor((seconds % 3_600) / 60),
    seconds: seconds % 60,
    totalMs,
  };
}

/**
 * "1 kun 04:21:15 qoldi". Seconds are dropped past a day because a ticking
 * seconds digit next to a multi-day figure reads as noise rather than urgency.
 */
export function formatCountdown(countdown: Countdown | null): string {
  if (!countdown) return "Muddat belgilanmagan";
  if (countdown.expired) return "Muddat tugagan";
  const clock = `${pad(countdown.hours)}:${pad(countdown.minutes)}:${pad(countdown.seconds)}`;
  return countdown.days > 0 ? `${countdown.days} kun ${clock} qoldi` : `${clock} qoldi`;
}

/** Months of access left, phrased the way the account card says it. */
export function formatRemainingWindow(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const time = new Date(expiresAt).getTime();
  if (Number.isNaN(time)) return null;
  const days = Math.ceil((time - Date.now()) / 86_400_000);
  if (days <= 0) return "Muddati tugagan";
  if (days < 31) return `${days} kun qoldi`;
  return `${Math.round(days / 30)} oy qoldi`;
}
