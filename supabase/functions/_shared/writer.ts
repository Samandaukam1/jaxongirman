import { toGeminiSchema } from "./gemini-schema.ts";

/**
 * The model that writes every word of a deck.
 *
 * There used to be two. Gemini wrote first and OpenAI stood behind it, on the
 * reasoning that a generator which stops when one vendor has a bad afternoon is
 * not a generator anybody can sell. That reasoning was wrong in a specific way:
 * the second vendor was not a spare, it was a second bill, and when its balance
 * reached zero it did not stand quietly behind Gemini — it took over the moment
 * Gemini returned anything at all and then failed the deck itself. A fallback
 * that can fail is not redundancy; it is a second way to lose.
 *
 * So there is one provider, and the resilience lives inside it: a request is
 * retried while retrying can plausibly help, and research that cannot reach the
 * live web falls back to the model's own knowledge rather than to another
 * company. Both of those recover the deck. Neither of them can be billed to an
 * account nobody topped up.
 *
 * Nothing here reads the environment or touches Supabase, which is what lets
 * every rule below be tested on a developer machine that has no Deno.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export type WriterUsage = { input_tokens?: number; output_tokens?: number };

/** A file the author attached, carried inline rather than uploaded anywhere. */
export type Attachment = { mimeType: string; data: string };

export type Attribution = {
  provider: "google";
  model: string;
  /** How many requests it took. 1 is the normal answer. */
  attempts: number;
};

export type ResearchAnswer = {
  text: string;
  citations: { title: string; url: string }[];
  usage: WriterUsage;
  requestId: string | null;
  /** False when the live web could not be reached and the model answered from memory. */
  groundedSearch: boolean;
} & Attribution;

export type StructuredAnswer<T> = {
  data: T;
  usage: WriterUsage;
  requestId: string | null;
} & Attribution;

/**
 * Raised when Gemini did not answer.
 *
 * `reason` is a stable code — never the provider's own sentence, which can
 * quote the request back at you and a request carries a key.
 */
export class ProviderUnavailable extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "ProviderUnavailable";
  }
}

/**
 * Whether asking again could plausibly produce a different answer.
 *
 * A rate limit and a bad gateway pass; a rejected schema and a rejected key do
 * not. The distinction matters more now than it did when there was somewhere
 * else to go: a retry loop over a permanent fault is just a slower failure, and
 * the person waiting on it is watching a progress bar.
 */
export function retryable(reason: string): boolean {
  if (reason === "rate_limited" || reason === "network") return true;
  if (reason === "empty_response" || reason === "malformed_json") return true;
  // 5xx is the provider's problem and usually brief. 4xx is ours and is not.
  return /^http_5\d\d$/.test(reason);
}

type GeminiPart = { text?: string };
type GeminiCandidate = {
  content?: { parts?: GeminiPart[] };
  groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
  finishReason?: string;
};
type GeminiResponse = {
  candidates?: GeminiCandidate[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string };
};

function textOf(payload: GeminiResponse): string {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((part) => part.text ?? "").join("").trim();
  if (!text) {
    const finish = payload.candidates?.[0]?.finishReason ?? "unknown";
    throw new ProviderUnavailable("empty_response", `Gemini returned no text (${finish})`);
  }
  return text;
}

