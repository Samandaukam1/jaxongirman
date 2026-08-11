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

/**
 * A one-time card token, plus what Payme itself already redacted. The masked
 * number and expiry hint are display metadata, never a credential: they arrive
 * pre-masked from the provider, so no code path here ever holds a full PAN in
 * order to produce them.
 */
export type CardHandle = {
  token: string;
  verified: boolean;
  maskedNumber: string | null;
  expiryHint: string | null;
};

export type PayResult = {
  paid: boolean;
  /** What the provider charged us for this transaction, in tiyin. */
  providerCost: number;
  maskedNumber: string | null;
};

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
  payReceipt(receiptId: string, token: string): Promise<PayResult>;
  /**
   * Asks the provider what actually happened to a receipt.
   *
   * The recovery path: an app killed mid-payment, or a response lost to a
   * dropped connection, leaves a receipt whose fate only the provider knows.
   * Charging again to find out is not an option.
   */
  checkReceipt(receiptId: string): Promise<PayResult>;
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
 * Payme's Subscribe API, written against the published method reference.
 *
 * https://developer.help.paycom.uz/metody-subscribe-api/
 *
 * The one thing worth knowing before reading this class: the API splits its
 * methods into two groups that authenticate differently, and getting that wrong
 * is both a failed call and a needless exposure of the merchant key.
 *
 *   * Card methods (`cards.create`, `cards.get_verify_code`, `cards.verify`)
 *     are documented as client-side. They authenticate with the merchant id
 *     ALONE — `X-Auth: <merchant_id>`. The key must not be sent.
 *   * Receipt methods (`receipts.create`, `receipts.pay`, `receipts.check`)
 *     are server-side and authenticate with `X-Auth: <merchant_id>:<key>`.
 *
 * We make the card calls from the server too — the card number must never pass
 * through our own database, but it does pass through this function on its way to
 * Payme, and nothing here writes it down. That does not change which credential
 * each method expects.
 *
 * Amounts are in tiyin. Payme returns the masked card number itself
 * (`860006******6311`), so no code here ever needs to mask a PAN: we store what
 * the provider already redacted.
 */
class PaymeProvider implements PaymentProvider {
  readonly name = "payme" as const;

  constructor(
    private readonly endpoint: string,
    private readonly merchantId: string,
    private readonly key: string,
  ) {}

  /**
   * `scope` picks the credential. Defaulting to "card" would be the dangerous
   * way round, so it is required at every call site.
   */
  private async call<T>(
    method: string,
    params: Record<string, unknown>,
    scope: "card" | "merchant",
  ): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth": scope === "merchant" ? `${this.merchantId}:${this.key}` : this.merchantId,
      },
      body: JSON.stringify({ id: Date.now(), method, params }),
    });

    const payload = await response.json() as {
      result?: T;
      error?: { code: number; message?: unknown; data?: unknown };
    };

    if (payload.error) {
      // Payme localises `message` as an object keyed by language. Take Uzbek
      // when it is there, and never surface the raw object.
      const raw = payload.error.message;
      const message = typeof raw === "string"
        ? raw
        : raw && typeof raw === "object"
          ? String((raw as Record<string, unknown>).uz ?? (raw as Record<string, unknown>).ru ?? "")
          : "";
      throw new PaymentFailed(
        String(payload.error.code),
        // Redacted by construction: a provider message that contained a card
        // number would be stored, and the column constraint would reject the
        // whole write.
        redactDigits(message) || "To‘lov tizimi so‘rovni rad etdi.",
      );
    }
    if (!payload.result) throw new PaymentFailed("empty_result", "To‘lov tizimi javob qaytarmadi.");
    return payload.result;
  }

  async createCard(pan: string, expiry: string): Promise<CardHandle> {
    // `save: false` is not a preference — a stored token would be a saved card,
    // which this product deliberately does not have.
    const result = await this.call<{ card: PaymeCard }>("cards.create", {
      card: { number: pan, expire: expiry },
      save: false,
    }, "card");
    return handleOf(result.card);
  }

  async requestCode(token: string): Promise<void> {
    await this.call("cards.get_verify_code", { token }, "card");
  }

  async verifyCode(token: string, code: string): Promise<CardHandle> {
    const result = await this.call<{ card: PaymeCard }>("cards.verify", { token, code }, "card");
    return handleOf(result.card);
  }

  async createReceipt(amountTiyin: number, orderId: string): Promise<string> {
    const result = await this.call<{ receipt: { _id: string } }>("receipts.create", {
      amount: amountTiyin,
      // The kassa's account field, agreed with Payme as `order_id`.
      account: { order_id: orderId },
    }, "merchant");
    return result.receipt._id;
  }

  async payReceipt(receiptId: string, token: string): Promise<PayResult> {
    const result = await this.call<{ receipt: PaymeReceipt }>("receipts.pay", {
      id: receiptId,
      token,
    }, "merchant");
    return payResultOf(result.receipt);
  }

  async checkReceipt(receiptId: string): Promise<PayResult> {
    const result = await this.call<{ receipt: PaymeReceipt }>("receipts.check", {
      id: receiptId,
    }, "merchant");
    return payResultOf(result.receipt);
  }
}

