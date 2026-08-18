import { supabase } from "@/lib/supabase";

/**
 * The JElement library's data layer, for the parts that are not the compiler.
 *
 * Attaching artwork is a separate act from writing a specification: the
 * document is authored once and the pictures are attached, replaced and re-cut
 * afterwards. Keeping the two apart is why changing one image does not mean
 * re-sending a thousand-line document.
 */

export const ASSET_BUCKET = "jelement-assets";

export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(ASSET_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Stores one image and returns the path it was stored at.
 *
 * The key is `<family>/<element>/<variant>.png`, rebuilt from ids rather than
 * from anything the admin typed, so a re-cut overwrites the file it replaces
 * instead of leaving the old one behind under a slightly different name.
 */
export async function uploadElementAsset(
  familySlug: string,
  elementId: string,
  variant: string,
  file: Blob,
): Promise<string> {
  const path = `${familySlug}/${elementId}/${variant}.png`;
  const { error } = await supabase.storage
    .from(ASSET_BUCKET)
    .upload(path, file, { upsert: true, contentType: "image/png" });
  if (error) throw error;
  return path;
}

export async function attachAsset(input: {
  elementId: string;
  assetPath: string;
  accentHue: number | null;
  variants: Record<string, string>;
  aspectRatio: number;
}): Promise<void> {
  const { error } = await supabase.rpc("admin_set_jelement_asset", {
    p_element_id: input.elementId,
    p_asset_path: input.assetPath,
    p_accent_hue: input.accentHue ?? undefined,
    p_variants: input.variants as never,
    p_aspect_ratio: input.aspectRatio,
  });
  if (error) throw error;
}

/**
 * Every accent colour a deck could actually ask an element for.
 *
 * Read from the published designs rather than chosen, because those are the
 * only colours anything will ever request. Guessing a spread of forty hues
 * instead would mean five hundred files for twelve elements, and the ones a
 * real deck needs might still not be among them.
 *
 * Deduplicated by hue rather than by hex: two designs whose accents differ in
 * the third decimal are one recolour, and storing both would double the work
 * for a difference nobody can see.
 */
export async function deckAccents(): Promise<string[]> {
  const { data, error } = await supabase
    .from("presentation_designs")
    .select("compiled_config")
    .eq("status", "published");
  if (error) throw error;

  const seen = new Map<number, string>();
  for (const row of data ?? []) {
    const families = (row.compiled_config as { colorFamilies?: { colors?: { accent?: unknown } }[] } | null)?.colorFamilies;
    for (const family of families ?? []) {
      const accent = family?.colors?.accent;
      if (typeof accent !== "string" || !/^#[0-9a-f]{6}$/i.test(accent)) continue;
      const bucket = Math.round(hueOf(accent) / 15);
      if (!seen.has(bucket)) seen.set(bucket, accent);
    }
  }
  return [...seen.values()];
}

function hueOf(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 255) / 255, g = ((value >> 8) & 255) / 255, b = (value & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const span = max - min;
  if (max === r) return ((g - b) / span + (g < b ? 6 : 0)) * 60;
  if (max === g) return ((b - r) / span + 2) * 60;
  return ((r - g) / span + 4) * 60;
}
