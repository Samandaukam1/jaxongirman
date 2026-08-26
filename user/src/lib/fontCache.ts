import * as FileSystem from "expo-file-system/legacy";
import * as Font from "expo-font";

import { faceId, type FontFace } from "@/lib/fontLibrary";
import { supabase } from "@/lib/supabase";

/**
 * Fonts arrive when they are used, and stay.
 *
 * Two thousand families is roughly two gigabytes. Putting them in the app
 * bundle would be absurd; putting them in memory would be worse. So a face is
 * fetched the first time somebody picks it, written to the app's cache
 * directory, and registered with the name `fontLibrary` derives — and every
 * time after that it is read off the disk.
 *
 * **The file name is the content hash.** Not the family and weight: those name
 * a slot, and a slot's contents can change when a font is re-imported. A hash
 * names the bytes, so a replaced face is a different file and a stale one is
 * never served, without a version number anybody has to remember to bump.
 *
 * Nothing here throws for a font that will not load. A missing typeface is a
 * paragraph in the fallback face; an exception is a screen that does not draw.
 */

const BUCKET = "design-fonts";
const DIRECTORY = `${FileSystem.cacheDirectory ?? ""}fonts/`;

/** Registered in this process already — the cheapest possible answer. */
const registered = new Set<string>();
/** In flight, so twenty rows asking for one family make one request. */
const pending = new Map<string, Promise<boolean>>();

async function ensureDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIRECTORY);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIRECTORY, { intermediates: true });
}

async function download(face: FontFace, target: string): Promise<boolean> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(face.storagePath, 300);
  if (error || !data?.signedUrl) return false;
  const result = await FileSystem.downloadAsync(data.signedUrl, target);
  return result.status === 200;
}

/**
 * Make one face usable, and say whether it worked.
 *
 * Returns the registered family name on success so a caller can put it straight
 * into a style, and null when the face could not be had — which the caller
 * should read as "keep using what you were using".
 */
export async function loadFace(slug: string, face: FontFace): Promise<string | null> {
  const name = faceId(slug, face.weight, face.italic);
  if (registered.has(name)) return name;

  const existing = pending.get(name);
  if (existing) return (await existing) ? name : null;

  const attempt = (async () => {
    try {
      await ensureDirectory();
      const target = `${DIRECTORY}${face.hash}.${face.format}`;
      const info = await FileSystem.getInfoAsync(target);
      if (!info.exists && !(await download(face, target))) return false;
      await Font.loadAsync({ [name]: target });
      registered.add(name);
      return true;
    } catch {
      return false;
    } finally {
      pending.delete(name);
    }
  })();

  pending.set(name, attempt);
  return (await attempt) ? name : null;
}

/** Whether a face is already usable, without asking for it. */
export const isLoaded = (slug: string, weight: number, italic: boolean): boolean =>
  registered.has(faceId(slug, weight, italic));

/**
 * What the cache is holding, for a settings screen that offers to empty it.
 *
 * Not called anywhere yet; it exists because a cache with no way to inspect or
 * clear it is a cache that grows until somebody reinstalls the app.
 */
export async function cacheSize(): Promise<number> {
  try {
    const names = await FileSystem.readDirectoryAsync(DIRECTORY);
    const sizes = await Promise.all(names.map(async (name) => {
      const info = await FileSystem.getInfoAsync(`${DIRECTORY}${name}`);
      return info.exists && !info.isDirectory ? info.size ?? 0 : 0;
    }));
    return sizes.reduce((total, size) => total + size, 0);
  } catch {
    return 0;
  }
}

export async function clearCache(): Promise<void> {
  try {
    await FileSystem.deleteAsync(DIRECTORY, { idempotent: true });
  } catch { /* nothing cached, or already gone */ }
  registered.clear();
}

/**
 * Bring back every custom face a deck is already using.
 *
 * A registered face lives for the life of the process, so reopening a deck in a
 * fresh launch finds its text pointing at names nothing has registered — and
 * React Native answers that by drawing the system face, silently. This reads
 * the names out of the elements, asks the shelf for those families once, and
 * registers what it finds.
 *
 * It resolves nothing and repairs nothing: a face that cannot be had leaves the
 * text as it is, which is the same outcome as before but arrived at on purpose.
 */
export async function loadFontsUsedBy(
  styles: readonly { fontFamily?: unknown }[],
): Promise<void> {
  const wanted = new Map<string, { slug: string; weight: number; italic: boolean }>();
  for (const style of styles) {
    const name = typeof style?.fontFamily === "string" ? style.fontFamily : "";
    const parsed = /^jx_([a-z0-9]+)_(\d{3})(i?)$/.exec(name);
    if (!parsed || registered.has(name)) continue;
    wanted.set(name, { slug: parsed[1] ?? "", weight: Number(parsed[2]), italic: parsed[3] === "i" });
  }
  if (wanted.size === 0) return;

  const { faceFor, fontsByName } = await import("@/lib/fontLibrary");
  const families = await fontsByName([...new Set([...wanted.values()].map((entry) => entry.slug))]);
  const bySlug = new Map(families.map((family) => [family.slug, family]));

  await Promise.all([...wanted.values()].map(async (entry) => {
    const family = bySlug.get(entry.slug);
    if (!family) return;
    const face = faceFor(family, entry.weight, entry.italic);
    if (face) await loadFace(family.slug, face);
  }));
}
