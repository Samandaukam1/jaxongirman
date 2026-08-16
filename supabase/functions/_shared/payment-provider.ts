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
export type VerificationCodeRequest = { sent: true; waitSeconds: number | null };

export interface PaymentProvider {
  readonly name: "payme" | "mock";
  /** Creates a one-time card token. `save` is always false: nothing is stored. */
  createCard(pan: string, expiry: string): Promise<CardHandle>;
  /** Asks the provider to send the cardholder a verification code. */
  requestCode(token: string): Promise<VerificationCodeRequest>;
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
  /**
   * `code` is ours — a screen branches on it. `providerCode` is the provider's
   * own, kept beside it rather than replaced by it.
   *
   * Normalising -32504 into "the payment system is unavailable" is right for the
   * buyer and useless for whoever has to fix it: the number is the only thing
   * that says *which* refusal it was. It is carried through to the logs and to
   * the failure record, and never to the buyer.
   */
  constructor(
    public code: string,
    message: string,
    public providerCode?: string,
    /**
     * Payme's `error.data`, which is where the useful part lives. A -32504
     * carrying `invalid_key` and a -32504 carrying anything else need different
     * people to fix them, and the number alone does not say which.
     */
    public providerData?: string,
  ) {
    super(message);
  }
}

/**
 * Payme's numeric codes, mapped to a name and a sentence a buyer can act on.
 *
 * Observed against the live merchant rather than guessed: -31300, -31602 and
 * -32504 came back from production during credential verification. The rest are
 * from the published reference. An unmapped code keeps the provider's own
 * message, which is already in Uzbek or Russian and is better than a generic
 * apology.
 *
 * -32504 is worth a comment: it means the caller was refused, which for this
 * integration means the wrong credential was sent for the method class. It is a
 * configuration fault, never something a buyer can fix, so it is deliberately
 * not in RECOVERABLE and the buyer is told the system is unavailable rather than
 * being invited to re-type a card that was never the problem.
 */
const PAYME_ERRORS: Record<string, { code: string; message: string }> = {
  "-31300": { code: "card_invalid", message: "Karta raqami noto‘g‘ri." },
  "-31301": { code: "card_expired", message: "Kartaning amal qilish muddati tugagan." },
  "-31302": { code: "card_blocked", message: "Karta bloklangan. Bankingizga murojaat qiling." },
  "-31303": { code: "card_not_found", message: "Bunday karta topilmadi." },
  "-31400": { code: "insufficient_funds", message: "Kartada mablag‘ yetarli emas." },
  "-31601": { code: "receipt_invalid", message: "To‘lov cheki yaroqsiz. Qaytadan boshlang." },
  "-31602": { code: "receipt_not_found", message: "To‘lov cheki topilmadi yoki allaqachon to‘langan." },
  "-31610": { code: "invalid_code", message: "Tasdiqlash kodi noto‘g‘ri." },
  "-31611": { code: "code_expired", message: "Tasdiqlash kodining muddati tugadi. Yangi kod so‘rang." },
  // Seen in production carrying `data: "invalid_key"`: the merchant key sent
  // for receipt methods was not the merchant's current one. `receipts.create`
  // does not check the key, which is why it kept working and only the charge
  // was refused — an hour of looking at the wrong request.
  "-32504": { code: "provider_auth", message: "To‘lov tizimi vaqtincha ishlamayapti. Keyinroq urinib ko‘ring." },
};

