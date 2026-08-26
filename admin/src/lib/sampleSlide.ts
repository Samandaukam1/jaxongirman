import type { JslaydDocument, SlideData, SlotOutcome } from "@jaxongirman/jslayd";

import { supabase } from "@/lib/supabase";

/**
 * Asking the server for a real slide.
 *
 * The writing happens there because the model key is a server secret, and the
 * drawing happens here because the console already carries the engine — so
 * trying the same words against six colour families costs one model call, not
 * six. What crosses the wire is content: a `SlideData` and the report of which
 * slots its text actually fitted.
 */

export type SampleReport = {
  archetypeId: string;
  slide: SlideData | null;
  outcomes: SlotOutcome[];
  imageQuery: string | null;
  photo: { url: string; attribution: { creator: string; sourceUrl: string } } | null;
  empty: boolean;
  writer?: { model: string; attempts: number };
};

export async function writeSample(input: {
  designId: string;
  archetypeId: string;
  topic: string;
  language: string;
}): Promise<SampleReport> {
  return call(input) as Promise<SampleReport>;
}

/**
 * Another photograph, same words.
 *
 * Judging a design against a picture nobody chose is half a judgement — the
 * first result for "clean water drops" may be the wrong register entirely, and
 * the design is what is on trial, not the search. This costs a search rather
 * than a model call and leaves the writing exactly as it was.
 */
export async function anotherPhoto(imageQuery: string, photoOffset: number): Promise<SampleReport["photo"]> {
  const answer = await call({ imageQuery, photoOffset }) as { photo: SampleReport["photo"] };
  return answer.photo;
}

async function call(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("sample-slide", { body });
  if (!error) return data;

  /**
   * The function's refusals are answers.
   *
   * A missing model key comes back as 503 with a sentence written for an
   * administrator to read. `functions.invoke` turns any non-2xx into a generic
   * "Edge Function returned a non-2xx status code", which is the one thing that
   * does not help.
   */
  const context = (error as { context?: unknown }).context;
  if (context && typeof (context as Response).json === "function") {
    try {
      const detail = await (context as Response).json();
      if (detail && typeof detail === "object" && "error" in detail) {
        throw new Error(String((detail as { error: unknown }).error));
      }
    } catch (readError) {
      if (readError instanceof Error && readError.message) throw readError;
    }
  }
  throw error;
}

/**
 * A photograph the writer found, bound into the slide's image slots.
 *
 * Done here rather than on the server because the server does not know which
 * slots this blueprint draws — that is the document's business, and the
 * document is already open in this tab.
 */
export function withPhoto(slide: SlideData, document: JslaydDocument, archetypeId: string, url: string | null): SlideData {
  if (!url) return slide;
  const archetype = document.archetypes.find((entry) => entry.id === archetypeId);
  if (!archetype) return slide;

  const images: SlideData["images"] = { ...slide.images };
  for (const element of archetype.elements) {
    if (element.type === "image") images[element.id] = { url };
  }
  return { ...slide, images };
}