type PaymeCard = {
  token: string;
  /** Already masked by Payme, e.g. `860006******6311`. Never a full PAN. */
  number?: string;
  expire?: string;
  verify?: boolean;
  recurrent?: boolean;
};

type PaymeReceipt = {
  _id?: string;
  state?: number;
  commission?: number;
  card?: { number?: string; expire?: string };
};

/** Payme receipt state 4 is "paid". Anything else has not taken money. */
const RECEIPT_PAID = 4;

function handleOf(card: PaymeCard): CardHandle {
  return {
    token: card.token,
    // `verify: true` means the card is verified and the token is usable.
    // Reading this backwards would let an unverified token reach a charge.
    verified: card.verify === true,
    maskedNumber: card.number ?? null,
    expiryHint: card.expire ?? null,
  };
}

function payResultOf(receipt: PaymeReceipt): PayResult {
  return {
    paid: receipt.state === RECEIPT_PAID,
    providerCost: Number.isFinite(receipt.commission) ? Number(receipt.commission) : 0,
    maskedNumber: receipt.card?.number ?? null,
  };
}

/**
 * Removes anything that could be a card number from a provider message before
 * it is stored or logged. The database has the same rule as a constraint; this
 * is so a legitimate message is kept rather than rejected wholesale.
 */
function redactDigits(message: string): string {
  return message.replace(/\d{12,}/g, "\u2022\u2022\u2022\u2022");
}

/* ------------------------------------------------------------------ sandbox */

/**
 * The stand-in.
 *
 * Deterministic rather than random: the verification code is always `111111`, so
 * a test run is repeatable, and a card whose number ends in `0000` is always
 * declined so the failure path can be exercised too.
 *
 * The decline is encoded in the token rather than held in a field, because a
 * function instance does not survive between the request that creates the card
 * and the request that charges it. Instance state made the failure path
 * untestable — the very thing the sandbox exists for.
 */
class SandboxProvider implements PaymentProvider {
  readonly name = "mock" as const;
  static readonly CODE = "111111";
  /** Tokens carrying this marker are declined at charge time. */
  private static readonly DECLINE = "decline";

  async createCard(pan: string, expiry: string): Promise<CardHandle> {
    const marker = pan.endsWith("0000") ? `${SandboxProvider.DECLINE}_` : "";
    const token = `sandbox_${marker}${crypto.randomUUID()}`;
    // Masked the way Payme masks, so the display path is exercised identically.
    return await Promise.resolve({
      token,
      verified: false,
      maskedNumber: `${pan.slice(0, 6)}******${pan.slice(-4)}`,
      expiryHint: expiry.length === 4 ? `${expiry.slice(0, 2)}/${expiry.slice(2)}` : null,
    });
  }

  async requestCode(): Promise<void> {
    return await Promise.resolve();
  }

  async verifyCode(token: string, code: string): Promise<CardHandle> {
    if (code !== SandboxProvider.CODE) {
      throw new PaymentFailed("invalid_code", "Tasdiqlash kodi noto‘g‘ri.");
    }
    // Verification issues a new token, as Payme does — and carries the marker
    // across, so a declining card still declines after being verified.
    return await Promise.resolve({ token, verified: true, maskedNumber: null, expiryHint: null });
  }

  async createReceipt(): Promise<string> {
    return await Promise.resolve(`sandbox_receipt_${crypto.randomUUID()}`);
  }

  async payReceipt(_receiptId: string, token: string): Promise<PayResult> {
    if (token.includes(SandboxProvider.DECLINE)) {
      throw new PaymentFailed("insufficient_funds", "Kartada mablag‘ yetarli emas.");
    }
    return await Promise.resolve({ paid: true, providerCost: 0, maskedNumber: null });
  }

  async checkReceipt(): Promise<PayResult> {
    return await Promise.resolve({ paid: true, providerCost: 0, maskedNumber: null });
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
  // `PAYME_SUBSCRIBE_*` are the names the integration brief specifies; the
  // older pair is still read so a half-renamed deployment keeps working.
  const merchantId = Deno.env.get("PAYME_SUBSCRIBE_ID") ?? Deno.env.get("PAYME_ID");
  const key = Deno.env.get("PAYME_SUBSCRIBE_KEY") ?? Deno.env.get("PAYME_KEY");
  // Production unless the environment says otherwise. Payme has no separate
  // Subscribe sandbox for this merchant, so `test` points at their checkout
  // test host and is only ever set deliberately.
  const environment = Deno.env.get("PAYME_ENVIRONMENT") ?? "production";
  const endpoint = Deno.env.get("PAYME_ENDPOINT")
    ?? (environment === "test" ? "https://checkout.test.paycom.uz/api" : "https://checkout.paycom.uz/api");

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
