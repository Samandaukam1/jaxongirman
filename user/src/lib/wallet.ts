import { i18n } from "../i18n";

import { localized } from "./content";
import { supabase } from "./supabase";

/**
 * Someone's means, as the server counts them.
 *
 * Three balances, never added together because they are spent under
 * different rules: J Tanga (any service; part of it may be this month's tariff,
 * which burns unrenewed), welcome pages (decks only, given once) and bought
 * presentation pages (decks only). Every figure here is read from
 * `my_wallet`; the app keeps none of its own.
 */
export type Wallet = {
  balance: number;
  reserved: number;
  /** How much of `balance` is this month's tariff, and when it burns. */
  planCoins: number;
  planCoinsExpireAt: string | null;
  welcome: { granted: number; remaining: number; reserved: number; decks: number };
  presentationPages: { remaining: number; reserved: number };
  plan: { code: string; name: string; billing: "quota" | "coins"; expiresAt: string } | null;
  /** The person's price now: J Tanga per page, and for a 10-page deck. */
  rate: { perPage: number; deck10: number };
};

type RawWallet = {
  balance?: number;
  reserved?: number;
  plan_coins?: number;
  plan_coins_expire_at?: string | null;
  welcome?: { granted?: number; remaining?: number; reserved?: number; decks?: number };
  presentation_pages?: { remaining?: number; reserved?: number };
  plan?: { code?: string; name?: string; name_i18n?: unknown; billing?: string; expires_at?: string } | null;
  rate?: { per_page?: number; deck_10?: number };
};

/** Null when the server predates page pricing, so callers fall back to the old screens. */
export async function fetchWallet(): Promise<Wallet | null> {
  const { data, error } = await supabase.rpc("my_wallet");
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return null;
    throw error;
  }
  const raw = (data ?? {}) as RawWallet;
  return {
    balance: raw.balance ?? 0,
    reserved: raw.reserved ?? 0,
    planCoins: raw.plan_coins ?? 0,
    planCoinsExpireAt: raw.plan_coins_expire_at ?? null,
    welcome: {
      granted: raw.welcome?.granted ?? 0,
      remaining: raw.welcome?.remaining ?? 0,
      reserved: raw.welcome?.reserved ?? 0,
      decks: raw.welcome?.decks ?? 0,
    },
    presentationPages: {
      remaining: raw.presentation_pages?.remaining ?? 0,
      reserved: raw.presentation_pages?.reserved ?? 0,
    },
    plan: raw.plan?.code
      ? {
        code: raw.plan.code,
        name: localized(raw.plan.name ?? raw.plan.code, raw.plan.name_i18n),
        billing: raw.plan.billing === "coins" ? "coins" : "quota",
        expiresAt: raw.plan.expires_at ?? "",
      }
      : null,
    rate: { perPage: Number(raw.rate?.per_page ?? 0), deck10: raw.rate?.deck_10 ?? 0 },
  };
}

/** What a deck of some pages costs this person, and from which balance. */
export type Quote = {
  mode: "credits" | "quota";
  pages: number;
  welcomePages: number;
  purchasedPages: number;
  paidPages: number;
  coins: number;
  balance: number;
  welcomeRemaining: number;
  purchasedRemaining: number;
  sufficient: boolean;
  requiresConfirmation: boolean;
};

type RawQuote = {
  mode?: string;
  pages?: number;
  welcome_pages?: number;
  purchased_pages?: number;
  paid_pages?: number;
  coins?: number;
  balance?: number;
  welcome_remaining?: number;
  purchased_remaining?: number;
  sufficient?: boolean;
  requires_confirmation?: boolean;
};

/** Null when the server predates page pricing. Throws the server's own message for a page count it refuses. */
export async function fetchQuote(pages: number): Promise<Quote | null> {
  const { data, error } = await supabase.rpc("presentation_quote", { p_slide_count: pages });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return null;
    throw error;
  }
  const raw = (data ?? {}) as RawQuote;
  return {
    mode: raw.mode === "quota" ? "quota" : "credits",
    pages: raw.pages ?? pages,
    welcomePages: raw.welcome_pages ?? 0,
    purchasedPages: raw.purchased_pages ?? 0,
    paidPages: raw.paid_pages ?? 0,
    coins: raw.coins ?? 0,
    balance: raw.balance ?? 0,
    welcomeRemaining: raw.welcome_remaining ?? 0,
    purchasedRemaining: raw.purchased_remaining ?? 0,
    sufficient: raw.sufficient ?? true,
    requiresConfirmation: Boolean(raw.requires_confirmation),
  };
}

/** The pages a quote takes from the free and bought balances, said in one line. */
export function quoteSummary(quote: Quote): string {
  const parts: string[] = [];
  if (quote.welcomePages) parts.push(i18n.t("create:quote.welcome", { count: quote.welcomePages }));
  if (quote.purchasedPages) parts.push(i18n.t("create:quote.purchased", { count: quote.purchasedPages }));
  if (quote.paidPages) parts.push(i18n.t("create:quote.paid", { count: quote.paidPages, coins: quote.coins }));
  return parts.join(" · ");
}
