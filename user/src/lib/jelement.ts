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
};

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
export async function resolveElement(elementId: string, version?: number): Promise<ResolvedElement | null> {
  const { data, error } = await supabase.rpc("jelement_resolve", {
    p_element_id: elementId,
    ...(version === undefined ? {} : { p_version: version }),
  });
  if (error) throw error;

  const payload = data as {
    element?: { canonical_name?: string; render_spec?: { components?: Component[] } };
    family?: { colorTokens?: Record<string, string> };
    version?: number;
  } | null;

  const components = payload?.element?.render_spec?.components;
  if (!components || components.length === 0) return null;

  return {
    elementId,
    version: payload!.version ?? 0,
    name: payload!.element!.canonical_name ?? "",
    components,
    colorTokens: payload!.family?.colorTokens ?? {},
  };
}


export {
  boundsOf, initialPlacement, isElementRow, placementOf, rowsFor,
  type Component, type Placement, type ResolvedElement,
} from "./jelement-rows";
