import type { Tables } from "@jaxongirman/types";
import * as Font from "expo-font";

import { supabase } from "./supabase";

/**
 * Remote JSLAYD designs, as the style picker needs them.
 *
 * The catalogue is a table read, so a design an admin published five minutes
 * ago appears without a store release (§67). Nothing here compiles or lays out
 * anything: the design's `preview` column already holds the cover archetype
 * rendered by the one engine, so the picker draws it with the canvas the app
 * already has.
 */

export type DesignRow = Tables<"presentation_designs">;
export type DesignFontRow = Tables<"presentation_design_fonts">;

export type RemoteDesign = {
  row: DesignRow;
  fonts: DesignFontRow[];
};

const FONT_BUCKET = "design-fonts";

export function assetUrl(bucket: string, path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * Every published design, with its fonts.
 *
 * Two reads rather than a join: the picker shows designs immediately and the
 * faces load behind them, so a slow font never delays the grid.
 */
export async function loadRemoteDesigns(): Promise<RemoteDesign[]> {
  const [designs, fonts] = await Promise.all([
    supabase
      .from("presentation_designs")
      .select("*")
      .eq("status", "published")
      .order("tier")
      .order("sort_order"),
    supabase.from("presentation_design_fonts").select("*"),
  ]);
  if (designs.error) throw designs.error;
  if (fonts.error) throw fonts.error;

  const byDesign = new Map<string, DesignFontRow[]>();
  for (const font of fonts.data ?? []) {
    const bucket = byDesign.get(font.design_id) ?? [];
    bucket.push(font);
    byDesign.set(font.design_id, bucket);
  }

  // A design whose compiled document is missing is excluded rather than shown
  // and then failing to render. One broken design must never take the picker
  // down with it (§99).
  return (designs.data ?? [])
    .filter((row) => row.compiled_config && (row.compiled_config as { format?: string }).format === "JSLAYD")
    .map((row) => ({ row, fonts: byDesign.get(row.id) ?? [] }));
}

/**
 * Registers a design's faces with the text engine.
 *
 * `expo-font` loads from a URI at runtime, which is what lets a design ship a
 * typeface the app was never built with (§67). Registration is idempotent and
 * remembered here, so scrolling a picker past the same design twenty times
 * downloads nothing twice.
 *
 * A face that fails to load is not an error the user should see: the renderer
 * already carries the design's declared fallback in every text row, so the
 * slide reads correctly in the wrong typeface rather than not at all (§99).
 */
const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();

export function loadDesignFonts(design: RemoteDesign): Promise<void> {
  const pending = design.fonts
    .filter((font) => font.asset_path && !loaded.has(fontFamilyOf(design.row.slug, font.font_id)))
    .map((font) => {
      const family = fontFamilyOf(design.row.slug, font.font_id);
      const existing = loading.get(family);
      if (existing) return existing;

      const url = assetUrl(FONT_BUCKET, font.asset_path);
      if (!url) return Promise.resolve();

      const task = Font.loadAsync({ [family]: url })
        .then(() => { loaded.add(family); })
        .catch((error: unknown) => {
          console.warn("jslayd font failed to load", family, error);
        })
        .finally(() => { loading.delete(family); });
      loading.set(family, task);
      return task;
    });
  return Promise.all(pending).then(() => undefined);
}

/**
 * The family name the compiler namespaced this face under.
 *
 * It has to match `FontDeclaration.family` exactly, because that is the string
 * the rendered rows carry in `fontFamily`. The rule is one line in both places
 * and is the whole contract between them.
 */
export function fontFamilyOf(slug: string, fontId: string): string {
  return `jslayd_${slug.replace(/-/g, "_")}_${fontId}`;
}

export type ColorFamilyOption = { code: string; name: string };

/**
 * The colour families a design offers (§29).
 *
 * A migrated design carries every family the blueprint it came from could wear,
 * so the picker keeps working exactly as it did. A hand-written design that
 * declared one family simply offers one, and the picker hides itself.
 */
export function familiesOf(design: DesignRow): ColorFamilyOption[] {
  const document = design.compiled_config as { colorFamilies?: { code?: unknown; name?: unknown }[] } | null;
  const families = Array.isArray(document?.colorFamilies) ? document.colorFamilies : [];
  return families
    .filter((family): family is { code: string; name: string } => typeof family?.code === "string" && typeof family?.name === "string")
    .map((family) => ({ code: family.code, name: family.name }));
}

/**
 * The preview payload the catalogue stored, in the shape the canvas draws.
 *
 * The stored preview is rendered in the design's default family. Recolouring it
 * for another family would mean re-running the engine on a phone, so the picker
 * shows the design's own colours and the family swatch beside it — which is
 * also what §29 asks for: the thumbnail's artwork stays as the design made it,
 * and only the surrounding accents follow the choice.
 */
export function previewToCanvas(design: DesignRow) {
  const preview = (design.preview ?? {}) as { background?: Record<string, unknown>; elements?: Record<string, unknown>[] };
  const slide = {
    id: `design-${design.id}`,
    presentation_id: `design-${design.id}`,
    owner_id: `design-${design.id}`,
    position: 0,
    title: null,
    layout: "cover",
    background: preview.background ?? { color: "#FFFFFF" },
    speaker_notes: null,
    quality_score: null,
    quality_report: {},
    version: 1,
    created_at: "",
    updated_at: "",
  } as unknown as Tables<"slides">;

  const elements = (preview.elements ?? []).map((element, index) => ({
    ...element,
    id: `design-${design.id}-${index}`,
    slide_id: slide.id,
    presentation_id: slide.presentation_id,
    owner_id: slide.owner_id,
    created_at: "",
    updated_at: "",
  })) as unknown as Tables<"slide_elements">[];

  return { slide, elements };
}
