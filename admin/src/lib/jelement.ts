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
  recolorable?: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc("admin_set_jelement_asset", {
    p_element_id: input.elementId,
    p_asset_path: input.assetPath,
    p_accent_hue: input.accentHue ?? undefined,
    p_variants: input.variants as never,
    p_aspect_ratio: input.aspectRatio,
    p_recolorable: input.recolorable ?? true,
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
      const bucket = Math.round(hueOfFamily(accent) / 15);
      if (!seen.has(bucket)) seen.set(bucket, accent);
    }
  }
  return [...seen.values()];
}

/** A hex colour's hue, or null when it has none to speak of. */
export function hueOf(hex: string): number | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex.trim())) return null;
  const value = parseInt(hex.trim().slice(1), 16);
  const r = ((value >> 16) & 255) / 255, g = ((value >> 8) & 255) / 255, b = (value & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return null;
  const span = max - min;
  if (max === r) return ((g - b) / span + (g < b ? 6 : 0)) * 60;
  if (max === g) return ((b - r) / span + 2) * 60;
  return ((r - g) / span + 4) * 60;
}

function hueOfFamily(hex: string): number {
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

/**
 * Renders the family's accent into every picture it has, and stores the result.
 *
 * A picture recolours by being a different file, so a colour nobody has
 * rendered is a colour that does not exist. The variants made when a sheet is
 * cut cover the accents published designs declare — which is why setting an
 * accent outside that set changed the swatches and nothing else.
 *
 * This closes the gap: whatever accent the family is saved with, the files for
 * it are produced now. Skipped when a matching file already exists, so saving
 * the same palette twice costs nothing.
 */
export async function renderAccent(
  familySlug: string,
  elements: {
    id: string;
    assetPath: string | null;
    accentHue: number | null;
    variants: Record<string, string>;
  }[],
  accent: string,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const wanted = hueOf(accent);
  if (wanted === null) return 0;
  const hue = Math.round(wanted);

  const pending = elements.filter((element) => {
    if (!element.assetPath || element.accentHue === null) return false;
    if (Math.abs(((hue - element.accentHue + 540) % 360) - 180) <= 20) return false;
    return !Object.keys(element.variants).some(
      (existing) => Math.abs(((hue - Number(existing) + 540) % 360) - 180) <= 20,
    );
  });

  let done = 0;
  for (const element of pending) {
    const source = assetUrl(element.assetPath);
    if (!source) continue;

    const pixels = await pixelsFromUrl(source);
    const { recolour } = await import("@jaxongirman/jelement");
    const shifted = recolour(pixels, element.accentHue!, hue);

    const path = await uploadElementAsset(familySlug, element.id, String(hue), await pngOf(shifted));
    await attachAsset({
      elementId: element.id,
      assetPath: element.assetPath!,
      accentHue: element.accentHue,
      variants: { ...element.variants, [String(hue)]: path },
      aspectRatio: pixels.width / pixels.height,
    });

    done += 1;
    onProgress?.(done, pending.length);
  }
  return done;
}

/** Reads a stored PNG back into pixels. The bucket is public, so no signing. */
async function pixelsFromUrl(url: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Rasm o‘qilmadi (${response.status}).`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Brauzer canvas kontekstini bermadi.");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: image.width, height: image.height, data: image.data };
}

async function pngOf(pixels: { width: number; height: number; data: Uint8ClampedArray }): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Brauzer canvas kontekstini bermadi.");
  const image = context.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data);
  context.putImageData(image, 0, 0);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG yaratilmadi."))), "image/png");
  });
}

/**
 * Stores one cut object against one element, in every colour a deck can ask for.
 *
 * Shared by the two places a sheet arrives — attaching pictures to a family
 * that already has names, and creating names and pictures together — because
 * they differ only in what happens before this point. Two copies of the upload
 * loop would be two places to fix the day a variant rule changes.
 */
export type Cutout = { elementId: string; pixels: RasterPixels; recolorable: boolean };
type RasterPixels = { width: number; height: number; data: Uint8ClampedArray };

export async function attachCuts(
  familySlug: string,
  accentHue: number | null,
  cutouts: readonly Cutout[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const { hexToHsl, recolour } = await import("@jaxongirman/jelement");
  const targets = await deckAccents();

  let done = 0;
  for (const cutout of cutouts) {
    const master = await uploadElementAsset(familySlug, cutout.elementId, "master", await pngOf(cutout.pixels));

    const variants: Record<string, string> = {};
    // An object whose colour is its meaning gets no variants at all: they would
    // be files nothing is ever allowed to serve.
    if (accentHue !== null && cutout.recolorable) {
      for (const target of targets) {
        const parsed = hexToHsl(target);
        if (!parsed) continue;
        const hue = Math.round(parsed[0]);
        if (Math.abs(((hue - accentHue + 540) % 360) - 180) <= 20) continue;
        const shifted = recolour(cutout.pixels, accentHue, hue);
        variants[String(hue)] = await uploadElementAsset(
          familySlug, cutout.elementId, String(hue), await pngOf(shifted),
        );
      }
    }

    await attachAsset({
      elementId: cutout.elementId,
      assetPath: master,
      accentHue,
      variants,
      aspectRatio: cutout.pixels.width / cutout.pixels.height,
      recolorable: cutout.recolorable,
    });

    done += 1;
    onProgress?.(done, cutouts.length);
  }
  return done;
}

/** Reads a chosen file into raw pixels, which is the only form the rules take. */
export async function pixelsOf(file: File): Promise<RasterPixels> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Brauzer canvas kontekstini bermadi.");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: image.width, height: image.height, data: image.data };
}

export { pngOf as pngFromPixels };

/** The elements of a family, by canonical name — how a fresh append is matched. */
export async function elementIdsByName(familyId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("jelements")
    .select("id, canonical_name")
    .eq("family_id", familyId);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.canonical_name, row.id]));
}
