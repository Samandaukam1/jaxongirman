import { supabase } from "./supabase";

/**
 * Tillar va tarjimalar, as the console edits it.
 *
 * The app's interface words ship inside the app, in three static tables, and
 * are not edited here. What is edited here is the operator's own content — plan
 * names, coin packages, material types, the iOS payment notice, the refund
 * policy — in English and Russian beside its Uzbek source, and which languages
 * are offered for the interface and for deck generation. Every change goes
 * through an RPC that writes the audit log.
 */

export type Language = "uz" | "en" | "ru";
export const LANGUAGES: readonly Language[] = ["uz", "en", "ru"];
export const LANGUAGE_NAMES: Record<Language, string> = { uz: "O‘zbekcha", en: "English", ru: "Русский" };

export type LanguageSettings = { ui: Language[]; deck: Language[] };

export type TranslationEntry = {
  entity: "subscription_plan" | "coin_package" | "material_type" | "setting";
  id: string;
  group: string;
  field: string;
  source: string;
  values: { en?: string; ru?: string };
  active: boolean;
};

export type HistoryRow = {
  id: string;
  action: "translation.updated" | "languages.updated";
  target_type: string;
  target_id: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
  admin_name: string;
};

export type LanguageOverview = {
  settings: LanguageSettings;
  users: Partial<Record<Language, number>>;
  decks: Partial<Record<Language, { total: number; last_30_days: number }>>;
  usage: Partial<Record<Language, { input_tokens: number; output_tokens: number; cost_usd: number; decks: number }>>;
  coverage: { total: number; en: number; ru: number };
  history: HistoryRow[];
};

async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const loadLanguageOverview = () => call<LanguageOverview>("admin_language_overview");
export const loadTranslationEntries = () => call<TranslationEntry[]>("admin_translation_entries");

export const saveLanguageSettings = (settings: LanguageSettings, reason: string) =>
  call<LanguageSettings>("admin_set_language_settings", { p_value: settings, p_reason: reason });

export const saveTranslation = (entry: Pick<TranslationEntry, "entity" | "id" | "field">, values: { en: string; ru: string }, reason = "") =>
  call<{ values: { en?: string; ru?: string } }>("admin_set_translation", {
    p_entity: entry.entity, p_id: entry.id, p_field: entry.field, p_values: values, p_reason: reason,
  });

/** What a translatable piece is, in words an operator recognises. */
export const ENTITY_LABELS: Record<TranslationEntry["entity"], string> = {
  subscription_plan: "Tarif",
  coin_package: "Tanga paketi",
  material_type: "Material turi",
  setting: "Sozlama",
};

export const FIELD_LABELS: Record<string, string> = {
  name: "Nomi",
  subtitle: "Qisqa tavsif",
  description: "Tavsif",
  badge: "Belgi",
  cta_label: "Tugma matni",
  label: "Nomi",
  title: "Sarlavha",
  body: "Matn",
  checkbox_label: "Rozilik matni",
  "copy.subscription": "Tarif xabari",
  "copy.jcoin": "J Tanga xabari",
  "copy.marketplace": "Do‘kon xabari",
  "copy.module": "Modul xabari",
};
