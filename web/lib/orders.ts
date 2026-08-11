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
};

/** The published tariff catalogue. Empty means nothing is for sale, and says so. */
export async function subscriptionPlans(): Promise<{ currency: string; plans: Plan[] }> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "subscription.plans")
    .maybeSingle();
  if (error) throw error;
  const value = data?.value as { currency?: string; plans?: Plan[] } | null;
  return {
    currency: value?.currency ?? "UZS",
    plans: (value?.plans ?? []).filter((plan) => plan.is_active !== false),
  };
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
  constructor(message: string, readonly code: string, readonly recoverable: boolean) {
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
        { error?: string; code?: string; recoverable?: boolean } | null;
      if (payload?.error) {
        throw new OrderPaymentError(payload.error, payload.code ?? "payment_failed", payload.recoverable === true);
      }
    }
    throw new OrderPaymentError("To‘lov amalga oshmadi.", "payment_failed", false);
  }
  return data as PayStart | PayDone;
}

/**
 * Hands the card to the provider and asks for a verification code.
 *
 * `pan` exists in this call and nowhere else. It is not stored in the browser,
 * not put in a URL, and not returned; what comes back is what Payme masked.
 */
export const payStart = (orderId: string, pan: string, expiry: string) =>
  callPay({ orderId, step: "start", pan, expiry }) as Promise<PayStart>;

export const payVerify = (orderId: string, code: string) =>
  callPay({ orderId, step: "verify", code }) as Promise<PayDone>;
