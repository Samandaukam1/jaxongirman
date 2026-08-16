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
export function periodLabel(periodDays: number): string {
  if (periodDays === 30 || periodDays === 31) return "oy";
  if (periodDays === 7) return "hafta";
  if (periodDays === 365 || periodDays === 366) return "yil";
  return `${periodDays} kun`;
}

export function priceLine(plan: Plan): { amount: string; unit: string } {
  return {
    amount: formatAmount(plan.priceAmount),
    unit: `${plan.currency === "UZS" ? "so‘m" : plan.currency} / ${periodLabel(plan.periodDays)}`,
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
export function cardLines(plan: Plan): FeatureLine[] {
  const f = plan.features;
  const lines: FeatureLine[] = [];

  const weekly = f.presentation_weekly;
  if (weekly?.enabled && (weekly.limit ?? 0) > 0) {
    lines.push({ key: "presentation_weekly", included: true, label: `Haftasiga ${weekly.limit} ta prezentatsiya` });
  }

  const slides = f.presentation_max_slides;
  if (slides?.enabled && (slides.limit ?? 0) > 0) {
    lines.push({ key: "presentation_max_slides", included: true, label: `Har birida ${slides.limit} tagacha slayd` });
  }

  const unlock = f.marathon_unlock;
  if (unlock?.enabled && (unlock.limit ?? 0) > 0) {
    lines.push({ key: "marathon_unlock", included: true, label: `Haftasiga ${unlock.limit} ta premium ochish` });
  }

  if (f.marketplace_buy?.enabled && f.marketplace_sell?.enabled) {
    lines.push({ key: "marketplace_trade", included: true, label: "Marketplace xarid va savdosi" });
  } else if (f.marketplace_buy?.enabled) {
    lines.push({ key: "marketplace_trade", included: true, label: "Marketplace xaridi" });
  }

  if (f.marketplace_edit?.enabled) {
    lines.push({ key: "marketplace_edit", included: true, label: "Marketplace loyihalarini tahrirlash" });
  }

  const games = f.game_free_daily;
  if (games?.enabled) {
    lines.push({
      key: "game_free_daily",
      included: true,
      label: games.unlimited
        ? "Cheksiz O‘yingoh o‘yinlari"
        : `Kuniga ${games.limit} ta O‘yingoh o‘yini`,
    });
  }

  lines.push({ key: "jcoin", included: true, label: "J Tanga ekotizimi" });
  return lines;
}

/* -------------------------------------------------------------- the sheet */

export type DetailRow = { label: string; value: string; included: boolean };
export type DetailSection = { key: string; title: string; rows: DetailRow[] };

const YES = "✓";
const NO = "✕";

function limitText(feature: PlanFeature | undefined, unit: string): string {
  if (!feature?.enabled) return NO;
  if (feature.unlimited) return "Cheksiz";
  if (!feature.limit) return NO;
  const per = feature.period === "day" ? " / kun" : feature.period === "week" ? " / hafta" : feature.period === "month" ? " / oy" : "";
  return `${feature.limit} ${unit}${per}`;
}

/**
 * Everything the plan does, grouped the way somebody deciding would ask.
 *
 * This is where a capability that is switched off is shown as switched off —
 * the reader is comparing rather than being sold to, and "download ✕" is the
 * answer to a question they came here with.
 */
export function detailSections(plan: Plan): DetailSection[] {
  const f = plan.features;
  return [
    {
      key: "presentation",
      title: "Prezentatsiyalar",
      rows: [
        { label: "Haftalik limit", value: limitText(f.presentation_weekly, "ta"), included: Boolean(f.presentation_weekly?.enabled) },
        { label: "Slayd soni", value: f.presentation_max_slides?.limit ? `${f.presentation_max_slides.limit} tagacha` : NO, included: Boolean(f.presentation_max_slides?.enabled) },
        { label: "Ishlatilmagan limit keyingi haftaga", value: f.presentation_weekly?.rollover ? YES : NO, included: Boolean(f.presentation_weekly?.rollover) },
      ],
    },
    {
      key: "marathon",
      title: "Marafonlar",
      rows: [
        { label: "Premium ochish", value: limitText(f.marathon_unlock, "ta"), included: Boolean(f.marathon_unlock?.enabled) },
      ],
    },
    {
      key: "marketplace",
      title: "Marketplace",
      rows: [
        { label: "Xarid qilish", value: f.marketplace_buy?.enabled ? YES : NO, included: Boolean(f.marketplace_buy?.enabled) },
        { label: "Sotish", value: f.marketplace_sell?.enabled ? YES : NO, included: Boolean(f.marketplace_sell?.enabled) },
        { label: "Tahrirlash", value: f.marketplace_edit?.enabled ? YES : NO, included: Boolean(f.marketplace_edit?.enabled) },
        { label: "Taqdimot qilish", value: f.marketplace_present?.enabled ? YES : NO, included: Boolean(f.marketplace_present?.enabled) },
        { label: "Yuklab olish", value: f.marketplace_download?.enabled ? YES : NO, included: Boolean(f.marketplace_download?.enabled) },
        { label: "Qayta sotish", value: f.marketplace_resale?.enabled ? YES : NO, included: Boolean(f.marketplace_resale?.enabled) },
      ],
    },
    {
      key: "game",
      title: "O‘yingoh",
      rows: [
        { label: "Bepul o‘yinlar", value: limitText(f.game_free_daily, "ta"), included: Boolean(f.game_free_daily?.enabled) },
        { label: "Limitdan keyin", value: f.game_cost_after_free?.cost ? `${f.game_cost_after_free.cost} J` : "—", included: true },
      ],
    },
    {
      key: "pptx",
      title: "PPTX",
      rows: [
        { label: "Tashqi PPTX namoyishi", value: f.external_pptx_present?.cost ? `${f.external_pptx_present.cost} J` : "—", included: true },
      ],
    },
    {
      key: "jcoin",
      title: "J Tanga",
      rows: [
        { label: "Barcha tarifdan tashqari amallar", value: "J Tanga bilan", included: true },
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
