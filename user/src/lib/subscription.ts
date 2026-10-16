import type { Plan, PlanFeatures, QuotaStatus } from "@jaxongirman/tariff-card";

import { localized, localizedOr } from "./content";
import { supabase } from "./supabase";

/**
 * The tariff surface: what is for sale, and what the person looking has left.
 *
 * Both answers come from the server. A plan is never described by a constant in
 * the app — an admin shapes it in the console, and the card here is drawn from
 * the same `@jaxongirman/tariff-card` functions the console previews with, so
 * what was approved is what a buyer sees. Nothing about membership is decided
 * here either: `member` is what the database says, not a flag the app keeps.
 */

/** The plan as the card reads it, plus what the checkout needs to open an order. */
export type TariffPlan = Plan & {
  isFeatured: boolean;
  compareAtAmount: number;
  /** `coins`: a month of J Tanga (OSON, MAZZA, BEMALOL); `quota`: the old weekly count. */
  billingModel: "coins" | "quota";
  includedCoins: number;
  presentationUnits: number;
  pagesPerUnit: number;
};

export async function subscriptionPlans(): Promise<TariffPlan[]> {
  const { data, error } = await supabase
    .from("subscription_plans")
    // Every column, so a server without the tariff economy's columns still answers.
    .select("*")
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;

  return (data ?? []).filter((row) => (row as { is_visible?: boolean }).is_visible !== false).map((row) => ({
    code: row.code,
    // Operator-written words, in the app's language where they have been translated.
    name: localized(row.name, row.name_i18n),
    subtitle: localized(row.subtitle ?? "", row.subtitle_i18n),
    description: localized(row.description ?? "", row.description_i18n),
    badge: localized(row.badge ?? "", row.badge_i18n),
    // An untranslated button label gives way to the app's own "choose plan".
    ctaLabel: localizedOr(row.cta_label ?? "", row.cta_label_i18n, ""),
    priceAmount: row.price_amount,
    compareAtAmount: row.compare_at_amount ?? 0,
    currency: row.currency,
    periodDays: row.period_days,
    features: (row.features ?? {}) as PlanFeatures,
    isFeatured: Boolean(row.is_featured),
    billingModel: (row as { billing_model?: string }).billing_model === "coins" ? "coins" : "quota",
    includedCoins: (row as { included_coins?: number }).included_coins ?? 0,
    presentationUnits: (row as { presentation_units?: number }).presentation_units ?? 0,
    pagesPerUnit: (row as { pages_per_unit?: number }).pages_per_unit ?? 10,
  }));
}

export type Membership = {
  member: boolean;
  status: string;
  expiresAt: string | null;
  planCode: string | null;
  planName: string | null;
};

/** What the caller is entitled to, resolved by the server in one question. */
export async function myMembership(): Promise<Membership> {
  const { data, error } = await supabase.rpc("my_entitlements");
  if (error) throw error;

  const answer = (data ?? {}) as {
    member?: boolean;
    status?: string;
    expires_at?: string | null;
    plan?: { code?: string; name?: string; name_i18n?: unknown } | null;
  };
  return {
    member: Boolean(answer.member),
    status: answer.status ?? "inactive",
    expiresAt: answer.expires_at ?? null,
    planCode: answer.plan?.code ?? null,
    planName: answer.plan?.name ? localized(answer.plan.name, answer.plan.name_i18n) : null,
  };
}

export type RestartPreview = {
  member: boolean;
  planName: string | null;
  planCode: string | null;
  priceAmount: number;
  currency: string;
  remainingDays: number;
  /** Allowances already spent this period, which a restart gives back. */
  used: { feature: string; used: number }[];
};

/**
 * What a restart would cost, before it is paid for.
 *
 * The confirmation is only honest with the real numbers in it: "nine days left
 * and two of four presentations still unused" is a decision somebody can weigh,
 * and "your remaining balance will be cancelled" is a warning they cannot.
 */
export async function restartPreview(): Promise<RestartPreview> {
  const { data, error } = await supabase.rpc("subscription_restart_preview");
  if (error) throw error;
  const answer = (data ?? {}) as {
    member?: boolean;
    plan?: { code?: string; name?: string; price_amount?: number; currency?: string };
    remaining_days?: number;
    used?: { feature?: string; used?: number }[];
  };
  return {
    member: Boolean(answer.member),
    planName: answer.plan?.name ?? null,
    planCode: answer.plan?.code ?? null,
    priceAmount: answer.plan?.price_amount ?? 0,
    currency: answer.plan?.currency ?? "UZS",
    remainingDays: answer.remaining_days ?? 0,
    used: (answer.used ?? []).map((entry) => ({
      feature: String(entry.feature ?? ""),
      used: Number(entry.used ?? 0),
    })),
  };
}

/**
 * Every metered allowance and how much of it is gone.
 *
 * One call rather than one per feature: three round trips to draw three bars is
 * three chances for them to disagree with each other.
 */
export async function myUsage(): Promise<QuotaStatus[]> {
  const { data, error } = await supabase.rpc("my_usage");
  if (error) throw error;
  return (data ?? []) as QuotaStatus[];
}
