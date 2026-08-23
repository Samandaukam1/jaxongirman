import { number, object, string, type JsonObject } from "./export-model.ts";

/**
 * Which face a text row actually wants, and where to fetch it.
 *
 * Both exporters used to answer this from one hard-coded pair, which meant
 * every deck exported in Manrope regardless of what its design said. §78 asks
 * for the opposite: never substitute silently. So a row now names three things
 * — the face it is drawn in, the bundled face its design chose as fallback, and
 * the object key of a custom file when one exists — and each exporter takes as
 * much of that as its format can carry.
 */

/**
 * The one host global this module needs, declared at module scope so the file
 * type-checks in the Node-side build as well as under Deno. Module-scoped
 * `declare` shadows rather than augments, so no consumer sees a conflict.
 */
declare const Deno: { env: { get(name: string): string | undefined } };

export const FONT_BUCKET = "design-fonts";

/**
 * The bundled faces, by the family name the renderers use.
 *
 * These are the same files the apps ship, fetched from the same package
 * versions, so an exported PDF is set in the face the reader saw on screen
 * rather than a lookalike.
 */
/**
 * Pinned to the versions `user/package.json` installs, so a PDF is set in the
 * same outlines the reader saw on screen rather than whatever unpkg serves
 * today. `supabase/tests/font-versions.test.mjs` fails if the two drift.
 */
const BUNDLED: Record<string, string> = {
  Manrope_400Regular: "https://unpkg.com/@expo-google-fonts/manrope@0.4.2/400Regular/Manrope_400Regular.ttf",
  Manrope_500Medium: "https://unpkg.com/@expo-google-fonts/manrope@0.4.2/500Medium/Manrope_500Medium.ttf",
  Manrope_600SemiBold: "https://unpkg.com/@expo-google-fonts/manrope@0.4.2/600SemiBold/Manrope_600SemiBold.ttf",
  Manrope_700Bold: "https://unpkg.com/@expo-google-fonts/manrope@0.4.2/700Bold/Manrope_700Bold.ttf",
  LeagueSpartan_700Bold: "https://unpkg.com/@expo-google-fonts/league-spartan@0.4.2/700Bold/LeagueSpartan_700Bold.ttf",
  LeagueSpartan_800ExtraBold: "https://unpkg.com/@expo-google-fonts/league-spartan@0.4.2/800ExtraBold/LeagueSpartan_800ExtraBold.ttf",
  /**
   * Times New Roman, in the only way we may ship it.
   *
   * The real face is Microsoft's and is not ours to distribute. Tinos is
   * metric-compatible with it — the same advance widths, so a line breaks in
   * the same place — and is licensed to redistribute. A Word document still
   * *names* Times New Roman, because the machine opening it almost certainly
   * has the genuine article; a PDF embeds Tinos, because a PDF carries its own
   * type and has to carry something.
   */
  Tinos_400Regular: "https://unpkg.com/@expo-google-fonts/tinos@0.4.2/400Regular/Tinos_400Regular.ttf",
  Tinos_700Bold: "https://unpkg.com/@expo-google-fonts/tinos@0.4.2/700Bold/Tinos_700Bold.ttf",
  Arimo_400Regular: "https://unpkg.com/@expo-google-fonts/arimo@0.4.3/400Regular/Arimo_400Regular.ttf",
  Arimo_700Bold: "https://unpkg.com/@expo-google-fonts/arimo@0.4.3/700Bold/Arimo_700Bold.ttf",
  PinyonScript_400Regular: "https://unpkg.com/@expo-google-fonts/pinyon-script@0.4.1/400Regular/PinyonScript_400Regular.ttf",
  Inter_400Regular: "https://unpkg.com/@expo-google-fonts/inter@0.4.2/400Regular/Inter_400Regular.ttf",
  Inter_900Black: "https://unpkg.com/@expo-google-fonts/inter@0.4.2/900Black/Inter_900Black.ttf",
  CaveatBrush_400Regular: "https://unpkg.com/@expo-google-fonts/caveat-brush@0.4.1/400Regular/CaveatBrush_400Regular.ttf",
};

export const DEFAULT_FACE = "Manrope_400Regular";

/** The serif an academic document is required to be set in. */
export const SERIF_FACE = "Tinos_400Regular";
export const SERIF_BOLD_FACE = "Tinos_700Bold";
export const DEFAULT_BOLD_FACE = "Manrope_700Bold";

/** The PowerPoint display name for a bundled family file name. */
const DISPLAY_NAME: { prefix: string; name: string }[] = [
  { prefix: "LeagueSpartan", name: "League Spartan" },
  { prefix: "PinyonScript", name: "Pinyon Script" },
  { prefix: "CaveatBrush", name: "Caveat Brush" },
  { prefix: "Manrope", name: "Manrope" },
  { prefix: "Arimo", name: "Arimo" },
  { prefix: "Inter", name: "Inter" },
];

export type FaceRequest = {
  /** Stable cache key: the custom object key, or the bundled family name. */
  key: string;
  /** Where to fetch it, or null when the name is not one we can resolve. */
  url: string | null;
  /** The bundled family the design nominated, used when the custom one fails. */
  fallback: string;
};

/**
 * A public Storage URL for a design's font object.
 *
 * The bucket is public by design — a font is catalogue artwork, and a web
 * `@font-face` cannot chase an expiring signed URL — so this needs no key.
 */
export function designFontUrl(assetPath: string): string | null {
  const base = Deno.env.get("SUPABASE_URL");
  if (!base) return null;
  if (/[\\]|\.\./.test(assetPath)) return null;
  const encoded = assetPath.split("/").map(encodeURIComponent).join("/");
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${FONT_BUCKET}/${encoded}`;
}

/** What face this text row is drawn in, and where to get it. */
export function faceRequest(style: JsonObject): FaceRequest {
  const bag = object(style);
  const fallback = BUNDLED[string(bag.fontFallback)] ? string(bag.fontFallback) : nearestBundled(bag);
  const asset = string(bag.fontAsset);
  if (asset) {
    const url = designFontUrl(asset);
    if (url) return { key: `asset:${asset}`, url, fallback };
  }
  const family = string(bag.fontFamily, fallback);
  return { key: family, url: BUNDLED[family] ?? BUNDLED[fallback] ?? null, fallback };
}

export function bundledUrl(family: string): string | null {
  return BUNDLED[family] ?? null;
}

/**
 * The bundled face a row would use if it named nothing usable — chosen by
 * weight so a 700 row does not export in a regular cut.
 */
function nearestBundled(style: JsonObject): string {
  const family = string(style.fontFamily);
  if (BUNDLED[family]) return family;
  const weight = number(style.fontWeight, 400);
  return weight >= 600 ? DEFAULT_BOLD_FACE : DEFAULT_FACE;
}

/**
 * The face name to write into a PPTX run.
 *
 * PowerPoint resolves fonts by name on the opener's machine and pptxgenjs
 * cannot embed one, so a design's custom file has nowhere to go here. What it
 * can do is name the fallback the *design* nominated rather than a default the
 * exporter invented — which is the difference between a documented substitution
 * and a silent one (§78).
 */
export function pptxFace(style: unknown): string {
  const bag = object(style);
  const nominated = string(bag.fontFallback) || string(bag.fontFamily);
  for (const entry of DISPLAY_NAME) {
    if (nominated.startsWith(entry.prefix)) return entry.name;
  }
  // A custom family reaching here means the design declared no bundled
  // fallback, which the compiler does not allow — so this is the last resort
  // rather than the usual path.
  return "Manrope";
}
