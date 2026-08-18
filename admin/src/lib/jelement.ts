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

/**
 * Removes an element, and the files that were only its.
 *
 * The row goes first and the bucket objects after, from the list the database
 * hands back. That order is deliberate: an object with no row is litter, while a
 * row pointing at a deleted file is an element that renders as a broken image
 * on somebody's slide.
 *
 * A refusal comes back as a sentence naming what is in the way, because "in
 * use" is not something an admin can act on and "«Ochiq kitob» is on a slide"
 * is.
 */
export async function deleteElement(elementId: string): Promise<void> {
  const { data, error } = await supabase.rpc("admin_delete_jelement", { p_element_id: elementId });
  if (error) throw error;
  await removeAssets(data as string[] | null);
}

export async function deleteFamily(familyId: string): Promise<void> {
  const { data, error } = await supabase.rpc("admin_delete_jelement_family", { p_family_id: familyId });
  if (error) throw error;
  await removeAssets(data as string[] | null);
}

/**
 * Best-effort, and deliberately so.
 *
 * The rows are already gone by the time this runs. A storage failure here
 * leaves a few unreferenced files in a bucket, which costs pennies and can be
 * swept later; turning it into an error would tell an admin the deletion failed
 * when the thing they asked to delete is gone.
 */
async function removeAssets(paths: string[] | null): Promise<void> {
  const list = (paths ?? []).filter(Boolean);
  if (list.length === 0) return;
  const { error } = await supabase.storage.from(ASSET_BUCKET).remove(list);
  if (error) console.warn("jelement assets left behind", error.message);
}

/**
 * Adds elements to a family without disturbing what is already there.
 *
 * A separate call from the full save rather than a flag on it: "replace" and
 * "append" are opposite answers to what an unmentioned element means, and the
 * wrong answer archives somebody's twelve objects.
 */
export async function appendManifest(familyId: string, spec: Record<string, unknown>): Promise<number> {
  const { data, error } = await supabase.rpc("admin_append_jelement_family", {
    p_family_id: familyId,
    p_spec: spec as never,
  });
  if (error) throw error;
  return Number(data ?? 0);
}
