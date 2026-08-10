/**
 * The payment provider seam.
 *
 * Two implementations sit behind one interface: Payme, and a sandbox that
 * stands in for it while credentials are pending. Which one runs is decided by
 * the server's own environment and by `app_settings.payments.config` — never by
 * anything the client sends.
 *
 * The sandbox exists so the checkout, OTP and partial-card flows can be built
 * and exercised end to end. It is not a shortcut around payment: every row it
 * creates is marked `is_sandbox`, excluded from every financial aggregate, and
 * refused outright the moment a real provider is configured.
 */

export type CardHandle = { token: string; verified: boolean };

export type ProviderError = { code: string; message: string };

export interface PaymentProvider {
  readonly name: "payme" | "mock";
  /** Creates a one-time card token. `save` is always false: nothing is stored. */
  createCard(pan: string, expiry: string): Promise<CardHandle>;
  /** Asks the provider to send the cardholder a verification code. */
  requestCode(token: string): Promise<void>;
  /** Exchanges the code for a usable token. */
  verifyCode(token: string, code: string): Promise<CardHandle>;
  /** Opens a receipt for an amount, in tiyin. */
  createReceipt(amountTiyin: number, orderId: string): Promise<string>;
  /** Charges the verified token against the receipt. */
  payReceipt(receiptId: string, token: string): Promise<{ paid: boolean; providerCost: number }>;
}

export class PaymentFailed extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Som are whole; Payme counts in tiyin. One conversion, in one place. */
export function somToTiyin(som: number): number {
  return Math.round(som) * 100;
}

/* -------------------------------------------------------------------- Payme */

/**
 * Payme's Subscribe (cards) API.
 *
 * IMPORTANT: the method names and the request/response envelope below follow
 * the Subscribe API as documented at the time of writing. Before this is
 * switched on, the payloads and the error codes MUST be checked against Payme's
 * current documentation and exercised in their sandbox — this adapter is
 * written to the documented shape, not verified against a live merchant.
 */
class PaymeProvider implements PaymentProvider {
  readonly name = "payme" as const;

  constructor(
    private readonly endpoint: string,
    private readonly merchantId: string,
    private readonly key: string,
  ) {}

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Subscribe API authenticates the merchant on every call.
        "X-Auth": `${this.merchantId}:${this.key}`,
      },
      body: JSON.stringify({ id: crypto.randomUUID(), method, params }),
    });

    const payload = await response.json() as { result?: T; error?: { code: number; message?: unknown } };
    if (payload.error) {
      const message = typeof payload.error.message === "string"
        ? payload.error.message
        : "To‘lov tizimi so‘rovni rad etdi.";
      throw new PaymentFailed(String(payload.error.code), message);
    }
    if (!payload.result) throw new PaymentFailed("empty_result", "To‘lov tizimi javob qaytarmadi.");
    return payload.result;
  }

  async createCard(pan: string, expiry: string): Promise<CardHandle> {
    // `save: false` is not a preference — a stored token would be a saved card,
    // which this product deliberately does not have.
    const result = await this.call<{ card: { token: string; verify: boolean } }>("cards.create", {
      card: { number: pan, expire: expiry },
      save: false,
    });
    return { token: result.card.token, verified: !result.card.verify };
  }

  async requestCode(token: string): Promise<void> {
    await this.call("cards.get_verify_code", { token });
  }

  async verifyCode(token: string, code: string): Promise<CardHandle> {
    const result = await this.call<{ card: { token: string; verify: boolean } }>("cards.verify", { token, code });
    return { token: result.card.token, verified: result.card.verify };
  }

  async createReceipt(amountTiyin: number, orderId: string): Promise<string> {
    const result = await this.call<{ receipt: { _id: string } }>("receipts.create", {
      amount: amountTiyin,
      account: { order_id: orderId },
    });
    return result.receipt._id;
  }

  async payReceipt(receiptId: string, token: string): Promise<{ paid: boolean; providerCost: number }> {
    const result = await this.call<{ receipt: { state: number } }>("receipts.pay", { id: receiptId, token });
    // State 4 is "paid" in Payme's receipt lifecycle. Anything else has not
    // taken money, whatever it looks like.
    return { paid: result.receipt.state === 4, providerCost: 0 };
  }
}

/* ------------------------------------------------------------------ sandbox */

/**
 * The stand-in.
 *
 * Deterministic rather than random: the verification code is always `111111`,
 * so a test run is repeatable, and a card whose number ends in `0000` always
 * fails so the failure path can be exercised too.
 */
class SandboxProvider implements PaymentProvider {
  readonly name = "mock" as const;
  static readonly CODE = "111111";

  private failing = new Set<string>();

  async createCard(pan: string): Promise<CardHandle> {
    const token = `sandbox_${crypto.randomUUID()}`;
    if (pan.endsWith("0000")) this.failing.add(token);
    return await Promise.resolve({ token, verified: false });
  }

  async requestCode(): Promise<void> {
    return await Promise.resolve();
  }

  async verifyCode(token: string, code: string): Promise<CardHandle> {
    if (code !== SandboxProvider.CODE) {
      throw new PaymentFailed("invalid_code", "Tasdiqlash kodi noto‘g‘ri.");
    }
    return await Promise.resolve({ token, verified: true });
  }

  async createReceipt(): Promise<string> {
    return await Promise.resolve(`sandbox_receipt_${crypto.randomUUID()}`);
  }

  async payReceipt(_receiptId: string, token: string): Promise<{ paid: boolean; providerCost: number }> {
    if (this.failing.has(token)) {
      throw new PaymentFailed("insufficient_funds", "Kartada mablag‘ yetarli emas.");
    }
    return await Promise.resolve({ paid: true, providerCost: 0 });
  }
}

/* ------------------------------------------------------------------ factory */

export type ProviderChoice = { provider: PaymentProvider; sandbox: boolean };

/**
 * Picks the adapter.
 *
 * Real credentials win whenever they exist. The sandbox requires two
 * independent switches — `PAYMENT_MODE=sandbox` in the server environment and
 * `payments.config.configured = false` in the database — so it cannot be
 * reached by setting one flag by accident, and it dies the moment the platform
 * declares itself live.
 */
export function selectProvider(paymentsConfigured: boolean): ProviderChoice {
  const merchantId = Deno.env.get("PAYME_ID");
  const key = Deno.env.get("PAYME_KEY");
  const endpoint = Deno.env.get("PAYME_ENDPOINT") ?? "https://checkout.paycom.uz/api";

  if (merchantId && key) {
    return { provider: new PaymeProvider(endpoint, merchantId, key), sandbox: false };
  }

  const mode = Deno.env.get("PAYMENT_MODE") ?? "real";
  if (mode === "sandbox" && !paymentsConfigured) {
    return { provider: new SandboxProvider(), sandbox: true };
  }

  throw new PaymentFailed(
    "provider_unavailable",
    "To‘lov tizimi hali ulanmagan. Iltimos, keyinroq urinib ko‘ring.",
  );
}

/** The code the sandbox accepts, so the UI can say so during development. */
export const SANDBOX_CODE = SandboxProvider.CODE;
