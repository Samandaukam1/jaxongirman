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
import { parsePaymentCard, providerMaskMatches } from "../_shared/payment-card.ts";
import { PaymentFailed, selectProvider, somToTiyin } from "../_shared/payment-provider.ts";

type Body = {
  transactionId?: string;
  step?: "start" | "verify";
  /** Full number, this request only. Never stored, never logged. */
  pan?: string;
  /** "MM/YY" as typed. */
  expiry?: string;
  code?: string;
  /** Opaque server attempt identity returned by start. */
  attemptId?: string;
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
  "code_not_sent", "attempt_not_found", "attempt_expired", "attempt_consumed", "attempt_in_progress",
]);

/** Strips anything that looks like a card number before a string is written. */
function redact(value: string): string {
  return value.replace(/[0-9]{12,}/g, "[redacted]");
}

type TakenAttempt = {
  ok: boolean;
  code?: string;
  attemptId?: string;
  token?: string;
  displayPan?: string;
};

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;

  let transactionId = "";
  let activeAttemptId = "";
  let attemptCreated = false;
  let attemptTaken = false;
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

    const { data: settings } = await serviceClient
      .from("app_settings").select("value").eq("key", "payments.config").maybeSingle();
    const configured = Boolean((settings?.value as { configured?: boolean } | null)?.configured);

    const { provider, sandbox } = selectProvider(configured);

    /* ------------------------------------------------------------- start */
    if (body.step !== "verify") {
      // Remove a token written by an older deployed version as well.
      await serviceClient.rpc("payment_clear_attempt_token", { p_transaction_id: transactionId });

      const paymentCard = parsePaymentCard(body.pan ?? "", body.expiry ?? "");

      const card = await provider.createCard(paymentCard.pan, paymentCard.providerExpiry);
      if (!providerMaskMatches(card.maskedNumber, paymentCard.displayPan)) {
        throw new PaymentFailed("provider_card_mismatch", "To‘lov tizimi karta ma’lumotini tasdiqlamadi.");
      }
      const { data: createdAttemptId, error: tokenError } = await serviceClient.rpc("payment_card_attempt_set", {
        p_subject_kind: "marketplace",
        p_subject_id: transactionId,
        p_token: card.token,
        p_display_pan: paymentCard.displayPan,
        p_expiry_month: paymentCard.expiryMonth,
        p_expiry_year: paymentCard.expiryYear,
      });
      if (tokenError) {
        if ((tokenError as { code?: string }).code === "55000") {
          throw new HttpError(409, "Avval yuborilgan tasdiqlash kodini kiriting.", "attempt_in_progress");
        }
        throw tokenError;
      }
      activeAttemptId = String(createdAttemptId ?? "");
      if (!activeAttemptId) throw new Error("Payment attempt id was not returned");
      attemptCreated = true;

      // Restart only after the database atomically accepted this new attempt.
      // An active prior attempt refuses above and keeps its state untouched.
      if (transaction.state !== "created") {
        const { error: restartError } = await serviceClient.rpc("payment_advance", {
          p_transaction_id: transactionId, p_to: "created", p_event: "attempt.restart",
        });
        if (restartError) throw restartError;
      }
      if (sandbox) {
        const { error: sandboxError } = await serviceClient.rpc("payment_begin_sandbox", { p_transaction_id: transactionId });
        if (sandboxError) throw sandboxError;
      }

      const { error: cardAdvanceError } = await serviceClient.rpc("payment_advance", {
        p_transaction_id: transactionId, p_to: "card_created", p_event: "provider.card_created",
      });
      if (cardAdvanceError) throw cardAdvanceError;

      await provider.requestCode(card.token);
      const { error: otpAdvanceError } = await serviceClient.rpc("payment_advance", {
        p_transaction_id: transactionId, p_to: "otp_requested", p_event: "provider.code_requested",
      });
      if (otpAdvanceError) throw otpAdvanceError;

      return json({
        state: "otp_requested",
        sandbox,
        maskedCard: paymentCard.displayPan,
        expiryHint: paymentCard.expiryHint,
        attemptId: activeAttemptId,
      });
    }

    /* ------------------------------------------------------------ verify */
    const code = (body.code ?? "").replace(/[^0-9]/g, "");
    if (code.length < 4) throw new HttpError(400, "Tasdiqlash kodini kiriting.", "invalid_code");
    activeAttemptId = body.attemptId?.trim() ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(activeAttemptId)) {
      throw new HttpError(400, "To‘lov urinishi topilmadi. Kartani qaytadan kiriting.", "attempt_not_found");
    }

    const { data: taken, error: takeError } = await serviceClient.rpc("payment_card_attempt_take", {
      p_subject_kind: "marketplace", p_subject_id: transactionId, p_attempt_id: activeAttemptId,
    });
    if (takeError) throw takeError;
    const attempt = taken as TakenAttempt | null;
    if (!attempt?.ok || !attempt.attemptId || !attempt.token || !attempt.displayPan) {
      const attemptCode = attempt?.code ?? "attempt_not_found";
      throw new HttpError(400, "To‘lov urinishi tugagan. Kartani qaytadan kiriting.", attemptCode);
    }
    attemptTaken = true;

    const verified = await provider.verifyCode(attempt.token, code);
    if (!verified.verified) throw new PaymentFailed("not_verified", "Karta tasdiqlanmadi.");
    if (!providerMaskMatches(verified.maskedNumber, attempt.displayPan)) {
      throw new PaymentFailed("provider_card_mismatch", "To‘lov tizimi karta ma’lumotini tasdiqlamadi.");
    }
    const { error: verifiedAdvanceError } = await serviceClient.rpc("payment_advance", {
      p_transaction_id: transactionId, p_to: "card_verified", p_event: "provider.card_verified",
    });
    if (verifiedAdvanceError) throw verifiedAdvanceError;

    const receiptId = await provider.createReceipt(somToTiyin(transaction.buyer_total), transactionId);
    const { error: receiptAdvanceError } = await serviceClient.rpc("payment_advance", {
      p_transaction_id: transactionId, p_to: "receipt_created",
      p_event: "provider.receipt_created", p_provider_receipt_id: receiptId,
    });
    if (receiptAdvanceError) throw receiptAdvanceError;
    const { error: processingAdvanceError } = await serviceClient.rpc("payment_advance", {
      p_transaction_id: transactionId, p_to: "processing", p_event: "provider.charging",
    });
    if (processingAdvanceError) throw processingAdvanceError;

    const charged = await provider.payReceipt(receiptId, verified.token);
    if (!charged.paid) throw new PaymentFailed("not_paid", "To‘lov amalga oshmadi.");
    if (!providerMaskMatches(charged.maskedNumber, attempt.displayPan)) {
      throw new PaymentFailed("provider_card_mismatch", "To‘lov tizimi karta ma’lumotini tasdiqlamadi.");
    }

    // Provider-paid settlement and remembering the trusted hint are one commit.
    const { data: settled, error: settleError } = await serviceClient.rpc("marketplace_settle_and_remember_card", {
      p_transaction_id: transactionId,
      p_attempt_id: attempt.attemptId,
      // Payme reports commission in tiyin; marketplace accounting stores whole
      // som, matching the order fulfilment path.
      p_provider_cost: Math.round(charged.providerCost / 100),
    });
    if (settleError) throw settleError;

    return json({ state: "paid", sandbox, purchase: settled });
  } catch (error) {
    const failureCode = error instanceof PaymentFailed
      ? error.code
      : error instanceof HttpError ? error.code : "internal_error";

    // The provider's own number, kept on the record. Our normalised code says
    // what kind of failure it was; only Payme's says which one, and that is the
    // thing to quote when asking them about it.
    const providerNote = error instanceof PaymentFailed && error.providerCode
      ? ` [payme ${error.providerCode}${error.providerData ? ` ${error.providerData}` : ""}]`
      : "";

    // Verification consumes the provider token before Payme sees the code. A
    // correctable verification error therefore returns the buyer to `start`;
    // keeping a stale token or hint would invite a replay against the old card.
    if (RECOVERABLE.has(failureCode)) {
      if (serviceClient && transactionId && activeAttemptId && (attemptCreated || attemptTaken)) {
        await serviceClient.rpc("payment_card_attempt_clear", {
          p_subject_kind: "marketplace", p_subject_id: transactionId, p_attempt_id: activeAttemptId,
        });
        await serviceClient.rpc("payment_clear_attempt_token", { p_transaction_id: transactionId });
      }
      const message = error instanceof Error ? redact(error.message) : "Ma’lumot noto‘g‘ri.";
      return json({
        error: message,
        code: failureCode,
        recoverable: true,
        // `take` atomically consumes the provider token before any provider
        // verification verdict. Every error after that point needs a fresh
        // card start, regardless of the provider's particular error code.
        restartRequired: attemptCreated || attemptTaken
          || failureCode === "attempt_not_found"
          || failureCode === "attempt_expired",
      }, 400);
    }

    // Anything else is terminal for this attempt: mark it and drop the token.
    // Best effort — the buyer's error is the one worth returning, so a failure
    // while recording it must not be allowed to replace it.
    if (serviceClient && transactionId) {
      const code = failureCode;
      const message = redact(error instanceof Error ? error.message : "To‘lov amalga oshmadi.") + providerNote;
      try {
        const { data: current } = await serviceClient
          .from("payment_transactions")
          .select("state,provider_receipt_id")
          .eq("id", transactionId)
          .maybeSingle();
        const charging = current?.state === "processing" || Boolean(current?.provider_receipt_id);
        if (!charging) {
          await serviceClient.rpc("payment_advance", {
            p_transaction_id: transactionId, p_to: "failed", p_event: "provider.failed",
            p_provider_error_code: code, p_provider_error_message: message,
          });
          if (activeAttemptId) {
            await serviceClient.rpc("payment_card_attempt_clear", {
              p_subject_kind: "marketplace", p_subject_id: transactionId, p_attempt_id: activeAttemptId,
            });
          }
          await serviceClient.rpc("payment_clear_attempt_token", { p_transaction_id: transactionId });
        }
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
