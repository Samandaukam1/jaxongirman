/**
 * Pays an order — any order.
 *
 * One function for all four things Jaxongirman sells, because the order engine
 * made them the same shape: a subscription, a coin package, eleven months of
 * module access and a marketplace material differ in what fulfilment grants, not
 * in how money moves. `pay-marketplace` remains for the transaction-shaped flow
 * it already serves; this is the path everything new takes.
 *
 * Two calls make up an attempt. `start` hands the provider a card and asks for a
 * verification code; `verify` exchanges the code and charges the receipt. Between
 * them the server keeps only the provider's one-time token, in a column no
 * client role can read.
 *
 * What never reaches this server's storage or its logs: the card number, the
 * digits a buyer re-typed, and the verification code. The PAN exists in one
 * request body, goes straight to the provider, and is gone. Every provider
 * message is redacted for long digit runs before it is written anywhere.
 *
 * An order becomes fulfilled only through `order_fulfil`, which is service-role
 * only and runs after the provider — never the client — has said the receipt is
 * paid. A client that reports success has reported nothing.
 */
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { PaymentFailed, selectProvider, somToTiyin } from "../_shared/payment-provider.ts";

type Body = {
  orderId?: string;
  step?: "start" | "verify";
  /** Full number, this request only. Never stored, never logged. */
  pan?: string;
  /** "MM/YY" as typed. */
  expiry?: string;
  code?: string;
};

/**
 * Errors the buyer can simply correct.
 *
 * A mistyped verification code is not a failed payment — it is an unaccepted
 * code — so it leaves the order exactly where it was and the buyer types again.
 * Only the provider genuinely refusing the money is terminal.
 */
const RECOVERABLE = new Set([
  "invalid_code", "not_verified", "invalid_pan", "invalid_expiry", "invalid_request",
  // Provider verdicts the buyer can act on: a different card, a correct code.
  // `provider_auth` is deliberately absent — that is our misconfiguration, and
  // inviting somebody to re-type a card would waste their time.
  "card_invalid", "card_expired", "card_blocked", "card_not_found", "code_expired",
]);

/** Strips anything that looks like a card number before a string is written. */
function redact(value: string): string {
  return value.replace(/[0-9]{12,}/g, "[redacted]");
}

function parseExpiry(expiry: string): { providerFormat: string; hint: string } {
  const digits = expiry.replace(/[^0-9]/g, "");
  if (digits.length !== 4) {
    throw new HttpError(400, "Amal qilish muddatini MM/YY ko‘rinishida kiriting.", "invalid_expiry");
  }
  const month = Number(digits.slice(0, 2));
  if (month < 1 || month > 12) throw new HttpError(400, "Oy noto‘g‘ri.", "invalid_expiry");
  // Payme's card `expire` is YYMM in the request and MM/YY in the response.
  return {
    providerFormat: `${digits.slice(2, 4)}${digits.slice(0, 2)}`,
    hint: `${digits.slice(0, 2)}/${digits.slice(2, 4)}`,
  };
}

