/**
 * The generative engine, wired to the things a real deck needs.
 *
 * `scene-pipeline` decides what a deck looks like and knows nothing about
 * Supabase, Gemini or the image service. This is the seam: it builds those
 * three dependencies out of what a generation already has, and turns what
 * comes back into the rows the apps read.
 *
 * One conversion, in one place. It was written twice — once for the admin
 * preview and once here — which is exactly how a preview stops predicting what
 * a customer's deck will look like.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js";

import { generateDeck, GenerativeFailure, type Deps } from "./scene-pipeline.ts";
import { deckToRows, type ElementRow, type SlideRow } from "./scene-rows.ts";
import type { LibraryFamily } from "./scene-dna.ts";

export type ComposedDeck = {
  deck: GeneratedDeck;
  slideRows: SlideRow[];
  elementRows: ElementRow[];
};

type Writer = {
  structured<T>(input: {
    prompt: string;
    system?: string;
    schemaName: string;
    schema: Record<string, unknown>;
    maxOutputTokens?: number;
    attempts?: number;
  }): Promise<{ data: T; usage: { input_tokens?: number; output_tokens?: number }; provider: string; model: string; attempts: number }>;
};

/** Whether the operator has the generative engine switched on. */
export async function generativeEnabled(service: SupabaseClient): Promise<boolean> {
  const { data } = await service.from("app_settings").select("value").eq("key", "design.generative_enabled").maybeSingle();
  return data?.value === true;
}

/** Whether pre-assigned JSLAYD designs and PPTX templates are held back. */
export async function legacyRestricted(service: SupabaseClient): Promise<boolean> {
  const { data } = await service.from("app_settings").select("value").eq("key", "design.legacy_restricted").maybeSingle();
  return data?.value === true;
}

/**
 * The three things the engine cannot know on its own.
 *
 * The font library, because a face nobody enabled is a face no deck may be set
 * in. The image service, because everything about which picture answers an
 * intent — the person rule, the verified library, the provider ladder, the
 * attribution — belongs to the service that already decides it. And the model.
 */
export function dependencies(input: {
  service: SupabaseClient;
  writer: Writer;
  ownerId: string;
  presentationId: string;
  onUsage?: (usage: { input_tokens?: number; output_tokens?: number }, model: string) => void;
  beat?: (note: string) => void;
}): Deps {
  return {
    ask: async ({ prompt, schema, schemaName, maxOutputTokens }) => {
      try {
        const answer = await input.writer.structured<unknown>({
          prompt,
          system: "Siz professional taqdimot dizaynerisiz. Faqat so‘ralgan sxemada javob bering.",
          schemaName,
          schema,
          maxOutputTokens: maxOutputTokens ?? 2_000,
          attempts: 1,
        });
        input.onUsage?.(answer.usage, answer.model);
        return answer.data;
      } catch (failure) {
        // Which question was refused. A provider that answers
        // "INVALID_ARGUMENT" and names nothing is otherwise three schemas to
        // guess between.
        throw new Error(`${schemaName}: ${failure instanceof Error ? failure.message : String(failure)}`);
      }
    },

    fonts: async (): Promise<LibraryFamily[]> => {
      const { data, error } = await input.service
        .from("font_families")
        .select("canonical_name,category")
        .eq("is_active", true)
        .order("is_featured", { ascending: false })
        .limit(400);
      if (error) throw new GenerativeFailure(error.message, "font_library_unreadable");
      return (data ?? []).map((row) => ({
        name: row.canonical_name as string,
        category: (row.category as string | null) ?? null,
      }));
    },

    findImage: async (intent) => {
      const url = Deno.env.get("SUPABASE_URL");
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !key) return null;
      const answer = await input.service.functions.invoke("image-resolution-service", {
        headers: { Authorization: `Bearer ${key}` },
        body: {
          action: "resolve",
          ownerId: input.ownerId,
          presentationId: input.presentationId,
          query: intent.query,
          orientation: intent.orientation,
        },
      });
      const found = answer.data as { status?: string; bucket?: string; path?: string } | null;
      return found?.status === "selected" && found.path
        ? { bucket: found.bucket ?? "stock-images", path: found.path }
        : null;
    },

    beat: input.beat,
  };
}

export async function composeGenerativeDeck(input: {
  service: SupabaseClient;
  writer: Writer;
  ownerId: string;
  presentationId: string;
  topic: string;
  language?: string;
  /** Whose deck it is, for the cover's own lines. */
  author?: string | null;
  teacher?: string | null;
  slides: Array<{ title: string; research?: string | null; kind?: "cover" | "content" | "closing" }>;
  onUsage?: (usage: { input_tokens?: number; output_tokens?: number }, model: string) => void;
  beat?: (note: string) => void;
}): Promise<ComposedDeck> {
  /**
   * Every field forwarded, by name.
   *
   * Listing three of them dropped the author, the teacher and which page was
   * the cover — passed in by the caller, accepted by no type, and silently
   * gone. Edge functions are not typechecked by `verify`, so this seam has to
   * be written so there is nothing to forget.
   */
  const deck = await generateDeck(dependencies(input), {
    topic: input.topic,
    language: input.language,
    author: input.author ?? null,
    teacher: input.teacher ?? null,
    slides: input.slides,
  });
  const { slideRows, elementRows } = deckToRows(deck, {
    ownerId: input.ownerId,
    presentationId: input.presentationId,
    newId: () => crypto.randomUUID(),
  });
  return { deck, slideRows, elementRows };
}
