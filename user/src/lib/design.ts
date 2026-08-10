import type { Tables } from "@jaxongirman/types";

import { supabase } from "./supabase";

export type SlideTemplateRow = Tables<"slide_templates">;
export type PaletteFamilyRow = Tables<"palette_families">;

/** Every style key a template preview may colour, plus the chart series list. */
export type PaletteTokens = Record<string, string> & { chartSeries?: string[] };

export type PreviewPayload = {
  background: string;
  elements: Record<string, unknown>[];
};

const COLOR_KEYS = /^(color|fill|gradientTo|stroke|trackColor|labelColor)$/;

function tokensOf(family: PaletteFamilyRow): PaletteTokens {
  return (family.tokens ?? {}) as PaletteTokens;
}

/**
 * Template previews are stored with palette *role* names instead of hex, so one
 * stored payload renders in all six families. This swaps roles for real colours.
 */
export function resolvePreview(template: SlideTemplateRow, family: PaletteFamilyRow): PreviewPayload {
  const tokens = tokensOf(family);
  const hex = (role: unknown) => (typeof role === "string" && tokens[role] ? tokens[role]! : typeof role === "string" ? role : "#000000");
  const raw = (template.preview ?? {}) as Partial<PreviewPayload>;

  const elements = (raw.elements ?? []).map((element) => {
    const style = { ...((element.style ?? {}) as Record<string, unknown>) };
    for (const [key, value] of Object.entries(style)) {
      if (COLOR_KEYS.test(key)) style[key] = hex(value);
    }
    if (Array.isArray(style.series)) style.series = tokens.chartSeries ?? style.series.map(hex);
    return { ...element, style };
  });

  return { background: hex(raw.background ?? "background"), elements };
}

/** Shapes a preview payload into the rows SlideCanvas already knows how to draw. */
export function previewToCanvas(preview: PreviewPayload, key: string) {
  const slide = {
    id: `preview-${key}`,
    presentation_id: `preview-${key}`,
    owner_id: `preview-${key}`,
    position: 0,
    title: null,
    layout: "cover",
    background: { color: preview.background },
    speaker_notes: null,
    quality_score: null,
    quality_report: {},
    version: 1,
    created_at: "",
    updated_at: "",
  } as unknown as Tables<"slides">;

  const elements = preview.elements.map((element, index) => ({
    ...element,
    id: `preview-${key}-${index}`,
    slide_id: slide.id,
    presentation_id: slide.presentation_id,
    owner_id: slide.owner_id,
    created_at: "",
    updated_at: "",
  })) as unknown as Tables<"slide_elements">[];

  return { slide, elements };
}

export async function loadDesignCatalogue(): Promise<{ templates: SlideTemplateRow[]; palettes: PaletteFamilyRow[] }> {
  const [templateResult, paletteResult] = await Promise.all([
    supabase.from("slide_templates").select("*").eq("is_active", true).order("style").order("sort_order"),
    supabase.from("palette_families").select("*").eq("is_active", true).order("sort_order"),
  ]);
  if (templateResult.error) throw templateResult.error;
  if (paletteResult.error) throw paletteResult.error;
  return { templates: templateResult.data, palettes: paletteResult.data };
}
