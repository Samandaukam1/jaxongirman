import { GeminiClient } from "./gemini.ts";
import { fallbackReason } from "./gemini-schema.ts";
import type { OpenAIClient } from "./openai.ts";

/**
 * Which model writes, and what happens when it cannot.
 *
 * Gemini Flash-Lite is the primary for research and copy: both are judgement
 * about words, both are called once per deck or once per slide, and the cost
 * difference at that volume is the whole margin on a subscription. OpenAI stays
 * behind it, unchanged, because a generator that stops working when one vendor
 * has a bad afternoon is not a generator anybody can sell.
 *
 * Image generation is not routed here. It still goes to OpenAI, deliberately —
 * nothing about the imagery was the problem this change is solving.
 *
 * A fallback is never silent. Every answer carries which provider produced it
 * and, when the primary was skipped, why — so a month of quietly paying OpenAI
 * prices shows up in the usage table rather than in the invoice.
 */

export type WriterAttribution = {
  provider: "google" | "openai";
  model: string;
  /** Set only when the primary was tried and did not answer. */
  fallbackFrom?: "google";
  fallbackReason?: string;
};

export type WriterUsage = { input_tokens?: number; output_tokens?: number };

export type ResearchAnswer = {
  text: string;
  citations: { title: string; url: string }[];
  usage: WriterUsage;
  requestId: string | null;
} & WriterAttribution;

export type StructuredAnswer<T> = {
  data: T;
  usage: WriterUsage;
  requestId: string | null;
} & WriterAttribution;

export class Writer {
  readonly gemini = new GeminiClient();

  constructor(private readonly openai: OpenAIClient) {}

  /** True when Gemini will actually be tried. Logged, so a silent demotion is visible. */
  get primaryReady() { return this.gemini.configured; }

  async research(input: {
    prompt: string;
    system?: string;
    /** What OpenAI is handed if it takes over: it reads a message list, not a string. */
    openaiInput: unknown[];
    safetyIdentifier: string;
    maxOutputTokens?: number;
  }): Promise<ResearchAnswer> {
    if (this.gemini.configured) {
      try {
        const answer = await this.gemini.research(input.prompt, {
          system: input.system,
          maxOutputTokens: input.maxOutputTokens,
        });
        return { ...answer, provider: "google", model: answer.model };
      } catch (failure) {
        const reason = fallbackReason(failure as { name?: string; reason?: string; message?: string });
        if (reason === null) throw failure;
        const answer = await this.openai.research(input.openaiInput, input.safetyIdentifier);
        return {
          ...answer, provider: "openai", model: this.openai.textModel,
          fallbackFrom: "google", fallbackReason: reason,
        };
      }
    }

    const answer = await this.openai.research(input.openaiInput, input.safetyIdentifier);
    return {
      ...answer, provider: "openai", model: this.openai.textModel,
      fallbackFrom: "google", fallbackReason: "not_configured",
    };
  }

  async structured<T>(input: {
    prompt: string;
    system?: string;
    schemaName: string;
    schema: Record<string, unknown>;
    openaiInput: unknown[];
    safetyIdentifier: string;
    maxOutputTokens?: number;
  }): Promise<StructuredAnswer<T>> {
    if (this.gemini.configured) {
      try {
        const answer = await this.gemini.structured<T>(input.prompt, input.schemaName, input.schema, {
          system: input.system,
          maxOutputTokens: input.maxOutputTokens,
        });
        return { ...answer, provider: "google", model: answer.model };
      } catch (failure) {
        const reason = fallbackReason(failure as { name?: string; reason?: string; message?: string });
        if (reason === null) throw failure;
        const answer = await this.openai.structured<T>(
          input.openaiInput, input.schemaName, input.schema, input.safetyIdentifier,
        );
        return {
          ...answer, provider: "openai", model: this.openai.textModel,
          fallbackFrom: "google", fallbackReason: reason,
        };
      }
    }

    const answer = await this.openai.structured<T>(
      input.openaiInput, input.schemaName, input.schema, input.safetyIdentifier,
    );
    return {
      ...answer, provider: "openai", model: this.openai.textModel,
      fallbackFrom: "google", fallbackReason: "not_configured",
    };
  }
}

/** What goes in `ai_usage.metadata` so a fallback is countable, not anecdotal. */
export function attributionMetadata(answer: WriterAttribution): Record<string, unknown> {
  if (!answer.fallbackFrom) return { primary_provider: answer.provider };
  return {
    primary_provider: answer.fallbackFrom,
    fallback_provider: answer.provider,
    fallback_reason: answer.fallbackReason,
  };
}
