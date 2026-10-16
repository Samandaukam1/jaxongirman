import type { Json, Tables } from "@jaxongirman/types";
import { useState } from "react";

import { loadFontsUsedBy } from "@/lib/fontCache";
import { supabase } from "@/lib/supabase";

export type Presentation = Tables<"presentations">;
export type Slide = Tables<"slides">;
export type Element = Tables<"slide_elements">;

export type Deck = {
  presentation: Presentation;
  slides: Slide[];
  elements: Element[];
};

function jsonObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json | undefined> : {};
}

/**
 * Pictures as the phone can draw them.
 *
 * Elements store a bucket and a path, never a URL — a URL in the row would
 * expire inside the deck. Each image is signed once per load, in parallel, and
 * the same signing serves the editor, the finished deck and the presenter.
 */
export async function hydrateImageUrls(rows: Element[]): Promise<Element[]> {
  return Promise.all(rows.map(async (element) => {
    if (element.type !== "image") return element;
    const content = jsonObject(element.content);
    // A video keeps its poster tile — handing its URL to <Image> draws nothing.
    if (content.kind === "video") return element;
    const bucket = typeof content.storageBucket === "string" ? content.storageBucket : null;
    const path = typeof content.storagePath === "string" ? content.storagePath : null;
    if (!bucket || !path) return element;
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    return data?.signedUrl ? { ...element, content: { ...content, signedUrl: data.signedUrl } } : element;
  }));
}

/** A whole deck, read in one round of requests, with its pictures signed. */
export async function loadDeck(presentationId: string): Promise<Deck> {
  const [presentationResult, slideResult, elementResult] = await Promise.all([
    supabase.from("presentations").select("*").eq("id", presentationId).single(),
    supabase.from("slides").select("*").eq("presentation_id", presentationId).order("position"),
    supabase.from("slide_elements").select("*").eq("presentation_id", presentationId).order("z_index"),
  ]);
  if (presentationResult.error) throw presentationResult.error;
  if (slideResult.error) throw slideResult.error;
  if (elementResult.error) throw elementResult.error;
  return {
    presentation: presentationResult.data,
    slides: slideResult.data,
    elements: await hydrateImageUrls(elementResult.data),
  };
}

/** Fetches the faces a deck is set in. Resolves when they are registered. */
export function loadDeckFonts(elements: readonly Element[]): Promise<void> {
  return loadFontsUsedBy(elements.map((row) => (row.style && typeof row.style === "object" && !Array.isArray(row.style) ? row.style : {}) as { fontFamily?: unknown }));
}

/**
 * Elements grouped by slide, keeping each slide's array when nothing in it
 * changed.
 *
 * The slide strip draws every slide, and a strip that redraws all thirty
 * thumbnails because one caption moved is the lag people felt. Reusing the
 * previous array whenever its members are the same objects is what lets a
 * memoised thumbnail skip.
 */
export function groupBySlide(elements: readonly Element[], previous: ReadonlyMap<string, Element[]>): Map<string, Element[]> {
  const fresh = new Map<string, Element[]>();
  for (const element of elements) {
    const list = fresh.get(element.slide_id);
    if (list) list.push(element);
    else fresh.set(element.slide_id, [element]);
  }
  const out = new Map<string, Element[]>();
  for (const [slideId, list] of fresh) {
    list.sort((a, b) => a.z_index - b.z_index);
    const old = previous.get(slideId);
    out.set(slideId, old && old.length === list.length && old.every((row, index) => row === list[index]) ? old : list);
  }
  return out;
}

/**
 * `groupBySlide` across renders: each render reuses the arrays of the slides
 * that did not change since the last one.
 *
 * Kept in state, not a ref — the previous grouping is render data, and the
 * "adjust state while rendering" form is the one React allows for it.
 */
export function useSlideGroups(elements: readonly Element[]): Map<string, Element[]> {
  const [state, setState] = useState(() => ({ elements, groups: groupBySlide(elements, new Map()) }));
  if (state.elements === elements) return state.groups;
  const next = { elements, groups: groupBySlide(elements, state.groups) };
  setState(next);
  return next.groups;
}
