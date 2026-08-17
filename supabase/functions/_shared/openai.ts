import { HttpError } from "./http.ts";

/**
 * What is left of OpenAI.
 *
 * Nothing on the presentation path reaches this file any more. Research,
 * outlines, slide copy, rewrites and the slide editor are all written by
 * Gemini, and they were moved because this vendor's balance reaching zero was
 * enough to fail a deck a customer had already paid for — a second provider
 * that can fail is a second way to fail, not a spare.
 *
 * The one caller left is the game generator, which is a different product and
 * was deliberately not disturbed. The web-search and file-upload methods went
 * with the pipeline: they existed only to serve it, and code kept "in case"
 * is code nobody maintains.
 */

type ResponseUsage = { input_tokens?: number; output_tokens?: number };
type OpenAIResponse = {
  id?: string;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: ResponseUsage;
  error?: { message?: string };
};

function outputText(response: OpenAIResponse): string {
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI response did not contain text output");
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url, init);
    last = response;
    if (response.ok || (response.status < 500 && response.status !== 429)) return response;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return last!;
}

export class OpenAIClient {
  private readonly key: string;
  readonly textModel: string;

  constructor() {
    this.key = Deno.env.get("OPENAI_API_KEY") ?? "";
    this.textModel = Deno.env.get("OPENAI_TEXT_MODEL") ?? "gpt-5.6-terra";
  }

  get configured() { return this.key.length > 10; }

  private headers(json = true): HeadersInit {
    return { Authorization: `Bearer ${this.key}`, ...(json ? { "Content-Type": "application/json" } : {}) };
  }

  async structured<T>(input: unknown[], schemaName: string, schema: Record<string, unknown>, safetyIdentifier: string): Promise<{ data: T; usage: ResponseUsage; requestId: string | null }> {
    if (!this.configured) throw new HttpError(503, "OpenAI is not configured", "provider_not_configured");
    const response = await fetchWithRetry("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.textModel,
        input,
        text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
        max_output_tokens: 24_000,
        store: false,
        safety_identifier: safetyIdentifier,
      }),
    });
    const payload = await response.json() as OpenAIResponse;
    if (!response.ok) throw new Error(payload.error?.message ?? `OpenAI request failed (${response.status})`);
    return { data: JSON.parse(outputText(payload)) as T, usage: payload.usage ?? {}, requestId: payload.id ?? null };
  }
}
