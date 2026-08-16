import {
  economicsOf,
  type Plan,
  type PlanFeatures,
} from "@jaxongirman/tariff-card";
import type { Database } from "@jaxongirman/types";

import { supabase } from "@/lib/supabase";

/**
 * The console's view of the plans.
 *
 * Reading is a plain select — the catalogue is public. Writing is one definer
 * RPC, so the price and the capabilities always arrive together: a plan whose
 * features could be saved separately from its price is a plan that can be made
 * to promise more than it charges for without anyone noticing.
 */

export type PlanRow = Database["public"]["Tables"]["subscription_plans"]["Row"];

export type Overview = {
  plans: {
    id: string; code: string; name: string; price_amount: number; currency: string;
    period_days: number; estimated_cost_amount: number; is_active: boolean;
    is_featured: boolean; sort_order: number;
    members: number; lapsed: number; cancelled: number; mrr: number;
  }[];
  totals: { members?: number; new_this_month?: number; lapsed?: number; cancelled?: number };
  usage: Record<string, number>;
  jcoin_spent_30d: number;
};

export async function listPlans(): Promise<PlanRow[]> {
  const { data, error } = await supabase
    .from("subscription_plans").select("*").order("sort_order").order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function loadOverview(): Promise<Overview> {
  const { data, error } = await supabase.rpc("admin_subscription_overview");
  if (error) throw error;
  return data as unknown as Overview;
}

export type SavePlanInput = {
  id: string | null;
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
  estimatedCostAmount: number;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  features: PlanFeatures;
};

export async function savePlan(input: SavePlanInput): Promise<PlanRow> {
  const { data, error } = await supabase.rpc("admin_save_subscription_plan", {
    // Null rather than omitted: the key is dropped from the body otherwise, and
    // a parameter with no default cannot then be resolved.
    p_id: input.id ?? (null as unknown as string),
    p_code: input.code,
    p_name: input.name,
    p_price_amount: input.priceAmount,
    p_features: input.features as never,
    p_subtitle: input.subtitle,
    p_description: input.description,
    p_badge: input.badge,
    p_cta_label: input.ctaLabel,
    p_compare_at_amount: input.compareAtAmount,
    p_currency: input.currency,
    p_period_days: input.periodDays,
    p_estimated_cost_amount: input.estimatedCostAmount,
    p_is_active: input.isActive,
    p_is_featured: input.isFeatured,
    p_sort_order: input.sortOrder,
  });
  if (error) throw error;
  return data as unknown as PlanRow;
}

/** A row as the shared card reads it, so the preview is the real thing. */
export function planFromRow(row: {
  code: string; name: string; subtitle: string; description: string; badge: string;
  cta_label: string; price_amount: number; compare_at_amount: number; currency: string;
  period_days: number; features: unknown;
}): Plan {
  return {
    code: row.code,
    name: row.name,
    subtitle: row.subtitle,
    description: row.description,
    badge: row.badge,
    ctaLabel: row.cta_label,
    priceAmount: row.price_amount,
    compareAtAmount: row.compare_at_amount,
    currency: row.currency,
    periodDays: row.period_days,
    features: (row.features ?? {}) as PlanFeatures,
  };
}

export { economicsOf };
