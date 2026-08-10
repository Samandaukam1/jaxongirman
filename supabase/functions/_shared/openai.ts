import { HttpError } from "./http.ts";

type ResponseUsage = { input_tokens?: number; output_tokens?: number };
type Annotation = { type?: string; url?: string; title?: string };
type OpenAIResponse = {
  id?: string;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; annotations?: Annotation[] }> }>;
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

/** Every page the web-search tool actually cited, in the order it used them. */
function urlCitations(response: OpenAIResponse): { title: string; url: string }[] {
  const seen = new Map<string, string>();
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      for (const annotation of content.annotations ?? []) {
        if (annotation.type !== "url_citation" || !annotation.url) continue;
        if (!seen.has(annotation.url)) seen.set(annotation.url, annotation.title?.trim() || annotation.url);
      }
    }
  }
  return [...seen].map(([url, title]) => ({ title, url }));
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
  readonly imageModel: string;

  constructor() {
    this.key = Deno.env.get("OPENAI_API_KEY") ?? "";
    this.textModel = Deno.env.get("OPENAI_TEXT_MODEL") ?? "gpt-5.6-terra";
    this.imageModel = Deno.env.get("OPENAI_IMAGE_MODEL") ?? "gpt-image-1.5";
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

  /**
   * Searches the live web and returns the notes plus the pages actually cited.
   * Kept separate from `structured` because a tool call and a strict schema in
   * one request fight each other; the writing stages consume these notes.
   */
  async research(input: unknown[], safetyIdentifier: string): Promise<{ text: string; citations: { title: string; url: string }[]; usage: ResponseUsage; requestId: string | null }> {
    if (!this.configured) throw new HttpError(503, "OpenAI is not configured", "provider_not_configured");
    const response = await fetchWithRetry("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.textModel,
        input,
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
        max_output_tokens: 12_000,
        store: false,
        safety_identifier: safetyIdentifier,
      }),
    });
    const payload = await response.json() as OpenAIResponse;
    if (!response.ok) throw new Error(payload.error?.message ?? `OpenAI web search failed (${response.status})`);
    return { text: outputText(payload), citations: urlCitations(payload), usage: payload.usage ?? {}, requestId: payload.id ?? null };
  }

  async uploadFile(blob: Blob, filename: string): Promise<string> {
    const form = new FormData();
    form.append("purpose", "user_data");
    form.append("file", blob, filename);
    const response = await fetchWithRetry("https://api.openai.com/v1/files", { method: "POST", headers: this.headers(false), body: form });
    const payload = await response.json() as { id?: string; error?: { message?: string } };
    if (!response.ok || !payload.id) throw new Error(payload.error?.message ?? "OpenAI file upload failed");
    return payload.id;
  }

  async deleteFile(fileId: string): Promise<void> {
    await fetch(`https://api.openai.com/v1/files/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: this.headers(false) });
  }

  async generateImage(prompt: string): Promise<{ bytes: Uint8Array; requestId: string | null }> {
    if (!this.configured) throw new HttpError(503, "OpenAI is not configured", "provider_not_configured");
    const quality = Deno.env.get("OPENAI_IMAGE_QUALITY") ?? "medium";
    const size = Deno.env.get("OPENAI_IMAGE_SIZE") ?? "1536x1024";
    const response = await fetchWithRetry("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: this.imageModel, prompt, quality, size, output_format: "png", background: "opaque", n: 1 }),
    });
    const payload = await response.json() as { data?: Array<{ b64_json?: string }>; error?: { message?: string }; id?: string };
    const encoded = payload.data?.[0]?.b64_json;
    if (!response.ok || !encoded) throw new Error(payload.error?.message ?? `Image generation failed (${response.status})`);
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { bytes, requestId: payload.id ?? null };
  }
}
