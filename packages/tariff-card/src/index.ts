/**
 * A plan, as a card reads it.
 *
 * The console's live preview and the screen that actually sells the plan have
 * to agree, or the preview is a guess and the only way to see the truth is to
 * buy something. React does not live here — the mobile app draws with React
 * Native and the web with the DOM — so what is shared is the part that would
 * otherwise be written twice and drift: which features become which line, in
 * which order, worded how, and what the price looks like once formatted.
 */

/**
 * The languages a card can be read in. Uzbek is the default everywhere, so the
 * console's preview — which passes none — reads exactly as it always has.
 */
export type CardLanguage = "uz" | "en" | "ru";

type Words = {
  som: string;
  period: { month: string; week: string; year: string; days: (n: number) => string };
  per: { day: string; week: string; month: string };
  perUnit: { day: string; week: string; month: string };
  periodNoun: { day: string; week: string; month: string };
  /** "Haftasiga 4 ta prezentatsiya", worded whole so each language can order it its own way. */
  presentations: (period: "day" | "week" | "month", n: number) => string;
  slidesUpTo: (n: number) => string;
  unlocks: (n: number) => string;
  tradeBoth: string;
  tradeBuy: string;
  editProjects: string;
  gamesUnlimited: string;
  gamesDaily: (n: number) => string;
  jcoin: string;
  unlimited: string;
  count: string;
  upTo: (n: number) => string;
  sections: { presentation: string; marathon: string; marketplace: string; game: string; pptx: string; jcoin: string };
  rows: {
    limit: string; slideCount: string; rollover: string; unlock: string;
    buy: string; sell: string; edit: string; present: string; download: string; resale: string;
    freeGames: string; afterFree: string; externalPptx: string; outsidePlan: string; withJcoin: string;
  };
  usage: Record<string, string>;
  used: (used: number, limit: number) => string;
  resetsToday: string;
  resetsTomorrow: string;
  resetsOn: (day: string) => string;
  weekdays: readonly string[];
};

