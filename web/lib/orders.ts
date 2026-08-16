import type { PlanFeatures } from "@jaxongirman/tariff-card";
import type { Tables } from "@jaxongirman/types";

import { supabase } from "./supabase";

/**
 * The web's half of the order engine — the same engine, called the same way.
 *
 * There is deliberately no web-specific payment logic: the RPCs and the
 * `order-pay` function that serve the apps serve this too, so a price, a
 * commission and a fulfilment cannot drift between platforms. The only thing
 * this file adds is the platform header, which reports `web` and is therefore
 * never subject to the iOS policy.
 */

export const CLIENT_PLATFORM = "web";

export type OrderSummary = {
  order_id: string;
  order_number: string;
  purpose: string;
  status: string;
  currency: string;
  subtotal: number;
  buyer_fee: number;
  buyer_fee_rate: number;
  total_amount: number;
  is_test: boolean;
  expires_at: string;
  reused: boolean;
};

export type Plan = {
  code: string;
  label: string;
  price_amount: number;
  duration_months: number;
  is_active?: boolean;
  /** Everything the card needs to describe itself, from the plan's own row. */
  name: string;
  subtitle: string;
  badge: string;
  cta_label: string;
  compare_at_amount: number;
  currency: string;
  period_days: number;
  features: PlanFeatures;
};

/** The only card representation a client may read or keep. */
export type PartialCard = Tables<"partial_cards">;

/**
 * The published tariff catalogue. Empty means nothing is for sale, and says so.
 *
 * Read from `subscription_plans`, which is where an admin shapes them. This used
 * to read an `app_settings` key that was never filled, so the page offered
 * nothing to anybody who visited it.
 */
export async function subscriptionPlans(): Promise<{ currency: string; plans: Plan[] }> {
  const { data, error } = await supabase
    .from("subscription_plans")
    .select("code, name, subtitle, badge, cta_label, price_amount, compare_at_amount, currency, period_days, features, is_active")
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;

  const rows = data ?? [];
  return {
    currency: rows[0]?.currency ?? "UZS",
    plans: rows.map((row) => ({
      code: row.code,
      // `label` is what the existing checkout renders; the plan's name is it.
      label: row.name,
      name: row.name,
      subtitle: row.subtitle,
      badge: row.badge,
      cta_label: row.cta_label,
      price_amount: row.price_amount,
      compare_at_amount: row.compare_at_amount,
      currency: row.currency,
      period_days: row.period_days,
      duration_months: Math.max(1, Math.round(row.period_days / 30)),
      features: (row.features ?? {}) as PlanFeatures,
      is_active: row.is_active,
    })),
  };
}

/**
 * A person's own successful-payment card hints.
 *
 * Ownership is enforced by `partial_cards` RLS. This deliberately asks only for
 * active rows and exposes no write path: a hint is created by the payment server
 * after a charge succeeds, and the settings screen may only delete it.
 */
export async function listPartialCards(): Promise<PartialCard[]> {
  const { data, error } = await supabase
    .from("partial_cards")
    .select("*")
    .eq("is_active", true)
    .order("last_used_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

export async function createSubscriptionOrder(planCode: string): Promise<OrderSummary> {
  const { data, error } = await supabase.rpc("order_create_subscription", {
    p_plan_code: planCode,
    p_platform: CLIENT_PLATFORM,
  });
  if (error) throw error;
  return data as unknown as OrderSummary;
}

export type PayStart = {
  status: "awaiting_verification";
  orderNumber: string;
  sandbox: boolean;
  /** Opaque identity binding this OTP to the exact server-side masked attempt. */
  attemptId: string;
  maskedCard: string | null;
  expiryHint: string | null;
};

export type PayDone = {
  status: "paid";
  orderNumber: string;
  sandbox: boolean;
  maskedCard: string | null;
  alreadyPaid?: boolean;
};

export class OrderPaymentError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly recoverable: boolean,
    /** A verification token was consumed or expired, so card start must run again. */
    readonly restartRequired = false,
  ) {
    super(message);
  }
}

async function callPay(body: Record<string, unknown>): Promise<PayStart | PayDone> {
  const { data, error } = await supabase.functions.invoke("order-pay", {
    body,
    headers: { "X-Client-Platform": CLIENT_PLATFORM },
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context) {
      const payload = await context.json().catch(() => null) as
        { error?: string; code?: string; recoverable?: boolean; restartRequired?: boolean } | null;
      if (payload?.error) {
        throw new OrderPaymentError(
          payload.error,
          payload.code ?? "payment_failed",
          payload.recoverable === true,
          payload.restartRequired === true,
        );
      }
    }
    throw new OrderPaymentError("To‘lov amalga oshmadi.", "payment_failed", false);
  }
  return data as PayStart | PayDone;
}

/**
 * Hands the card to the provider and asks for a verification code.
 *
 * `pan` is request-only in this layer: it is never persisted, put in a URL or
 * returned; what comes back is a safe masked hint.
 */
export const payStart = (orderId: string, pan: string, expiry: string) =>
  callPay({ orderId, step: "start", pan, expiry }) as Promise<PayStart>;

export const payVerify = (orderId: string, attemptId: string, code: string) =>
  callPay({ orderId, step: "verify", attemptId, code }) as Promise<PayDone>;
