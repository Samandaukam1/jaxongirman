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

/**
 * An order as a client may see it.
 *
 * `orders` is granted column by column: the provider's one-time card token and
 * the attempt window belong to the server alone. Naming that here rather than
 * using the full row means the type says what a client can actually read, and a
 * screen that reaches for a withheld column stops compiling instead of failing
 * at run time with `permission denied`.
 */
export type Order = Omit<Tables<"orders">, "provider_card_token" | "attempt_expires_at">;

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

/**
 * Opens a marketplace order.
 *
 * `p_refund_acknowledged` is the buyer's agreement that a digital file cannot
 * be handed back. The server refuses without it, so this is not a client-side
 * courtesy — passing `true` here without having shown the wording would be
 * agreeing on somebody's behalf.
 */
export const createMarketplaceOrder = (productId: string, refundAcknowledged: boolean) =>
  rpc<OrderSummary>("order_create_marketplace", {
    p_product_id: productId,
    p_platform: clientPlatform,
    p_refund_acknowledged: refundAcknowledged,
  });

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
  /** Opaque identity binding the next OTP call to this exact card attempt. */
  attemptId: string;
  /** True when this is the attempt already texted, handed back rather than remade. */
  resumed?: boolean;
  /** Trusted display-only mask returned by the server; never built in the client. */
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
  constructor(
    message: string,
    readonly code: string,
    readonly recoverable: boolean,
    /** The single-use provider token is gone, so another SMS needs a fresh start. */
    readonly restartRequired = false,
  ) {
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

export const payVerify = (orderId: string, attemptId: string, code: string) =>
  callPay({ orderId, step: "verify", attemptId, code }) as Promise<PayResult>;

/**
 * What happened to an order, asked of the server rather than remembered.
 *
 * The recovery path: an app closed mid-payment reopens and asks. If the order is
 * already paid, nothing is charged again — the answer is simply the truth.
 */
/**
 * Every column of an order a client may read.
 *
 * `orders` is granted column by column, not table-wide: the provider's one-time
 * card token is not merely filtered out, it is not askable for. `select("*")`
 * asks for it anyway, and Postgres refuses the whole statement rather than
 * trimming it — which is why the checkout screen answered "Buyurtma yuklanmadi"
 * for every order ever opened.
 */
const ORDER_COLUMNS = "id, order_number, user_id, purpose, status, product_id, coin_package_id, reference_code, seller_id, currency, subtotal, buyer_fee, total_amount, seller_fee, seller_net, platform_revenue, buyer_fee_rate, seller_fee_rate, payme_receipt_id, payme_transaction_id, is_test, failure_code, failure_message, metadata, created_at, updated_at, paid_at, cancelled_at, expires_at";

export const orderStatus = async (orderId: string): Promise<Order | null> => {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return data as Order | null;
};
