/**
 * Runs a marketplace payment.
 *
 * Two calls make up an attempt: `start` hands the provider a card and asks for
 * a verification code, `verify` exchanges the code and charges the receipt.
 * Between them the server keeps only the provider's one-time token, in a column
 * no client role can read.
 *
 * What never reaches this server's storage or its logs: the card number, the
 * four digits the buyer re-typed, and the verification code. The PAN exists in
 * one request body, is passed straight to the provider, and is gone. Every log
 * line and every provider error is redacted for long digit runs before it is
 * written anywhere.
 *
 * A payment becomes a purchase only through `marketplace_settle_payment`, which
 * is service-role only and runs after the provider — not the client — has said
 * the receipt is paid.
 */
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { PaymentFailed, selectProvider, somToTiyin } from "../_shared/payment-provider.ts";

type Body = {
  transactionId?: string;
  step?: "start" | "verify";
  /** Full number, this request only. Never stored, never logged. */
  pan?: string;
  /** "MM/YY" as typed. */
  expiry?: string;
  code?: string;
  /** Echoed back from `start` so the masked card can be remembered on success. */
  first8?: string;
  last4?: string;
};

/**
 * Errors the buyer can simply correct.
 *
 * A mistyped verification code is not a failed payment — it is an unaccepted
 * code — so it leaves the attempt exactly where it was and the buyer types
 * again. Only the provider genuinely refusing the money is terminal.
 */
const RECOVERABLE = new Set([
  "invalid_code", "not_verified", "invalid_pan", "invalid_expiry", "invalid_request",
  // Provider verdicts the buyer can act on: a different card, a correct code.
  // `provider_auth` is deliberately absent — that is our misconfiguration.
  "card_invalid", "card_expired", "card_blocked", "card_not_found", "code_expired",
]);

/** Strips anything that looks like a card number before a string is written. */
function redact(value: string): string {
  return value.replace(/[0-9]{12,}/g, "[redacted]");
}