const WORDS: Record<CardLanguage, Words> = {
  uz: {
    som: "so‘m",
    period: { month: "oy", week: "hafta", year: "yil", days: (n) => `${n} kun` },
    per: { day: "Kuniga", week: "Haftasiga", month: "Oyiga" },
    perUnit: { day: " / kun", week: " / hafta", month: " / oy" },
    periodNoun: { day: "Kunlik", week: "Haftalik", month: "Oylik" },
    presentations: (period, n) => `${{ day: "Kuniga", week: "Haftasiga", month: "Oyiga" }[period]} ${n} ta prezentatsiya`,
    slidesUpTo: (n) => `Har birida ${n} tagacha slayd`,
    unlocks: (n) => `Haftasiga ${n} ta premium ochish`,
    tradeBoth: "Marketplace xarid va savdosi",
    tradeBuy: "Marketplace xaridi",
    editProjects: "Marketplace loyihalarini tahrirlash",
    gamesUnlimited: "Cheksiz O‘yingoh o‘yinlari",
    gamesDaily: (n) => `Kuniga ${n} ta O‘yingoh o‘yini`,
    jcoin: "J Tanga ekotizimi",
    unlimited: "Cheksiz",
    count: "ta",
    upTo: (n) => `${n} tagacha`,
    sections: { presentation: "Prezentatsiyalar", marathon: "Marafonlar", marketplace: "Marketplace", game: "O‘yingoh", pptx: "PPTX", jcoin: "J Tanga" },
    rows: {
      limit: "limit", slideCount: "Slayd soni", rollover: "Ishlatilmagan limit keyingi davrga", unlock: "Premium ochish",
      buy: "Xarid qilish", sell: "Sotish", edit: "Tahrirlash", present: "Taqdimot qilish", download: "Yuklab olish", resale: "Qayta sotish",
      freeGames: "Bepul o‘yinlar", afterFree: "Limitdan keyin", externalPptx: "Tashqi PPTX namoyishi",
      outsidePlan: "Barcha tarifdan tashqari amallar", withJcoin: "J Tanga bilan",
    },
    usage: { presentation_weekly: "Prezentatsiyalar", marathon_unlock: "Premium ochish", game_free_daily: "O‘yinlar" },
    used: (used, limit) => `${used} / ${limit} ishlatildi`,
    resetsToday: "Yangi limitlar bugun yangilanadi",
    resetsTomorrow: "Yangi limitlar ertaga yangilanadi",
    resetsOn: (day) => `Yangi limitlar ${day} kuni yangilanadi`,
    weekdays: ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"],
  },
  en: {
    som: "UZS",
    period: { month: "month", week: "week", year: "year", days: (n) => `${n} days` },
    per: { day: "Daily:", week: "Weekly:", month: "Monthly:" },
    perUnit: { day: " / day", week: " / week", month: " / month" },
    periodNoun: { day: "Daily", week: "Weekly", month: "Monthly" },
    presentations: (period, n) => `${n} presentations a ${period}`,
    slidesUpTo: (n) => `Up to ${n} slides each`,
    unlocks: (n) => `${n} premium unlocks a week`,
    tradeBoth: "Marketplace buying and selling",
    tradeBuy: "Marketplace buying",
    editProjects: "Edit Marketplace projects",
    gamesUnlimited: "Unlimited O‘yingoh games",
    gamesDaily: (n) => `${n} O‘yingoh games a day`,
    jcoin: "The J Tanga ecosystem",
    unlimited: "Unlimited",
    count: "",
    upTo: (n) => `up to ${n}`,
    sections: { presentation: "Presentations", marathon: "Marathons", marketplace: "Marketplace", game: "O‘yingoh", pptx: "PPTX", jcoin: "J Tanga" },
    rows: {
      limit: "limit", slideCount: "Number of slides", rollover: "Unused limit carries over", unlock: "Premium unlocks",
      buy: "Buying", sell: "Selling", edit: "Editing", present: "Presenting", download: "Downloading", resale: "Reselling",
      freeGames: "Free games", afterFree: "After the limit", externalPptx: "Presenting an outside PPTX",
      outsidePlan: "Everything outside the plan", withJcoin: "With J Tanga",
    },
    usage: { presentation_weekly: "Presentations", marathon_unlock: "Premium unlocks", game_free_daily: "Games" },
    used: (used, limit) => `${used} / ${limit} used`,
    resetsToday: "Limits renew today",
    resetsTomorrow: "Limits renew tomorrow",
    resetsOn: (day) => `Limits renew on ${day}`,
    weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  },
  ru: {
    som: "сум",
    period: { month: "мес.", week: "нед.", year: "год", days: (n) => `${n} дн.` },
    per: { day: "В день:", week: "В неделю:", month: "В месяц:" },
    perUnit: { day: " / день", week: " / нед.", month: " / мес." },
    periodNoun: { day: "Дневной", week: "Недельный", month: "Месячный" },
    presentations: (period, n) => `Презентаций в ${{ day: "день", week: "неделю", month: "месяц" }[period]}: ${n}`,
    slidesUpTo: (n) => `До ${n} слайдов в каждой`,
    unlocks: (n) => `Премиум-открытий в неделю: ${n}`,
    tradeBoth: "Покупки и продажи в Marketplace",
    tradeBuy: "Покупки в Marketplace",
    editProjects: "Редактирование проектов Marketplace",
    gamesUnlimited: "Безлимитные игры O‘yingoh",
    gamesDaily: (n) => `Игр O‘yingoh в день: ${n}`,
    jcoin: "Экосистема J Tanga",
    unlimited: "Безлимитно",
    count: "",
    upTo: (n) => `до ${n}`,
    sections: { presentation: "Презентации", marathon: "Марафоны", marketplace: "Marketplace", game: "O‘yingoh", pptx: "PPTX", jcoin: "J Tanga" },
    rows: {
      limit: "лимит", slideCount: "Количество слайдов", rollover: "Неиспользованный лимит переносится", unlock: "Премиум-открытия",
      buy: "Покупка", sell: "Продажа", edit: "Редактирование", present: "Показ", download: "Скачивание", resale: "Перепродажа",
      freeGames: "Бесплатные игры", afterFree: "После лимита", externalPptx: "Показ внешнего PPTX",
      outsidePlan: "Всё, что вне тарифа", withJcoin: "За J Tanga",
    },
    usage: { presentation_weekly: "Презентации", marathon_unlock: "Премиум-открытия", game_free_daily: "Игры" },
    used: (used, limit) => `использовано ${used} / ${limit}`,
    resetsToday: "Лимиты обновятся сегодня",
    resetsTomorrow: "Лимиты обновятся завтра",
    resetsOn: (day) => `Лимиты обновятся: ${day}`,
    weekdays: ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"],
  },
};

