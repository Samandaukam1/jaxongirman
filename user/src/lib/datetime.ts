/**
 * Dates and live countdowns, in the app's language.
 *
 * Hermes ships without a full ICU, so `Intl` cannot be trusted to produce
 * "9-avgust, yakshanba" on a device. Everything here is formatted by hand from
 * the tables below, one per language, in the order that language writes a date.
 */

import { useEffect, useState } from "react";

import { i18n, isAppLanguage, type AppLanguage } from "../i18n";

type Calendar = {
  months: readonly string[];
  /** Months as they stand after a day number ("9 августа"); the same as `months` where nothing changes. */
  monthsOf: readonly string[];
  monthsShort: readonly string[];
  weekdays: readonly string[];
  weekdaysShort: readonly string[];
};

const CALENDARS: Record<AppLanguage, Calendar> = {
  uz: {
    months: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"],
    monthsOf: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"],
    monthsShort: ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"],
    weekdays: ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"],
    weekdaysShort: ["Yak", "Du", "Se", "Cho", "Pay", "Ju", "Sha"],
  },
  en: {
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    monthsOf: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    monthsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    weekdaysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  },
  ru: {
    months: ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"],
    monthsOf: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
    monthsShort: ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."],
    weekdays: ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"],
    weekdaysShort: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
  },
};

function current(): AppLanguage {
  return isAppLanguage(i18n.language) ? i18n.language : "uz";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Whether the phone shows a 12-hour clock. Read from the device's own locale,
 * so a phone set to the US reads "5:04 PM" whatever language the app is in.
 * Times are always in the device's time zone — `Date` already works in it.
 */
const TWELVE_HOUR = (() => {
  try {
    const options = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions() as { hour12?: boolean; hourCycle?: string };
    if (typeof options.hour12 === "boolean") return options.hour12;
    if (options.hourCycle) return options.hourCycle === "h11" || options.hourCycle === "h12";
    return /am|pm/i.test(new Date(2020, 0, 1, 15).toLocaleTimeString());
  } catch {
    return false;
  }
})();

/** "17:04", or "5:04 PM" on a phone that keeps a 12-hour clock. */
function clockOf(date: Date): string {
  if (!TWELVE_HOUR) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const hours = date.getHours() % 12 || 12;
  return `${hours}:${pad(date.getMinutes())} ${date.getHours() < 12 ? "AM" : "PM"}`;
}

/** "9-avgust, yakshanba" / "Sunday, August 9" / "9 августа, воскресенье" — the header's date line. */
export function formatLongDate(date: Date): string {
  const language = current();
  const calendar = CALENDARS[language];
  const day = date.getDate();
  if (language === "en") return `${calendar.weekdays[date.getDay()]}, ${calendar.months[date.getMonth()]} ${day}`;
  if (language === "ru") return `${day} ${calendar.monthsOf[date.getMonth()]}, ${calendar.weekdays[date.getDay()]}`;
  return `${day}-${calendar.months[date.getMonth()]}, ${calendar.weekdays[date.getDay()]}`;
}

/** "9-avg, 17:04" — for cards, where the weekday would be noise. */
export function formatShortDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const language = current();
  const month = CALENDARS[language].monthsShort[date.getMonth()];
  const clock = clockOf(date);
  if (language === "en") return `${month} ${date.getDate()}, ${clock}`;
  if (language === "ru") return `${date.getDate()} ${month}, ${clock}`;
  return `${date.getDate()}-${month}, ${clock}`;
}

/** "9-avgust 2026" — dates far enough away that the time is irrelevant. */
export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const language = current();
  const calendar = CALENDARS[language];
  if (language === "en") return `${calendar.months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  if (language === "ru") return `${date.getDate()} ${calendar.monthsOf[date.getMonth()]} ${date.getFullYear()}`;
  return `${date.getDate()}-${calendar.months[date.getMonth()]} ${date.getFullYear()}`;
}

/** "9 avgust" / "August 9" / "9 августа" — a day of this year, without the weekday. */
export function formatDayMonth(date: Date): string {
  const language = current();
  const calendar = CALENDARS[language];
  if (language === "en") return `${calendar.months[date.getMonth()]} ${date.getDate()}`;
  return `${date.getDate()} ${calendar.monthsOf[date.getMonth()]}`;
}

/** "Du" / "Mon" / "Пн". */
export function formatWeekdayShort(date: Date): string {
  return CALENDARS[current()].weekdaysShort[date.getDay()]!;
}

export function formatClock(date: Date): string {
  return clockOf(date);
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
 * "1 kun 04:21:15 qoldi" / "1 d 04:21:15 left". Seconds are dropped past a day because a ticking
 * seconds digit next to a multi-day figure reads as noise rather than urgency.
 */
export function formatCountdown(countdown: Countdown | null): string {
  if (!countdown) return i18n.t("time:countdown.none");
  if (countdown.expired) return i18n.t("time:countdown.expired");
  const clock = `${pad(countdown.hours)}:${pad(countdown.minutes)}:${pad(countdown.seconds)}`;
  return countdown.days > 0
    ? i18n.t("time:countdown.withDays", { days: countdown.days, clock })
    : i18n.t("time:countdown.clock", { clock });
}

/** Months of access left, phrased the way the account card says it. */
export function formatRemainingWindow(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const time = new Date(expiresAt).getTime();
  if (Number.isNaN(time)) return null;
  const days = Math.ceil((time - Date.now()) / 86_400_000);
  if (days <= 0) return i18n.t("time:window.expired");
  if (days < 31) return i18n.t("time:window.days", { count: days });
  return i18n.t("time:window.months", { count: Math.round(days / 30) });
}
