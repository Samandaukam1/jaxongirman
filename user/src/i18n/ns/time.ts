import { translations } from "../define";

/**
 * Spans of time, said in words. Month and weekday names are not here: they
 * are data in `lib/datetime.ts`, laid out the way each language writes a date.
 */
export default translations(
  {
    now: "hozir",
    past: "{{span}} oldin",
    future: "{{span}}dan keyin",
    unit: {
      year_one: "{{count}} yil", year_few: "{{count}} yil", year_many: "{{count}} yil", year_other: "{{count}} yil",
      month_one: "{{count}} oy", month_few: "{{count}} oy", month_many: "{{count}} oy", month_other: "{{count}} oy",
      week_one: "{{count}} hafta", week_few: "{{count}} hafta", week_many: "{{count}} hafta", week_other: "{{count}} hafta",
      day_one: "{{count}} kun", day_few: "{{count}} kun", day_many: "{{count}} kun", day_other: "{{count}} kun",
      hour_one: "{{count}} soat", hour_few: "{{count}} soat", hour_many: "{{count}} soat", hour_other: "{{count}} soat",
      minute_one: "{{count}} daqiqa", minute_few: "{{count}} daqiqa", minute_many: "{{count}} daqiqa", minute_other: "{{count}} daqiqa",
    },
    countdown: {
      none: "Muddat belgilanmagan",
      expired: "Muddat tugagan",
      withDays: "{{days}} kun {{clock}} qoldi",
      clock: "{{clock}} qoldi",
    },
    window: {
      expired: "Muddati tugagan",
      days_one: "{{count}} kun qoldi", days_few: "{{count}} kun qoldi", days_many: "{{count}} kun qoldi", days_other: "{{count}} kun qoldi",
      months_one: "{{count}} oy qoldi", months_few: "{{count}} oy qoldi", months_many: "{{count}} oy qoldi", months_other: "{{count}} oy qoldi",
    },
  },
  {
    now: "now",
    past: "{{span}} ago",
    future: "in {{span}}",
    unit: {
      year_one: "{{count}} year", year_few: "{{count}} years", year_many: "{{count}} years", year_other: "{{count}} years",
      month_one: "{{count}} month", month_few: "{{count}} months", month_many: "{{count}} months", month_other: "{{count}} months",
      week_one: "{{count}} week", week_few: "{{count}} weeks", week_many: "{{count}} weeks", week_other: "{{count}} weeks",
      day_one: "{{count}} day", day_few: "{{count}} days", day_many: "{{count}} days", day_other: "{{count}} days",
      hour_one: "{{count}} hour", hour_few: "{{count}} hours", hour_many: "{{count}} hours", hour_other: "{{count}} hours",
      minute_one: "{{count}} minute", minute_few: "{{count}} minutes", minute_many: "{{count}} minutes", minute_other: "{{count}} minutes",
    },
    countdown: {
      none: "No deadline set",
      expired: "Expired",
      withDays: "{{days}} d {{clock}} left",
      clock: "{{clock}} left",
    },
    window: {
      expired: "Expired",
      days_one: "{{count}} day left", days_few: "{{count}} days left", days_many: "{{count}} days left", days_other: "{{count}} days left",
      months_one: "{{count}} month left", months_few: "{{count}} months left", months_many: "{{count}} months left", months_other: "{{count}} months left",
    },
  },
  {
    now: "сейчас",
    past: "{{span}} назад",
    future: "через {{span}}",
    unit: {
      year_one: "{{count}} г.", year_few: "{{count}} г.", year_many: "{{count}} г.", year_other: "{{count}} г.",
      month_one: "{{count}} мес.", month_few: "{{count}} мес.", month_many: "{{count}} мес.", month_other: "{{count}} мес.",
      week_one: "{{count}} нед.", week_few: "{{count}} нед.", week_many: "{{count}} нед.", week_other: "{{count}} нед.",
      day_one: "{{count}} дн.", day_few: "{{count}} дн.", day_many: "{{count}} дн.", day_other: "{{count}} дн.",
      hour_one: "{{count}} ч", hour_few: "{{count}} ч", hour_many: "{{count}} ч", hour_other: "{{count}} ч",
      minute_one: "{{count}} мин", minute_few: "{{count}} мин", minute_many: "{{count}} мин", minute_other: "{{count}} мин",
    },
    countdown: {
      none: "Срок не задан",
      expired: "Срок истёк",
      withDays: "Осталось {{days}} дн. {{clock}}",
      clock: "Осталось {{clock}}",
    },
    window: {
      expired: "Срок истёк",
      days_one: "Осталось дней: {{count}}", days_few: "Осталось дней: {{count}}", days_many: "Осталось дней: {{count}}", days_other: "Осталось дней: {{count}}",
      months_one: "Осталось месяцев: {{count}}", months_few: "Осталось месяцев: {{count}}", months_many: "Осталось месяцев: {{count}}", months_other: "Осталось месяцев: {{count}}",
    },
  },
);