/** One capability as an admin configured it. Unknown keys are ignored, not feared. */
export type PlanFeature = {
  enabled?: boolean;
  unlimited?: boolean;
  limit?: number | null;
  period?: "day" | "week" | "month";
  cost?: number;
  unit?: string;
  description?: string;
  rollover?: boolean;
};

export type PlanFeatures = Record<string, PlanFeature | undefined>;

export type Plan = {
  code: string;
  name: string;
  subtitle: string;
  description: string;
  badge: string;
  ctaLabel: string;
  priceAmount: number;
  compareAtAmount: number;
  currency: string;
  periodDays: number;
  features: PlanFeatures;
};

/* ------------------------------------------------------------------ money */

/**
 * `36000` becomes `36 000`.
 *
 * A narrow no-break space, so a price never wraps across a line in the one
 * place a reader is most likely to be counting digits.
 */
export function formatAmount(amount: number): string {
  return Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** `so‘m / oy` — the period said in words rather than as a day count. */
export function periodLabel(periodDays: number, language: CardLanguage = "uz"): string {
  const words = WORDS[language].period;
  if (periodDays === 30 || periodDays === 31) return words.month;
  if (periodDays === 7) return words.week;
  if (periodDays === 365 || periodDays === 366) return words.year;
  return words.days(periodDays);
}

export function priceLine(plan: Plan, language: CardLanguage = "uz"): { amount: string; unit: string } {
  return {
    amount: formatAmount(plan.priceAmount),
    unit: `${plan.currency === "UZS" ? WORDS[language].som : plan.currency} / ${periodLabel(plan.periodDays, language)}`,
  };
}

/* --------------------------------------------------------------- the lines */

export type FeatureLine = { key: string; label: string; included: boolean };

/**
 * The card's seven lines, in the order they are read.
 *
 * A card that listed every configured capability would be a settings dump —
 * the detail belongs in the sheet behind "all features". These are the ones
 * worth deciding on, and each is worded from the plan's own numbers so an admin
 * changing four to five changes the sentence too.
 *
 * A feature an admin turned off is dropped rather than shown crossed out: a
 * card is an argument for buying, and the argument against belongs in the
 * detail sheet where the whole picture is.
 */
export function cardLines(plan: Plan, language: CardLanguage = "uz"): FeatureLine[] {
  const f = plan.features;
  const words = WORDS[language];
  const lines: FeatureLine[] = [];

  const weekly = f.presentation_weekly;
  if (weekly?.enabled && (weekly.limit ?? 0) > 0) {
    lines.push({ key: "presentation_weekly", included: true, label: words.presentations(weekly.period ?? "week", weekly.limit ?? 0) });
  }

  const slides = f.presentation_max_slides;
  if (slides?.enabled && (slides.limit ?? 0) > 0) {
    lines.push({ key: "presentation_max_slides", included: true, label: words.slidesUpTo(slides.limit ?? 0) });
  }

  const unlock = f.marathon_unlock;
  if (unlock?.enabled && (unlock.limit ?? 0) > 0) {
    lines.push({ key: "marathon_unlock", included: true, label: words.unlocks(unlock.limit ?? 0) });
  }

  if (f.marketplace_buy?.enabled && f.marketplace_sell?.enabled) {
    lines.push({ key: "marketplace_trade", included: true, label: words.tradeBoth });
  } else if (f.marketplace_buy?.enabled) {
    lines.push({ key: "marketplace_trade", included: true, label: words.tradeBuy });
  }

  if (f.marketplace_edit?.enabled) {
    lines.push({ key: "marketplace_edit", included: true, label: words.editProjects });
  }

  const games = f.game_free_daily;
  if (games?.enabled) {
    lines.push({
      key: "game_free_daily",
      included: true,
      label: games.unlimited ? words.gamesUnlimited : words.gamesDaily(games.limit ?? 0),
    });
  }

  lines.push({ key: "jcoin", included: true, label: words.jcoin });
  return lines;
}

/* -------------------------------------------------------------- the sheet */

export type DetailRow = { label: string; value: string; included: boolean };
export type DetailSection = { key: string; title: string; rows: DetailRow[] };

const YES = "✓";
const NO = "✕";

/**
 * "Haftasiga", "Oyiga" — the limit's own period, in words.
 *
 * The key is still `presentation_weekly` for every plan made before periods
 * could change, so the sentence has to follow the period stored beside the
 * limit rather than the name of the key. Week is what an unstated period has
 * always meant.
 */
export function perPeriod(period: PlanFeature["period"], language: CardLanguage = "uz"): string {
  return WORDS[language].per[period ?? "week"];
}

function periodNoun(period: PlanFeature["period"], language: CardLanguage): string {
  return WORDS[language].periodNoun[period ?? "week"];
}

function limitText(feature: PlanFeature | undefined, language: CardLanguage): string {
  const words = WORDS[language];
  if (!feature?.enabled) return NO;
  if (feature.unlimited) return words.unlimited;
  if (!feature.limit) return NO;
  const per = feature.period ? words.perUnit[feature.period] : "";
  return `${feature.limit}${words.count ? ` ${words.count}` : ""}${per}`;
}

/**
 * Everything the plan does, grouped the way somebody deciding would ask.
 *
 * This is where a capability that is switched off is shown as switched off —
 * the reader is comparing rather than being sold to, and "download ✕" is the
 * answer to a question they came here with.
 */
export function detailSections(plan: Plan, language: CardLanguage = "uz"): DetailSection[] {
  const f = plan.features;
  const words = WORDS[language];
  const rows = words.rows;
  return [
    {
      key: "presentation",
      title: words.sections.presentation,
      rows: [
        { label: `${periodNoun(f.presentation_weekly?.period, language)} ${rows.limit}`, value: limitText(f.presentation_weekly, language), included: Boolean(f.presentation_weekly?.enabled) },
        { label: rows.slideCount, value: f.presentation_max_slides?.limit ? words.upTo(f.presentation_max_slides.limit) : NO, included: Boolean(f.presentation_max_slides?.enabled) },
        { label: rows.rollover, value: f.presentation_weekly?.rollover ? YES : NO, included: Boolean(f.presentation_weekly?.rollover) },
      ],
    },
    {
      key: "marathon",
      title: words.sections.marathon,
      rows: [
        { label: rows.unlock, value: limitText(f.marathon_unlock, language), included: Boolean(f.marathon_unlock?.enabled) },
      ],
    },
    {
      key: "marketplace",
      title: words.sections.marketplace,
      rows: [
        { label: rows.buy, value: f.marketplace_buy?.enabled ? YES : NO, included: Boolean(f.marketplace_buy?.enabled) },
        { label: rows.sell, value: f.marketplace_sell?.enabled ? YES : NO, included: Boolean(f.marketplace_sell?.enabled) },
        { label: rows.edit, value: f.marketplace_edit?.enabled ? YES : NO, included: Boolean(f.marketplace_edit?.enabled) },
        { label: rows.present, value: f.marketplace_present?.enabled ? YES : NO, included: Boolean(f.marketplace_present?.enabled) },
        { label: rows.download, value: f.marketplace_download?.enabled ? YES : NO, included: Boolean(f.marketplace_download?.enabled) },
        { label: rows.resale, value: f.marketplace_resale?.enabled ? YES : NO, included: Boolean(f.marketplace_resale?.enabled) },
      ],
    },
    {
      key: "game",
      title: words.sections.game,
      rows: [
        { label: rows.freeGames, value: limitText(f.game_free_daily, language), included: Boolean(f.game_free_daily?.enabled) },
        { label: rows.afterFree, value: f.game_cost_after_free?.cost ? `${f.game_cost_after_free.cost} J` : "—", included: true },
      ],
    },
    {
      key: "pptx",
      title: words.sections.pptx,
      rows: [
        { label: rows.externalPptx, value: f.external_pptx_present?.cost ? `${f.external_pptx_present.cost} J` : "—", included: true },
      ],
    },
    {
      key: "jcoin",
      title: words.sections.jcoin,
      rows: [
        { label: rows.outsidePlan, value: rows.withJcoin, included: true },
      ],
    },
  ];
}

/* ------------------------------------------------------------- economics */

export type Economics = {
  price: number;
  estimatedCost: number;
  grossProfit: number;
  marginPercent: number;
  /** True when the configuration looks like it loses money. Never blocking. */
  lossy: boolean;
};

/**
 * What a plan is expected to earn, against what an admin believes it costs.
 *
 * The cost is a belief, so this is an estimate and says so wherever it is
 * shown. It warns and never blocks: an admin deliberately running a plan at a
 * loss to win a market is making a decision, not a mistake.
 */
export function economicsOf(plan: Pick<Plan, "priceAmount"> & { estimatedCostAmount: number }): Economics {
  const price = Math.max(plan.priceAmount, 0);
  const estimatedCost = Math.max(plan.estimatedCostAmount, 0);
  const grossProfit = price - estimatedCost;
  return {
    price,
    estimatedCost,
    grossProfit,
    marginPercent: price > 0 ? Math.round((grossProfit / price) * 100) : 0,
    lossy: price > 0 && grossProfit < 0,
  };
}

/* ---------------------------------------------------------------- usage */

/** What `quota_status` answers, as a screen needs to read it. */
export type QuotaStatus = {
  feature: string;
  enabled: boolean;
  unlimited?: boolean;
  limit?: number | null;
  used?: number;
  remaining?: number | null;
  resets_at?: string | null;
};

export type UsageLine = {
  key: string;
  label: string;
  /** `3 / 4 ishlatildi`, or `Cheksiz` where there is no ceiling. */
  detail: string;
  used: number;
  limit: number | null;
  unlimited: boolean;
};

/**
 * What a member has spent this period.
 *
 * A "Premium" badge tells somebody they paid; this tells them what they have
 * left, which is the thing they actually came to the page to find out.
 */
export function usageLines(statuses: QuotaStatus[], language: CardLanguage = "uz"): UsageLine[] {
  const words = WORDS[language];
  return statuses
    .filter((status) => status.enabled)
    .map((status) => {
      const used = status.used ?? 0;
      const unlimited = Boolean(status.unlimited);
      const limit = unlimited ? null : status.limit ?? 0;
      return {
        key: status.feature,
        label: words.usage[status.feature] ?? status.feature,
        detail: unlimited ? words.unlimited : words.used(used, limit ?? 0),
        used,
        limit,
        unlimited,
      };
    });
}

/**
 * "Yangi limitlar dushanba kuni yangilanadi".
 *
 * Said as a day rather than a date: somebody planning their week thinks in
 * days, and a date makes them work out which one it is.
 */
export function resetLabel(resetsAt: string | null | undefined, language: CardLanguage = "uz"): string | null {
  if (!resetsAt) return null;
  const when = new Date(resetsAt);
  if (Number.isNaN(when.getTime())) return null;

  const words = WORDS[language];
  const today = new Date();
  const sameDay = when.toDateString() === today.toDateString();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (sameDay) return words.resetsToday;
  if (when.toDateString() === tomorrow.toDateString()) return words.resetsTomorrow;
  return words.resetsOn(words.weekdays[when.getDay()]!);
}
