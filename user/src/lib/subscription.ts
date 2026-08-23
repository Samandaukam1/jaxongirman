import type { Plan, PlanFeatures, QuotaStatus } from "@jaxongirman/tariff-card";

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
export type TariffPlan = Plan & { isFeatured: boolean; compareAtAmount: number };

export async function subscriptionPlans(): Promise<TariffPlan[]> {
  const { data, error } = await supabase
    .from("subscription_plans")
    .select("code, name, subtitle, description, badge, cta_label, price_amount, compare_at_amount, currency, period_days, features, is_featured")
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;

  return (data ?? []).map((row) => ({
    code: row.code,
    name: row.name,
    subtitle: row.subtitle ?? "",
    description: row.description ?? "",
    badge: row.badge ?? "",
    ctaLabel: row.cta_label ?? "",
    priceAmount: row.price_amount,
    compareAtAmount: row.compare_at_amount ?? 0,
    currency: row.currency,
    periodDays: row.period_days,
    features: (row.features ?? {}) as PlanFeatures,
    isFeatured: Boolean(row.is_featured),
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
    plan?: { code?: string; name?: string } | null;
  };
  return {
    member: Boolean(answer.member),
    status: answer.status ?? "inactive",
    expiresAt: answer.expires_at ?? null,
    planCode: answer.plan?.code ?? null,
    planName: answer.plan?.name ?? null,
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