function usageOf(payload: GeminiResponse): WriterUsage {
  return {
    input_tokens: payload.usageMetadata?.promptTokenCount ?? 0,
    output_tokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

/** Every page the grounded search actually cited. */
function citationsOf(payload: GeminiResponse): { title: string; url: string }[] {
  const seen = new Map<string, string>();
  for (const chunk of payload.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
    const url = chunk.web?.uri;
    if (!url || seen.has(url)) continue;
    seen.set(url, chunk.web?.title?.trim() || url);
  }
  return [...seen].map(([url, title]) => ({ title, url }));
}

export type WriterOptions = {
  apiKey: string;
  researchModel: string;
  writingModel: string;
  /** Injected so the retry rules can be tested without a network or a wait. */
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

export class GeminiWriter {
  private readonly key: string;
  readonly researchModel: string;
  readonly writingModel: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: WriterOptions) {
    this.key = options.apiKey;
    this.researchModel = options.researchModel;
    this.writingModel = options.writingModel;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  /** True when a key is present. Reported as a boolean and never as a value. */
  get configured() { return this.key.length > 10; }

  private url(model: string): string {
    return `${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.key)}`;
  }

  private async call(model: string, body: Record<string, unknown>): Promise<GeminiResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(model), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (failure) {
      throw new ProviderUnavailable("network", failure instanceof Error ? failure.message : "network error");
    }

    let payload: GeminiResponse;
    try {
      payload = await response.json() as GeminiResponse;
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const reason = response.status === 429 ? "rate_limited" : `http_${response.status}`;
      // The provider's message is kept for the server log, never for the user.
      throw new ProviderUnavailable(reason, payload.error?.message ?? `Gemini request failed (${response.status})`);
    }
    return payload;
  }

  /**
   * Repeats an attempt while repeating it can help.
   *
   * Backoff is linear and short. The caller is a background job with a person
   * watching a progress bar, so the budget for politeness is a couple of
   * seconds, not a couple of minutes.
   */
  private async withRetries<T>(
    attempts: number,
    action: (attempt: number) => Promise<T>,
  ): Promise<{ value: T; attempts: number }> {
    let last: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return { value: await action(attempt), attempts: attempt };
      } catch (failure) {
        last = failure;
        const reason = failure instanceof ProviderUnavailable ? failure.reason : null;
        if (reason === null || !retryable(reason) || attempt === attempts) break;
        await this.sleep(600 * attempt);
      }
    }
    throw last;
  }

  /**
   * No sampling parameters are sent, deliberately.
   *
   * `temperature`, `topP` and `topK` are deprecated on Gemini 3.x: they are
   * ignored today and a later generation answers a request carrying them with
   * an HTTP 400. A 400 is not retryable and there is no second provider behind
   * this one, so a stray knob would not degrade a deck — it would end it. The
   * model's own defaults are also what its reasoning is tuned against, which is
   * the better reason to leave them alone.
   */
  private parts(prompt: string, attachments: readonly Attachment[]): unknown[] {
    return [
      { text: prompt },
      ...attachments.map((file) => ({ inline_data: { mime_type: file.mimeType, data: file.data } })),
    ];
  }

  /**
   * A structured answer, constrained by Gemini rather than parsed hopefully.
   *
   * `responseMimeType: application/json` plus a schema is the provider's own
   * constrained decoding. There is no repair pass on purpose: parsing around a
   * malformed answer is how a generator ships a deck built from half-understood
   * JSON.
   */
  async structured<T>(input: {
    prompt: string;
    system?: string;
    schemaName: string;
    schema: Record<string, unknown>;
    maxOutputTokens?: number;
    attachments?: readonly Attachment[];
    model?: string;
  }): Promise<StructuredAnswer<T>> {
    if (!this.configured) throw new ProviderUnavailable("not_configured", "GEMINI_API_KEY is not set");
    const model = input.model ?? this.writingModel;

    const { value, attempts } = await this.withRetries(3, async () => {
      const payload = await this.call(model, {
        contents: [{ role: "user", parts: this.parts(input.prompt, input.attachments ?? []) }],
        ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: toGeminiSchema(input.schema),
          maxOutputTokens: input.maxOutputTokens ?? 8_000,
        },
      });

      const text = textOf(payload);
      let data: T;
      try {
        data = JSON.parse(text) as T;
      } catch {
        throw new ProviderUnavailable("malformed_json", `Gemini returned unparseable JSON for ${input.schemaName}`);
      }
      return { data, usage: usageOf(payload) };
    });

    return { ...value, requestId: null, provider: "google", model, attempts };
  }

  /**
   * Notes from the live web, and the pages they came from.
   *
   * Search and a strict schema cannot both be asked for in one Gemini call, so
   * this returns prose and the caller structures it.
   *
   * When search itself will not work — the tool is unavailable in a region, the
   * quota for it is exhausted — the model is asked the same question without
   * it. That answer is worth less and is marked as worth less: `groundedSearch`
   * is false, the usage row says so, and the step tells the author in plain
   * Uzbek that the deck was written from the model's memory. What it is not is
   * a reason to throw away a deck somebody has already paid for.
   */
  async research(input: {
    prompt: string;
    system?: string;
    maxOutputTokens?: number;
    attachments?: readonly Attachment[];
  }): Promise<ResearchAnswer> {
    if (!this.configured) throw new ProviderUnavailable("not_configured", "GEMINI_API_KEY is not set");
    const model = this.researchModel;

    const request = (grounded: boolean) => ({
      contents: [{ role: "user", parts: this.parts(input.prompt, input.attachments ?? []) }],
      ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
      ...(grounded ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: {
        maxOutputTokens: input.maxOutputTokens ?? 3_000,
      },
    });

    try {
      const { value, attempts } = await this.withRetries(3, async () => {
        const payload = await this.call(model, request(true));
        return { text: textOf(payload), citations: citationsOf(payload), usage: usageOf(payload) };
      });
      return { ...value, requestId: null, provider: "google", model, attempts, groundedSearch: true };
    } catch (failure) {
      // Only a provider fault earns the ungrounded retry. Anything else is a
      // bug in this file and hiding it behind a degraded answer would keep it.
      if (!(failure instanceof ProviderUnavailable)) throw failure;

      const { value, attempts } = await this.withRetries(2, async () => {
        const payload = await this.call(model, request(false));
        return { text: textOf(payload), usage: usageOf(payload) };
      });
      return {
        ...value, citations: [], requestId: null,
        provider: "google", model, attempts, groundedSearch: false,
      };
    }
  }
}