/** The platform a client claims to be, for the iOS payment policy. */
function clientPlatform(request: Request): string {
  return (request.headers.get("X-Client-Platform") ?? "").trim().toLowerCase();
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;

  let orderId = "";
  let serviceClient: Awaited<ReturnType<typeof requestContext>>["serviceClient"] | null = null;

  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed", "method_not_allowed");
    const context = await requestContext(request);
    serviceClient = context.serviceClient;
    const { user } = context;
    const body = await bodyJson<Body>(request);

    orderId = body.orderId?.trim() ?? "";
    if (!orderId) throw new HttpError(400, "orderId is required", "invalid_request");

    // The store-compliance switch, checked here as well as at order creation:
    // an order opened on Android must not be payable from an iOS build.
    const { data: blocked, error: policyError } = await serviceClient.rpc("payments_blocked_for_platform", {
      p_platform: clientPlatform(request),
    });
    if (policyError) throw policyError;
    if (blocked === true) {
      throw new HttpError(403, "Bu amal iOS ilovasida mavjud emas.", "ios_payments_disabled");
    }

    const { data: order, error: loadError } = await serviceClient
      .from("orders")
      .select("id, order_number, user_id, status, total_amount, purpose, expires_at")
      .eq("id", orderId)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!order) throw new HttpError(404, "Buyurtma topilmadi", "not_found");
    if (order.user_id !== user.id) throw new HttpError(403, "Bu buyurtma sizga tegishli emas", "forbidden");

    // Idempotent by design: the client asking again about a finished purchase is
    // a normal event — an app reopened after a dropped connection — not an error.
    if (order.status === "paid") {
      return json({ status: "paid", orderNumber: order.order_number, alreadyPaid: true });
    }
    if (["failed", "cancelled", "expired", "refunded"].includes(order.status)) {
      throw new HttpError(409, "Bu buyurtma yopilgan. Qaytadan boshlang.", "order_closed");
    }
    if (new Date(order.expires_at).getTime() <= Date.now()) {
      throw new HttpError(409, "Buyurtma muddati tugadi. Qaytadan boshlang.", "order_expired");
    }

    const { data: settings } = await serviceClient
      .from("app_settings").select("value").eq("key", "payments.config").maybeSingle();
    const configured = Boolean((settings?.value as { configured?: boolean } | null)?.configured);
    const { provider, sandbox } = selectProvider(configured);

    /* ------------------------------------------------------------- start */
    if (body.step !== "verify") {
      const pan = (body.pan ?? "").replace(/[^0-9]/g, "");
      if (pan.length < 16 || pan.length > 19) {
        throw new HttpError(400, "Karta raqamini to‘liq kiriting.", "invalid_pan");
      }
      const expiry = parseExpiry(body.expiry ?? "");

      // A fresh card replaces anything left from an abandoned attempt.
      await serviceClient.rpc("order_clear_attempt_token", { p_order_id: orderId });

      const card = await provider.createCard(pan, expiry.providerFormat);
      const { error: tokenError } = await serviceClient.rpc("order_set_attempt_token", {
        p_order_id: orderId, p_token: card.token,
      });
      if (tokenError) throw tokenError;

      await provider.requestCode(card.token);
      await serviceClient.rpc("order_advance", {
        p_order_id: orderId, p_to: "awaiting_verification",
      });

      return json({
        status: "awaiting_verification",
        orderNumber: order.order_number,
        sandbox,
        // What Payme itself already redacted, so the confirmation screen can
        // show which card is being charged. Never derived from the PAN here.
        maskedCard: card.maskedNumber,
        expiryHint: card.expiryHint ?? expiry.hint,
      });
    }

    /* ------------------------------------------------------------ verify */
    const code = (body.code ?? "").replace(/[^0-9]/g, "");
    if (code.length < 4) throw new HttpError(400, "Tasdiqlash kodini kiriting.", "invalid_code");

    // Single-use: taking the token wipes it, so a replayed verify finds nothing.
    const { data: token, error: takeError } = await serviceClient.rpc("order_take_attempt_token", {
      p_order_id: orderId,
    });
    if (takeError) throw takeError;

    const verified = await provider.verifyCode(token as string, code);
    if (!verified.verified) throw new PaymentFailed("not_verified", "Karta tasdiqlanmadi.");

    const receiptId = await provider.createReceipt(somToTiyin(order.total_amount), order.order_number);
    await serviceClient.rpc("order_advance", { p_order_id: orderId, p_to: "processing" });

    const charged = await provider.payReceipt(receiptId, verified.token);
    if (!charged.paid) throw new PaymentFailed("not_paid", "To‘lov amalga oshmadi.");

    // The provider said yes. Only now does anything become owned.
    const { data: fulfilled, error: fulfilError } = await serviceClient.rpc("order_fulfil", {
      p_order_id: orderId,
      p_payme_receipt_id: receiptId,
      p_provider_cost: Math.round(charged.providerCost / 100),
    });
    if (fulfilError) throw fulfilError;

    await serviceClient.rpc("order_clear_attempt_token", { p_order_id: orderId });

    return json({
      status: "paid",
      orderNumber: order.order_number,
      sandbox,
      maskedCard: charged.maskedNumber ?? verified.maskedNumber,
      fulfilment: fulfilled,
    });
  } catch (error) {
    const failureCode = error instanceof PaymentFailed
      ? error.code
      : error instanceof HttpError ? error.code : "internal_error";

    // The provider's own number, kept on the record. Our normalised code says
    // what kind of failure it was; only Payme's says which one, and that is the
    // thing to quote when asking them about it.
    const providerNote = error instanceof PaymentFailed && error.providerCode
      ? ` [payme ${error.providerCode}]`
      : "";

    // Correctable mistakes leave the order standing so the buyer can fix the
    // input rather than start the purchase over. The token is already spent, so
    // `start` is where they resume — which is what the client is told.
    if (RECOVERABLE.has(failureCode)) {
      const message = error instanceof Error ? redact(error.message) : "Ma’lumot noto‘g‘ri.";
      return json({ error: message, code: failureCode, recoverable: true }, 400);
    }

    // Anything else is terminal for this attempt — but whether it is terminal for
    // the *order* depends on how far it got.
    //
    // An order in `processing` has already been handed to the provider to
    // charge. Marking it failed would be a claim we cannot support: the money may
    // well have moved, and the row would then say "failed" about a payment the
    // customer's statement shows. Such an order is left exactly where it is, for
    // `admin_order_reconciliation()` to surface and a person to resolve against
    // Payme. Losing the trail is worse than leaving a question open.
    //
    // Best effort throughout: the buyer's error is the one worth returning, so a
    // failure while recording it must not be allowed to replace it.
    if (serviceClient && orderId) {
      try {
        const { data: current } = await serviceClient
          .from("orders").select("status").eq("id", orderId).maybeSingle();
        const charging = current?.status === "processing";

        if (!charging) {
          await serviceClient.rpc("order_fail", {
            p_order_id: orderId,
            p_code: failureCode,
            p_message: redact(error instanceof Error ? error.message : "To‘lov amalga oshmadi.") + providerNote,
          });
        }
        // The token goes either way: it is single-use and this attempt is over.
        await serviceClient.rpc("order_clear_attempt_token", { p_order_id: orderId });
      } catch {
        // Nothing useful to do here; the response below still tells the buyer.
      }
    }

    if (error instanceof PaymentFailed) {
      return json({ error: error.message, code: error.code }, 402);
    }
    return errorResponse(error);
  }
});