/** Turns a provider code and message into our normalised failure. */
export function paymeFailure(code: string, providerMessage: string, providerData?: unknown): PaymentFailed {
  const detail = safeProviderData(providerData);
  const known = PAYME_ERRORS[code];
  if (known) return new PaymentFailed(known.code, known.message, code, detail);
  return new PaymentFailed(
    `payme_${code.replace("-", "")}`,
    providerMessage || "To‘lov tizimi so‘rovni rad etdi.",
    code,
    detail,
  );
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

  constructor(private readonly config: PaymeConfig) {}

  /**
   * `scope` picks the credential. Defaulting to "card" would be the dangerous
   * way round, so it is required at every call site.
   */
  private async call<T>(
    method: string,
    params: Record<string, unknown>,
    scope: "card" | "merchant",
  ): Promise<T> {
    const { endpoint, merchantId, key, environment, merchantTail } = this.config;
    // Enough to tell one environment from another when a call is refused, and
    // nothing that would be a credential if the log were read by the wrong
    // person: no key, no assembled X-Auth, no card token. The merchant id is
    // reduced to its last four characters — two merchants are distinguishable,
    // the identifier is not reconstructable.
    const context = {
      method,
      scope,
      endpoint,
      environment,
      merchant: `…${merchantTail}`,
      // `receipts.*` carry the receipt this call is about; it is our own
      // reference, not a secret, and it is the thing to quote to Payme.
      receipt: typeof params.id === "string" ? params.id : undefined,
    };
    console.log("payme.request", JSON.stringify(context));

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth": scope === "merchant" ? `${merchantId}:${key}` : merchantId,
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
      // Card verification errors are deliberately reduced to a fixed sentence:
      // a provider is free to echo the 4--6 digit SMS code in `message`, and an
      // OTP must never enter logs or a failure column. Other methods retain a
      // PAN-redacted provider sentence for operational diagnosis.
      const diagnosticMessage = safeProviderMessage(method, message);
      console.error("payme.error", JSON.stringify({
        ...context,
        status: response.status,
        code: payload.error.code,
        message: diagnosticMessage,
        data: safeProviderData(payload.error.data) ?? "[omitted]",
      }));
      // Normalised to our own codes so a screen can branch on meaning rather
      // than on a provider's numbering. The message is redacted either way: one
      // containing a card number would be stored, and the column constraint
      // would then reject the whole write.
      throw paymeFailure(String(payload.error.code), diagnosticMessage, payload.error.data);
    }
    if (!payload.result) throw new PaymentFailed("empty_result", "To‘lov tizimi javob qaytarmadi.");
    console.log("payme.ok", JSON.stringify(context));
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

  async requestCode(token: string): Promise<VerificationCodeRequest> {
    const result = await this.call<{ sent?: boolean; wait?: number }>(
      "cards.get_verify_code",
      { token },
      "card",
    );
    if (result.sent !== true) {
      throw new PaymentFailed("code_not_sent", "Tasdiqlash kodini yuborib bo‘lmadi.");
    }
    return {
      sent: true,
      waitSeconds: Number.isFinite(result.wait) ? Math.max(Number(result.wait), 0) : null,
    };
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
    // Payme deployments return both documented shapes in the wild: some wrap
    // the state in `receipt`, while the official response may put `state`
    // directly on `result`. Treating only the former as valid turns a successful
    // reconciliation into an undefined dereference.
    const result = await this.call<PaymeReceipt & { receipt?: PaymeReceipt }>("receipts.check", {
      id: receiptId,
    }, "merchant");
    return payResultOf(result.receipt ?? result);
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

/** Never retain free-form provider text from the one method that receives OTP. */
function safeProviderMessage(method: string, message: string): string {
  if (method === "cards.verify") return "Karta tasdiqlash so\u2018rovi rad etildi.";
  return redactDigits(message);
}

/**
 * Keeps only known-safe diagnostic labels from Payme's free-form `error.data`.
 *
 * Production has returned `invalid_key`, which is valuable. The same field is
 * otherwise allowed to be an arbitrary scalar or object and could echo a PAN,
 * token, OTP or credential. Unknown values are therefore omitted rather than
 * logged and then hoped safe.
 */
function safeProviderData(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const detail = value.trim().toLowerCase();
  const safeLabels = new Set([
    "invalid_key",
    "invalid_amount",
    "invalid_account",
    "invalid_card",
    "invalid_expire",
    "invalid_token",
    "invalid_code",
    "invalid_id",
  ]);
  return safeLabels.has(detail) ? detail : undefined;
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

  async requestCode(): Promise<VerificationCodeRequest> {
    return await Promise.resolve({ sent: true, waitSeconds: 60 });
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
/**
 * Everything the Payme adapter needs from the environment, read once.
 *
 * Trimming is not tidiness. A key is copied out of a cabinet and pasted into a
 * secrets form, and a trailing newline or space rides along unseen; the header
 * then carries a credential that is one character wrong, which the provider
 * refuses without ever saying why. That single character has exactly the shape
 * of the failure this integration has been chasing, so it is removed here
 * rather than hoped against.
 */
export type PaymeConfig = {
  endpoint: string;
  merchantId: string;
  key: string;
  environment: string;
  /** For logs and diagnostics: enough to tell two merchants apart, and no more. */
  merchantTail: string;
  /**
   * Which variables these actually came from.
   *
   * Several spellings are accepted so a rename cannot fail closed half-way, and
   * that is precisely how a deployment ends up authenticating with a variable
   * nobody remembers setting. The answer should never be a matter of reading
   * the fallback chain and guessing.
   */
  source: { merchantId: string; key: string; endpoint: string };
  /** True when the stored value carried whitespace that had to be removed. */
  trimmed: { merchantId: boolean; key: boolean };
};

/** The first variable of `names` that holds anything, with its name. */
function pick(names: string[]): { name: string; raw: string } | null {
  for (const name of names) {
    const raw = Deno.env.get(name) ?? "";
    if (raw.trim()) return { name, raw };
  }
  return null;
}

function env(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

/** Where the production Subscribe API lives. Nothing computes this. */
export const PAYME_PRODUCTION_URL = "https://checkout.paycom.uz/api";

export function paymeConfig(): PaymeConfig | null {
  // `PAYME_MERCHANT_ID` / `PAYME_SUBSCRIBE_KEY` / `PAYME_API_URL` are the
  // standard names. The earlier spellings are still read, in that order, so a
  // deployment part-way through a rename keeps taking payments rather than
  // failing closed at the moment the first name is changed.
  const merchant = pick(["PAYME_SUBSCRIBE_ID", "PAYME_MERCHANT_ID", "PAYME_ID"]);
  const secret = pick(["PAYME_SUBSCRIBE_KEY", "PAYME_KEY"]);
  if (!merchant || !secret) return null;
  const merchantId = merchant.raw.trim();
  const key = secret.raw.trim();

  // Production unless the environment deliberately says otherwise. Payme has no
  // separate Subscribe sandbox for this merchant, so the test host is only ever
  // reached by setting `PAYME_ENVIRONMENT=test` on purpose — a live payment
  // cannot drift onto it by omission.
  const environment = env("PAYME_ENVIRONMENT") || "production";
  const url = pick(["PAYME_API_URL", "PAYME_ENDPOINT"]);
  const endpoint = url?.raw.trim()
    || (environment === "test" ? "https://checkout.test.paycom.uz/api" : PAYME_PRODUCTION_URL);

  return {
    endpoint,
    merchantId,
    key,
    environment,
    merchantTail: merchantId.slice(-4),
    source: {
      merchantId: merchant.name,
      key: secret.name,
      endpoint: url?.name ?? "(standart)",
    },
    trimmed: {
      merchantId: merchant.raw !== merchantId,
      key: secret.raw !== key,
    },
  };
}

/**
 * What a credential looks like, without saying what it is.
 *
 * A key that is refused is either the wrong key or the right key stored wrongly,
 * and those need different people to fix them. Nobody can tell which from a
 * refusal alone, and the value itself must not be printed to find out — so this
 * reports only shape: how long it is, which character classes it uses, and
 * whether it carries the quotes or spaces that a paste into a secrets form
 * leaves behind.
 */
export function credentialShape(value: string): string {
  const notes: string[] = [`${value.length} belgi`];
  if (/^[0-9a-f]+$/i.test(value)) notes.push("faqat hex");
  else if (/^[A-Za-z0-9]+$/.test(value)) notes.push("harf va raqam");
  else notes.push("boshqa belgilar ham bor");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) notes.push("UUID shaklida");
  if (/["']/.test(value)) notes.push("QO‘SHTIRNOQ BOR");
  if (/\s/.test(value)) notes.push("BO‘SH JOY BOR");
  if (value !== value.trim()) notes.push("CHETIDA BO‘SH JOY BOR");
  return notes.join(", ");
}

/**
 * A credential's SHA-256, so two copies can be compared without either being read.
 *
 * This is the only way to answer the question that matters when a key is
 * refused: is the running function using the value that was stored, or a stale
 * one from a deployment that predates the change? The hosting platform reports
 * the digest of what it holds; this reports the digest of what arrived. If the
 * two agree, the runtime is current and the stored value itself is the problem.
 * If they disagree, redeploying is the fix and the key was never wrong.
 *
 * The full digest is returned. It is a one-way hash of a secret, not the secret
 * — and a partial one could not be compared against anything.
 */
export async function fingerprint(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Which variables are missing, by name, so an operator is told rather than guessing. */
export function missingPaymeVariables(): string[] {
  const missing: string[] = [];
  if (!env("PAYME_SUBSCRIBE_ID") && !env("PAYME_MERCHANT_ID") && !env("PAYME_ID")) missing.push("PAYME_SUBSCRIBE_ID");
  if (!env("PAYME_SUBSCRIBE_KEY") && !env("PAYME_KEY")) missing.push("PAYME_SUBSCRIBE_KEY");
  return missing;
}

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
  const config = paymeConfig();
  if (config) return { provider: new PaymeProvider(config), sandbox: false };

  const mode = env("PAYMENT_MODE") || "real";
  if (mode === "sandbox" && !paymentsConfigured) {
    return { provider: new SandboxProvider(), sandbox: true };
  }

  throw new PaymentFailed(
    "provider_unavailable",
    `To‘lov tizimi hali ulanmagan (${missingPaymeVariables().join(", ")}). Iltimos, keyinroq urinib ko‘ring.`,
  );
}

/** The code the sandbox accepts, so the UI can say so during development. */
export const SANDBOX_CODE = SandboxProvider.CODE;

/* -------------------------------------------------------------- diagnostics */

export type Probe = {
  step: string;
  ok: boolean;
  /** Payme's own code, whole. The point of the exercise. */
  providerCode?: number;
  providerMessage?: string;
  providerData?: unknown;
  note: string;
};

/**
 * Asks Payme, without moving any money, whether our key is accepted for the
 * methods that need one.
 *
 * The integration's puzzle is that `receipts.create` succeeds while
 * `receipts.pay` is refused with -32504, even though both are sent with the
 * same `X-Auth: <merchant_id>:<key>`. Two explanations fit, and they need
 * opposite fixes:
 *
 *   * The key is wrong, and `receipts.create` never checked it. Payme documents
 *     create as reachable from the checkout page, so the merchant id alone can
 *     be enough for it — in which case a create that works says nothing at all
 *     about the key, and every method that does check it will refuse us.
 *   * The key is right and the refusal really is per-method, which is a
 *     merchant cabinet matter and not something in this repository.
 *
 * Three probes separate them. Creating a receipt costs nothing and takes
 * nothing: an unpaid receipt simply expires.
 */
export async function probePaymeCredentials(config: PaymeConfig, amountTiyin = 100): Promise<Probe[]> {
  const probes: Probe[] = [];

  async function ask(
    step: string,
    method: string,
    params: Record<string, unknown>,
    auth: string,
    note: string,
  ): Promise<{ result?: Record<string, unknown> }> {
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Auth": auth },
        body: JSON.stringify({ id: Date.now(), method, params }),
      });
      const payload = await response.json() as {
        result?: Record<string, unknown>;
        error?: { code: number; message?: unknown; data?: unknown };
      };
      if (payload.error) {
        const raw = payload.error.message;
        probes.push({
          step,
          ok: false,
          providerCode: payload.error.code,
          providerMessage: redactDigits(typeof raw === "string"
            ? raw
            : String((raw as Record<string, unknown> | undefined)?.uz
              ?? (raw as Record<string, unknown> | undefined)?.ru ?? "")),
          providerData: safeProviderData(payload.error.data),
          note,
        });
        return {};
      }
      probes.push({ step, ok: true, note });
      return { result: payload.result };
    } catch (error) {
      probes.push({ step, ok: false, note: `${note} — so‘rov yuborilmadi: ${String(error)}` });
      return {};
    }
  }

  const account = { order_id: `diagnostika-${Date.now()}` };

  // 1. Create with the full credential — the call that is known to work.
  const withKey = await ask(
    "receipts.create (id:key)",
    "receipts.create",
    { amount: amountTiyin, account },
    `${config.merchantId}:${config.key}`,
    "To‘liq credential bilan chek yaratish — bu hozir ham ishlaydi.",
  );

  // 2. The same create with the merchant id alone. If this also succeeds, then
  //    create never validated the key, and its success was never evidence that
  //    the key is right.
  await ask(
    "receipts.create (faqat id)",
    "receipts.create",
    { amount: amountTiyin, account },
    config.merchantId,
    "Kalitsiz chek yaratish. Agar bu ham o‘tsa, create kalitni tekshirmaydi —"
    + " demak uning ishlashi kalit to‘g‘ri degani emas.",
  );

  // 3. A merchant-scope read against the receipt from probe 1. This is the same
  //    class of method as `receipts.pay`, and it charges nothing. Its answer is
  //    the one that matters.
  const receipt = withKey.result?.receipt as { _id?: string } | undefined;
  if (receipt?._id) {
    await ask(
      "receipts.check (id:key)",
      "receipts.check",
      { id: receipt._id },
      `${config.merchantId}:${config.key}`,
      "Kalit talab qiladigan, lekin pul olmaydigan metod. -32504 qaytsa —"
      + " muammo kalitda; o‘tsa — muammo aynan receipts.pay huquqida.",
    );
  } else {
    probes.push({
      step: "receipts.check (id:key)",
      ok: false,
      note: "Chek yaratilmagani uchun tekshirib bo‘lmadi.",
    });
  }

  return probes;
}
