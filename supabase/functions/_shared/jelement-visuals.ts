import type { SupabaseClient } from "npm:@supabase/supabase-js";

import { renderElement, type JElement, type JElementFamily, type PlacedShape } from "./jelement/index.ts";
import type { Archetype, JslaydDocument } from "./jslayd/index.ts";

/**
 * Filling a design's element slots.
 *
 * A design says `sourceStrategy: jelement` on a slot; this finds something to
 * put there. The search runs in the database and returns a shortlist, so the
 * library never travels — a hundred families of a dozen objects each would be
 * most of a megabyte, and it grows.
 *
 * Nothing here calls an image model. That is the point of the whole subsystem:
 * a slot that wants a reusable object gets one retrieved and drawn, and a slide
 * with no suitable element gets nothing rather than a generated picture nobody
 * asked for.
 */

/** What a slot needs filled, and what the slide is about. */
type SlotRequest = {
  slideIndex: number;
  slot: string;
  query: string;
  slideRole: string;
};

type Candidate = {
  id: string;
  canonical_name: string;
  family_slug: string;
  published_version: number;
};

/** Drawn shapes per slide, keyed by slot — the shape `buildJslaydSlides` takes. */
export type SlideElements = Record<string, readonly PlacedShape[]>;

/**
 * Which slots want an element, for each slide.
 *
 * Read from the archetype the slide will actually be laid into, so a design
 * that declares no element slots costs nothing: no query is built, no search
 * runs, and the whole subsystem stays out of the way.
 */
export function elementSlotsFor(
  archetypes: readonly Archetype[],
  slides: readonly { title: string; visualPrompt: string | null; layout: string }[],
): SlotRequest[] {
  const requests: SlotRequest[] = [];

  slides.forEach((slide, slideIndex) => {
    const archetype = archetypes[slideIndex];
    if (!archetype) return;

    for (const element of archetype.elements) {
      if (element.type !== "image" && element.type !== "frame") continue;
      if (element.strategy !== "jelement") continue;

      // What the slide is about, in the words most likely to name an object.
      // The visual prompt was written to describe a picture, so it is the
      // better query when there is one.
      const query = (slide.visualPrompt ?? slide.title).trim();
      if (!query) continue;

      requests.push({ slideIndex, slot: element.slot, query, slideRole: archetype.purpose });
    }
  });

  return requests;
}

/**
 * Finds, resolves and draws an element for every slot that asked for one.
 *
 * One search per slot and one resolve per chosen element. The search answers
 * with a few hundred bytes per candidate; only what is chosen costs a render
 * specification, which is what keeps this affordable as the library grows.
 *
 * A slot with no good candidate is left empty. An element that half-suits a
 * slide is worse than whitespace — it reads as a mistake, and the design was
 * composed to survive an unfilled slot.
 */
export async function fillElementSlots(
  service: SupabaseClient,
  requests: readonly SlotRequest[],
  options: { slideCount: number; presentationId: string; accent?: string | null },
): Promise<{ elements: SlideElements[]; used: number }> {
  const elements: SlideElements[] = Array.from({ length: options.slideCount }, () => ({}));
  if (requests.length === 0) return { elements, used: 0 };

  let used = 0;
  const resolved = new Map<string, { element: JElement; family: JElementFamily; version: number } | null>();

  for (const request of requests) {
    const { data: candidates } = await service.rpc("jelement_search", {
      p_query: request.query,
      p_slide_role: request.slideRole,
      p_limit: 4,
    });

    const shortlist = (candidates ?? []) as Candidate[];
    const best = shortlist[0];
    if (!best) continue;

    if (!resolved.has(best.id)) {
      const { data } = await service.rpc("jelement_resolve", { p_element_id: best.id });
      const payload = data as { element?: Record<string, unknown>; family?: Record<string, unknown>; version?: number } | null;

      // The stored row keeps its geometry under `render_spec`; the drawing code
      // reads a `JElement`, so the two are bridged here rather than by making
      // the renderer know about database column names.
      const geometry = payload?.element?.render_spec as JElement["geometry"] | undefined;
      resolved.set(best.id, geometry
        ? {
            element: { ...(payload!.element as unknown as JElement), geometry },
            family: {
              colorTokens: (payload!.family as { colorTokens?: JElementFamily["colorTokens"] }).colorTokens ?? {},
            } as JElementFamily,
            version: payload!.version ?? best.published_version,
          }
        : null);
    }

    const entry = resolved.get(best.id);
    if (!entry) continue;

    // Drawn in the element's own 0–1 space. The design projects it into the
    // slot, so nothing here needs to know where on the slide it lands.
    const shapes = renderElement(
      entry.element,
      entry.family,
      { x: 0, y: 0, width: 1, height: 1 },
      options.accent ? { accent: options.accent } : {},
    );

    elements[request.slideIndex]![request.slot] = shapes.map((shape) => ({
      x: shape.x, y: shape.y, width: shape.width, height: shape.height,
      rotation: shape.rotation, zIndex: shape.zIndex, opacity: shape.opacity,
      style: shape.style,
    }));
    used += 1;

    // Recorded for ranking. The query travels, the slide's words do not.
    await service.rpc("jelement_record_usage", {
      p_element_id: best.id,
      p_presentation_id: options.presentationId,
      p_query: request.query,
      p_slide_role: request.slideRole,
    });
  }

  return { elements, used };
}

/**
 * Slides whose visual is an element, so no picture is generated for them.
 *
 * Without this the deck pays twice: an image model draws something for a slot
 * that already has an object in it, and the picture is never shown. §33 of the
 * brief is exactly this, and it is the saving that pays for the library.
 */
export function slidesWithElements(document: JslaydDocument, archetypes: readonly Archetype[]): Set<number> {
  void document;
  const covered = new Set<number>();

  archetypes.forEach((archetype, index) => {
    if (!archetype) return;
    const imageSlots = archetype.elements.filter(
      (element) => element.type === "image" || element.type === "frame",
    );
    if (imageSlots.length === 0) return;
    // Only when every visual slot on the slide is an element: a composition
    // with one photograph and one object still needs the photograph.
    if (imageSlots.every((element) => element.strategy === "jelement")) covered.add(index);
  });

  return covered;
}
