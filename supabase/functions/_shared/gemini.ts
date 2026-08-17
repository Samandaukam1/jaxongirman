/**
 * Gemini, for the two stages that are writing rather than rendering.
 *
 * Research and copy are judgement; geometry is arithmetic. This client covers
 * only the first, and deliberately keeps the same shape as `OpenAIClient` —
 * `structured()` and `research()`, same return type — so the pipeline can hold
 * either one and fall back to the other without knowing which it has.
 *
 * The key is read from `GEMINI_API_KEY` and never leaves the server. Nothing in
 * this file is reachable from an app bundle: Edge functions run on Supabase's
 * infrastructure and the mobile client calls them, not Google.
 */

import { toGeminiSchema } from "./gemini-schema.ts";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

type Usage = { input_tokens?: number; output_tokens?: number };

type GeminiPart = { text?: string };
type GeminiCandidate = {
  content?: { parts?: GeminiPart[] };
  groundingMetadata?: {
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
  };
  finishReason?: string;
};
type GeminiResponse = {
  candidates?: GeminiCandidate[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string };
};

/** Raised when Gemini fails in a way the caller should answer by trying OpenAI. */
export class GeminiUnavailable extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "GeminiUnavailable";
  }
}

function textOf(payload: GeminiResponse): string {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new GeminiUnavailable("empty_response", "Gemini returned no text");
  return text;
}

function usageOf(payload: GeminiResponse): Usage {
  return {
    input_tokens: payload.usageMetadata?.promptTokenCount ?? 0,
    output_tokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

/**
 * Every page the grounded search actually cited.
 *
 * Same shape the OpenAI client returns, so the pipeline stores sources without
 * caring which provider found them.
 */
function citationsOf(payload: GeminiResponse): { title: string; url: string }[] {
  const seen = new Map<string, string>();
  for (const chunk of payload.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
    const url = chunk.web?.uri;
    if (!url || seen.has(url)) continue;
    seen.set(url, chunk.web?.title?.trim() || url);
  }
  return [...seen].map(([url, title]) => ({ title, url }));
}

async function post(url: string, body: unknown, attempts = 3): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    last = response;
    if (response.ok || (response.status < 500 && response.status !== 429)) return response;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return last!;
}

export class GeminiClient {
  private readonly key: string;
  readonly researchModel: string;
  readonly writingModel: string;

  constructor() {
    this.key = Deno.env.get("GEMINI_API_KEY") ?? "";
    this.researchModel = Deno.env.get("GEMINI_RESEARCH_MODEL") ?? "gemini-2.5-flash-lite";
    this.writingModel = Deno.env.get("GEMINI_WRITING_MODEL") ?? "gemini-2.5-flash-lite";
  }

  get configured() { return this.key.length > 10; }

  private url(model: string): string {
    return `${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.key)}`;
  }

  /**
   * A structured answer, validated by Gemini against the schema rather than by
   * us against whatever came back.
   *
   * `responseMimeType: application/json` plus a schema is Gemini's own
   * constrained decoding. There is no repair pass here on purpose: parsing
   * around a malformed answer is how a generator ends up shipping a deck built
   * from half-understood JSON.
   */
  async structured<T>(
    prompt: string,
    schemaName: string,
    schema: Record<string, unknown>,
    options: { model?: string; maxOutputTokens?: number; system?: string } = {},
  ): Promise<{ data: T; usage: Usage; requestId: string | null; model: string }> {
    if (!this.configured) throw new GeminiUnavailable("not_configured", "GEMINI_API_KEY is not set");
    const model = options.model ?? this.writingModel;

    const response = await post(this.url(model), {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(schema),
        maxOutputTokens: options.maxOutputTokens ?? 8_000,
        temperature: 0.7,
      },
    });

    const payload = await response.json() as GeminiResponse;
    if (!response.ok) {
      const reason = response.status === 429 ? "rate_limited" : `http_${response.status}`;
      throw new GeminiUnavailable(reason, payload.error?.message ?? `Gemini request failed (${response.status})`);
    }

    const text = textOf(payload);
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      throw new GeminiUnavailable("malformed_json", `Gemini returned unparseable JSON for ${schemaName}`);
    }

    return { data, usage: usageOf(payload), requestId: null, model };
  }

  /**
   * Grounded search, returning notes and the pages actually cited.
   *
   * Search and a strict schema cannot both be asked for in one Gemini call, so
   * this returns prose and the caller structures it — the same split the OpenAI
   * client already makes for the same reason.
   */
  async research(
    prompt: string,
    options: { model?: string; maxOutputTokens?: number; system?: string } = {},
  ): Promise<{ text: string; citations: { title: string; url: string }[]; usage: Usage; requestId: string | null; model: string }> {
    if (!this.configured) throw new GeminiUnavailable("not_configured", "GEMINI_API_KEY is not set");
    const model = options.model ?? this.researchModel;

    const response = await post(this.url(model), {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
      tools: [{ google_search: {} }],
      generationConfig: {
        maxOutputTokens: options.maxOutputTokens ?? 3_000,
        temperature: 0.4,
      },
    });

    const payload = await response.json() as GeminiResponse;
    if (!response.ok) {
      const reason = response.status === 429 ? "rate_limited" : `http_${response.status}`;
      throw new GeminiUnavailable(reason, payload.error?.message ?? `Gemini search failed (${response.status})`);
    }

    return {
      text: textOf(payload),
      citations: citationsOf(payload),
      usage: usageOf(payload),
      requestId: null,
      model,
    };
  }
}
