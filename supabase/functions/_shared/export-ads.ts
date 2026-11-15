/**
 * Ad pages in a downloaded deck, placed exactly where the screen shows them.
 *
 * A free owner's file carries the same ad pages their presentation does (see
 * presentation-ads.ts): each is a page of its own, the ad's picture laid over
 * the whole canvas on black, so every exporter draws it like any other slide.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js";

import type { ExportDeck, ExportElement, ExportSlide } from "./export-model.ts";
import { deckWithAds, type PresentationAd } from "./presentation-ads.ts";

/** The deck with its owner's ad pages in it; the deck as it was when there are none. */
export function withAdPages(deck: ExportDeck, ads: readonly PresentationAd[]): ExportDeck {
  if (!ads.length) return deck;
  const slides: ExportSlide[] = [];
  const elements: ExportElement[] = [...deck.elements];
  deckWithAds(deck.slides.length, ads).forEach((page, position) => {
    if (page.kind === "slide") {
      slides.push({ ...deck.slides[page.index]!, position });
      return;
    }
    const id = `ad-${page.ad.id}`;
    slides.push({ id, presentation_id: deck.presentation.id, position, title: null, background: { color: "#000000" } });
    elements.push({
      id: `${id}-picture`, slide_id: id, presentation_id: deck.presentation.id, type: "image",
      x: 0, y: 0, width: 1000, height: 562.5, rotation: 0, z_index: 1, opacity: 1,
      style: { objectFit: "contain" },
      content: { kind: "image", storageBucket: "presentation-ads", storagePath: page.ad.path },
    });
  });
  return { ...deck, slides, elements };
}

/** The ad pages a deck's owner is shown, by their plan; none when the lookup fails. */
export async function ownerSlideAds(service: SupabaseClient, ownerId: string): Promise<PresentationAd[]> {
  const { data, error } = await service.rpc("presentation_ads_for", { p_owner: ownerId });
  if (error || !data) return [];
  const slides = (data as { slides?: unknown }).slides;
  return Array.isArray(slides) ? slides as PresentationAd[] : [];
}
