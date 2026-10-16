import { supabase } from "./supabase";

/**
 * The J Tanga economy as the admin panel edits it.
 *
 * Every figure is the server's: `admin_economy_overview` reads the version in
 * force, its service prices, the tariffs, the packs, the welcome and what is
 * owed. Edits are never written straight to a table — prices publish a new
 * version (`admin_publish_economy`, super admins only) so charges already made
 * keep the version they used, and every change lands in the audit log.
 */

export type Rounding = "ceil" | "round" | "floor";

export type WelcomeSettings = {
  enabled?: boolean;
  pages?: number;
  expires_days?: number | null;
  eligible_from?: string;
  retroactive?: boolean;
};

export type EconomyVersion = {
  id: number;
  version: number;
  coin_value_uzs: number;
  rounding: Rounding;
  no_plan_multiplier: number;
  min_charge: number;
  max_charge: number;
  welcome: WelcomeSettings;
  note: string;
  effective_from: string;
  created_at: string;
};

export type ServiceKey = "presentation" | "game" | "cv" | "article" | "independent_work";

export type ServicePrice = {
  service: ServiceKey;
  unit: "page" | "question" | "ai_cost";
  coins_per_unit: number;
  ai_markup: number;
  min_units: number;
  max_units: number;
  min_charge: number;
  max_charge: number;
  promo_percent: number;
  promo_until: string | null;
  is_enabled: boolean;
};

export type I18n = { uz?: string; en?: string; ru?: string };

export type EconomyPlan = {
  id: string;
  code: string;
  name: string;
  price_amount: number;
  period_days: number;
  is_active: boolean;
  is_visible: boolean;
  billing_model: "quota" | "coins";
  included_coins: number;
  presentation_units: number;
  pages_per_unit: number;
  page_multiplier: number;
  estimated_cost_amount: number;
  name_i18n: I18n;
  description_i18n: I18n;
  badge_i18n: I18n;
};

export type EconomyPackage = {
  id: string;
  code: string;
  label: string;
  description: string;
  coins: number;
  bonus_coins: number;
  presentation_pages: number;
  price_amount: number;
  currency: string;
  sort_order: number;
  is_active: boolean;
  purchase_limit: number | null;
  starts_at: string | null;
  ends_at: string | null;
  label_i18n: I18n;
  description_i18n: I18n;
};

export type EconomyWarning = { level: "error" | "warning"; code: string; message: string; plan?: string; package?: string };

export type EconomyOverview = {
  current: EconomyVersion;
  services: ServicePrice[];
  history: { version: number; effective_from: string; note: string; created_by: string | null; coin_value_uzs: number; no_plan_multiplier: number; rounding: Rounding }[];
  plans: EconomyPlan[];
  packages: EconomyPackage[];
  welcome: { settings: WelcomeSettings; accounts: number; pages_granted: number; pages_left: number };
  liability: { coins: number; plan_coins: number; bought_pages: number; coin_value_uzs: number };
  warnings: EconomyWarning[];
};

export const SERVICE_LABELS: Record<ServiceKey, string> = {
  presentation: "Taqdimot (sahifa)",
  game: "O‘yingoh (savol)",
  cv: "CV (AI xarajati)",
  article: "Maqola (AI xarajati)",
  independent_work: "Mustaqil ish (AI xarajati)",
};

/** Untyped call: these RPCs are newer than the generated types the panel was vendored with. */
async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const loadEconomy = () => call<EconomyOverview>("admin_economy_overview");

export const publishEconomy = (settings: Partial<EconomyVersion> & { welcome?: WelcomeSettings }, services: Partial<Record<ServiceKey, Partial<ServicePrice>>>, note: string) =>
  call<{ version: number; effective_from: string; warnings: EconomyWarning[] }>("admin_publish_economy", { p_settings: settings, p_services: services, p_note: note });

export const savePlanEconomy = (planId: string, payload: Partial<EconomyPlan>) =>
  call<EconomyPlan>("admin_save_plan_economy", { p_plan_id: planId, p_payload: payload });

export const savePackage = (payload: Partial<EconomyPackage>) => call<EconomyPackage>("admin_save_package", { p_payload: payload });

export const grantPresentationPages = (userId: string, pages: number, note: string) =>
  call<string>("admin_grant_presentation_pages", { p_user_id: userId, p_pages: pages, p_note: note });

export const backfillWelcome = (limit: number) => call<{ checked: number; granted: number }>("admin_welcome_backfill", { p_limit: limit });

/** J Tanga a deck of `pages` costs on a plan, rounded the version's way. */
export function deckCoins(pages: number, perPage: number, multiplier: number, rounding: Rounding): number {
  const exact = pages * perPage * multiplier;
  return rounding === "floor" ? Math.floor(exact) : rounding === "round" ? Math.round(exact) : Math.ceil(exact - 1e-9);
}

export const formatUzs = (value: number) => `${Math.round(value).toLocaleString("uz-UZ")} so‘m`;
