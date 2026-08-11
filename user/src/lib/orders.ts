import type { Tables } from "@jaxongirman/types";

import { supabase } from "./supabase";
import { clientPlatform } from "@/providers/PaymentPolicyProvider";

/**
 * The order surface: opening a purchase and paying it.
 *
 * Every function here sends an identifier and never an amount. There is
 * deliberately no parameter for a price, a fee or a total anywhere in this file
 * — the server reads the figure from the row that owns it, and `orders` grants
 * no INSERT or UPDATE to a signed-in client, so a tampered request has nowhere
 * to land.
 */

export type Order = Tables<"orders">;

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

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return data as T;
}

export const createJcoinOrder = (packageId: string) =>
  rpc<OrderSummary>("order_create_jcoin", { p_package_id: packageId, p_platform: clientPlatform });

export const createModuleOrder = (moduleCode = "data_collection") =>
  rpc<OrderSummary>("order_create_module", { p_module_code: moduleCode, p_platform: clientPlatform });

export const createSubscriptionOrder = (planCode: string) =>
  rpc<OrderSummary>("order_create_subscription", { p_plan_code: planCode, p_platform: clientPlatform });

export const createMarketplaceOrder = (productId: string) =>
  rpc<OrderSummary>("order_create_marketplace", { p_product_id: productId, p_platform: clientPlatform });

/** A person's own receipts. Never any card data — the RPC returns none. */
export const myOrders = () =>
  rpc<{
    order_number: string; purpose: string; status: string;
    total_amount: number; currency: string; title: string;
    created_at: string; paid_at: string | null;
  }[]>("my_orders", { p_limit: 50 });

// ---------------------------------------------------------------- payment --
export type PayStart = {
  status: "awaiting_verification";
  orderNumber: string;
  sandbox: boolean;
  /** Masked by the provider, for the confirmation line. Never built here. */
  maskedCard: string | null;
  expiryHint: string | null;
};

export type PayResult = {
  status: "paid";
  orderNumber: string;
  sandbox: boolean;
  maskedCard: string | null;
  alreadyPaid?: boolean;
  fulfilment?: Record<string, unknown>;
};

export class OrderPaymentError extends Error {
  constructor(message: string, readonly code: string, readonly recoverable: boolean) {
    super(message);
  }
}

/**
 * Calls `order-pay`, and turns its two failure shapes into one exception the
 * screens can branch on.
 *
 * `recoverable` means the buyer can fix the input and carry on — a mistyped
 * code, a malformed card. Anything else has closed the order.
 */
async function callPay(body: Record<string, unknown>): Promise<PayStart | PayResult> {
  const { data, error } = await supabase.functions.invoke("order-pay", {
    body,
    // The store-compliance switch is enforced server-side on this header too, so
    // an iOS build cannot pay an order opened elsewhere.
    headers: { "X-Client-Platform": clientPlatform },
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
  return data as PayStart | PayResult;
}

/**
 * Hands the card to the provider and asks for a verification code.
 *
 * `pan` exists in this call and nowhere else: it is not stored, not logged, and
 * not returned. What comes back is what the provider already masked.
 */
export const payStart = (orderId: string, pan: string, expiry: string) =>
  callPay({ orderId, step: "start", pan, expiry }) as Promise<PayStart>;

export const payVerify = (orderId: string, code: string) =>
  callPay({ orderId, step: "verify", code }) as Promise<PayResult>;

/**
 * What happened to an order, asked of the server rather than remembered.
 *
 * The recovery path: an app closed mid-payment reopens and asks. If the order is
 * already paid, nothing is charged again — the answer is simply the truth.
 */
export const orderStatus = async (orderId: string): Promise<Order | null> => {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return data as Order | null;
};