/**
 * What goes in `ai_usage.metadata`.
 *
 * Only facts that are still true. The old rows carried `fallback_provider` and
 * `fallback_reason` even when nothing had fallen back, which made a real
 * fallback impossible to count; with one provider those fields would be pure
 * decoration, so they are gone. What remains answers the two questions somebody
 * reading the table actually has: did this take more than one try, and was the
 * research real.
 */
export function attributionMetadata(
  answer: { attempts: number; groundedSearch?: boolean },
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { attempts: answer.attempts };
  if (answer.groundedSearch === undefined) return metadata;
  metadata.grounded_search = answer.groundedSearch;
  if (!answer.groundedSearch) metadata.fallback_mode = "gemini_model_knowledge";
  return metadata;
}

/**
 * What the author is told when generation fails.
 *
 * A provider's own words must never reach a phone. "You have no credits
 * remaining — please add to your billing" is a sentence about our account, and
 * it appeared on a paying customer's screen; the same is true of a rate limit,
 * a region block or a rejected key. None of them are the author's doing and
 * none of them are actionable by the author, so all of them collapse into one
 * honest sentence and a code the server log can be searched by.
 *
 * Errors this code raised itself — a missing design, an unreadable file — pass
 * through, because those the author can actually fix.
 */
export function userFacingFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ProviderUnavailable) {
    if (error.reason === "not_configured") {
      return {
        code: "provider_not_configured",
        message: "AI xizmati hozircha sozlanmagan. Iltimos, qo‘llab-quvvatlash xizmatiga murojaat qiling.",
      };
    }
    return {
      code: `provider_unavailable:${error.reason}`,
      message: "AI xizmati vaqtincha javob bermadi. Iltimos, birozdan keyin qayta urinib ko‘ring.",
    };
  }

  const message = error instanceof Error ? error.message : "";
  // A provider error that reached us through some other path — a raw `Error`
  // thrown by a client we do not control. Recognised by what it says, because
  // that is all there is to go on, and never repeated to the author.
  if (/\b(billing|credit|quota|api key|insufficient_quota|rate limit)\b/i.test(message)) {
    return {
      code: "provider_unavailable:billing",
      message: "AI xizmati vaqtincha javob bermadi. Iltimos, birozdan keyin qayta urinib ko‘ring.",
    };
  }

  return { code: "pipeline_failed", message: message.slice(0, 400) || "Taqdimotni yaratishda xatolik yuz berdi." };
}
