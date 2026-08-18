import type { Tables } from "@jaxongirman/types";

import type { Component, ResolvedElement } from "./jelement-rows";
import { supabase } from "./supabase";

/**
 * Finding a library element from a phone.
 *
 * The drawing half lives in `jelement-rows.ts`, which imports nothing and is
 * tested on its own. This half is the part that talks to the server.
 */

export type ElementRow = Tables<"slide_elements">;

/** What a search returns: enough to choose, nothing to draw. */
export type ElementCandidate = {
  id: string;
  canonical_name: string;
  display_name: string;
  family_name: string;
  family_slug: string;
  published_version: number;
  thumbnail_path: string | null;
  /** The section within its family — kardiologiya, LOR. Empty when unsectioned. */
  subcategory: string | null;
  /** The render, so the picker shows the object rather than a glyph. */
  asset_path: string | null;
};

/** The picker's thumbnail for a candidate, or null when it has no picture. */
export function candidateImage(candidate: ElementCandidate): string | null {
  if (!candidate.asset_path) return null;
  return supabase.storage.from(ASSET_BUCKET).getPublicUrl(candidate.asset_path).data.publicUrl;
}

/* ------------------------------------------------------------- fetching */

export async function searchElements(query: string, slideRole?: string): Promise<ElementCandidate[]> {
  const { data, error } = await supabase.rpc("jelement_search", {
    p_query: query,
    p_slide_role: slideRole ?? undefined,
    p_limit: 12,
  });
  if (error) throw error;
  return (data ?? []) as unknown as ElementCandidate[];
}

/**
 * The full drawing for one element, fetched only once something has chosen it.
 *
 * The two-step is what keeps a library of thousands usable on a phone: a search
 * answers with a few hundred bytes per candidate, and only the chosen one costs
 * a geometry payload.
 */
export async function resolveElement(
  elementId: string,
  version?: number,
  /** The deck's accent, so a picture element arrives already the right colour. */
  accent?: string,
): Promise<ResolvedElement | null> {
  const { data, error } = await supabase.rpc("jelement_resolve", {
    p_element_id: elementId,
    ...(version === undefined ? {} : { p_version: version }),
  });
  if (error) throw error;

  const payload = data as {
    element?: {
      canonical_name?: string;
      render_spec?: { components?: Component[] };
      asset_path?: string | null;
      asset_accent_hue?: number | null;
      asset_variants?: Record<string, string> | null;
    };
    family?: { colorTokens?: Record<string, string> };
    version?: number;
  } | null;

  const element = payload?.element;
  if (!element) return null;

  const components = element.render_spec?.components ?? [];
  const assetPath = pickAsset(element, accent);

  // An element that is neither a picture nor a set of components cannot be
  // drawn, and placing it would leave an empty box on somebody's slide.
  if (!assetPath && components.length === 0) return null;

  return {
    elementId,
    version: payload!.version ?? 0,
    name: element.canonical_name ?? "",
    components,
    colorTokens: payload!.family?.colorTokens ?? {},
    assetUrl: assetPath
      ? supabase.storage.from(ASSET_BUCKET).getPublicUrl(assetPath).data.publicUrl
      : null,
  };
}

const ASSET_BUCKET = "jelement-assets";

/**
 * The file to draw, given the colour this deck is using.
 *
 * The recolours were produced when the sheet was cut up, one per accent a
 * design might ask for, because a phone cannot shift the hue of a PNG and a
 * PPTX certainly cannot. So the choice here is a lookup: the variant nearest
 * what the deck asked for, or the original when it is already close enough.
 */
function pickAsset(
  element: { asset_path?: string | null; asset_accent_hue?: number | null; asset_variants?: Record<string, string> | null },
  accent: string | undefined,
): string | null {
  const master = element.asset_path ?? null;
  if (!master) return null;

  const wanted = accent ? hueOf(accent) : null;
  if (wanted === null) return master;

  const own = element.asset_accent_hue;
  if (typeof own === "number" && Math.abs(((wanted - own + 540) % 360) - 180) <= 20) return master;

  let best: string | null = null;
  let bestGap = 20;
  for (const [hue, path] of Object.entries(element.asset_variants ?? {})) {
    const gap = Math.abs(((wanted - Number(hue) + 540) % 360) - 180);
    if (Number.isFinite(gap) && gap <= bestGap) { bestGap = gap; best = path; }
  }
  return best ?? master;
}

function hueOf(hex: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1]!, 16);
  const r = ((value >> 16) & 255) / 255, g = ((value >> 8) & 255) / 255, b = (value & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return null;
  const span = max - min;
  if (max === r) return ((g - b) / span + (g < b ? 6 : 0)) * 60;
  if (max === g) return ((b - r) / span + 2) * 60;
  return ((r - g) / span + 4) * 60;
}


export {
  boundsOf, initialPlacement, isElementRow, placementOf, rowsFor,
  type Component, type Placement, type ResolvedElement,
} from "./jelement-rows";