function parseExpiry(expiry: string): { month: number; year: number; providerFormat: string } {
  const digits = expiry.replace(/[^0-9]/g, "");
  if (digits.length !== 4) throw new HttpError(400, "Amal qilish muddatini MM/YY ko‘rinishida kiriting.", "invalid_expiry");
  const month = Number(digits.slice(0, 2));
  const year = Number(digits.slice(2, 4));
  if (month < 1 || month > 12) throw new HttpError(400, "Oy noto‘g‘ri.", "invalid_expiry");
  // Payme expects YYMM.
  return { month, year, providerFormat: `${digits.slice(2, 4)}${digits.slice(0, 2)}` };
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;

  let transactionId = "";
  let serviceClient: Awaited<ReturnType<typeof requestContext>>["serviceClient"] | null = null;

  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed", "method_not_allowed");
    const context = await requestContext(request);
    serviceClient = context.serviceClient;
    const { user } = context;
    const body = await bodyJson<Body>(request);

    transactionId = body.transactionId?.trim() ?? "";
    if (!transactionId) throw new HttpError(400, "transactionId is required", "invalid_request");

    const { data: transaction, error: loadError } = await serviceClient
      .from("payment_transactions")
      .select("id, buyer_id, state, buyer_total, is_sandbox, provider")
      .eq("id", transactionId)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!transaction) throw new HttpError(404, "To‘lov topilmadi", "not_found");
    if (transaction.buyer_id !== user.id) throw new HttpError(403, "Bu to‘lov sizga tegishli emas", "forbidden");
    if (transaction.state === "paid") return json({ state: "paid", alreadyPaid: true });

    // Every "start" begins a fresh card, so anything left over from a previous
    // attempt is reset first. The buyer is never re-quoted: the price snapshot
    // on this transaction is what they already agreed to.
    if (body.step !== "verify" && transaction.state !== "created") {
      const { error: restartError } = await serviceClient.rpc("payment_advance", {
        p_transaction_id: transactionId, p_to: "created", p_event: "attempt.restart",
      });
      if (restartError) throw restartError;
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

      if (sandbox) {
        const { error: sandboxError } = await serviceClient.rpc("payment_begin_sandbox", { p_transaction_id: transactionId });
        if (sandboxError) throw sandboxError;
      }

      const card = await provider.createCard(pan, expiry.providerFormat);
      const { error: tokenError } = await serviceClient.rpc("payment_set_attempt_token", {
        p_transaction_id: transactionId,
        p_token: card.token,
      });
      if (tokenError) throw tokenError;

      await serviceClient.rpc("payment_advance", {
        p_transaction_id: transactionId, p_to: "card_created", p_event: "provider.card_created",
      });

      await provider.requestCode(card.token);
      await serviceClient.rpc("payment_advance", {
        p_transaction_id: transactionId, p_to: "otp_requested", p_event: "provider.code_requested",
      });

      // The two ends of the number go back to the client, which already has
      // them, so the masked card can be recorded once the payment succeeds.
      // The server keeps neither until then.
      return json({
        state: "otp_requested",
        sandbox,
        first8: pan.slice(0, 8),
        last4: pan.slice(-4),
        expiryMonth: expiry.month,
        expiryYear: expiry.year,
      });
    }

    /* ------------------------------------------------------------ verify */
    const code = (body.code ?? "").replace(/[^0-9]/g, "");
    if (code.length < 4) throw new HttpError(400, "Tasdiqlash kodini kiriting.", "invalid_code");

    const { data: token, error: takeError } = await serviceClient.rpc("payment_take_attempt_token", {
      p_transaction_id: transactionId,
    });
    if (takeError) throw takeError;

    const verified = await provider.verifyCode(token as string, code);
    if (!verified.verified) throw new PaymentFailed("not_verified", "Karta tasdiqlanmadi.");
    await serviceClient.rpc("payment_advance", {
      p_transaction_id: transactionId, p_to: "card_verified", p_event: "provider.card_verified",
    });

    const receiptId = await provider.createReceipt(somToTiyin(transaction.buyer_total), transactionId);
    await serviceClient.rpc("payment_advance", {
      p_transaction_id: transactionId, p_to: "receipt_created",
      p_event: "provider.receipt_created", p_provider_receipt_id: receiptId,
    });
    await serviceClient.rpc("payment_advance", {
      p_transaction_id: transactionId, p_to: "processing", p_event: "provider.charging",
    });

    const charged = await provider.payReceipt(receiptId, verified.token);
    if (!charged.paid) throw new PaymentFailed("not_paid", "To‘lov amalga oshmadi.");

    // The provider said yes. Only now does anything become a purchase.
    const { data: settled, error: settleError } = await serviceClient.rpc("marketplace_settle_payment", {
      p_transaction_id: transactionId,
      p_provider_cost: charged.providerCost,
    });
    if (settleError) throw settleError;

    await serviceClient.rpc("payment_clear_attempt_token", { p_transaction_id: transactionId });

    // Remembering the card is the last thing that happens, and only on success,
    // exactly as the "chala kartalar" rule requires.
    const first8 = (body.first8 ?? "").replace(/[^0-9]/g, "");
    const last4 = (body.last4 ?? "").replace(/[^0-9]/g, "");
    if (first8.length === 8 && last4.length === 4) {
      await serviceClient.rpc("marketplace_remember_partial_card", {
        p_user_id: user.id,
        p_first8: first8,
        p_last4: last4,
        p_expiry_month: Number(body.expiry?.replace(/[^0-9]/g, "").slice(0, 2) ?? 1),
        p_expiry_year: Number(body.expiry?.replace(/[^0-9]/g, "").slice(2, 4) ?? 30),
      });
    }

    return json({ state: "paid", sandbox, purchase: settled });
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

    // Correctable mistakes leave the attempt standing, token and all, so the
    // buyer can fix the input rather than start the purchase over.
    if (RECOVERABLE.has(failureCode)) {
      const message = error instanceof Error ? redact(error.message) : "Ma’lumot noto‘g‘ri.";
      return json({ error: message, code: failureCode, recoverable: true }, 400);
    }

    // Anything else is terminal for this attempt: mark it and drop the token.
    // Best effort — the buyer's error is the one worth returning, so a failure
    // while recording it must not be allowed to replace it.
    if (serviceClient && transactionId) {
      const code = failureCode;
      const message = redact(error instanceof Error ? error.message : "To‘lov amalga oshmadi.") + providerNote;
      try {
        await serviceClient.rpc("payment_advance", {
          p_transaction_id: transactionId, p_to: "failed", p_event: "provider.failed",
          p_provider_error_code: code, p_provider_error_message: message,
        });
        await serviceClient.rpc("payment_clear_attempt_token", { p_transaction_id: transactionId });
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
