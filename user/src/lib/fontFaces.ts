/**
 * The rules about faces that do not need a network, kept where they can be run.
 *
 * `fontLibrary` queries Supabase; these decide which face a request lands on
 * and what a face is called at runtime, and both are worth a test more than
 * they are worth being read carefully once. Same reason `social-auth-core`
 * sits apart from its adapters.
 */

export type FontFace = {
  weight: number;
  italic: boolean;
  styleName: string;
  format: string;
  storagePath: string;
  /** Content hash. The cache key, and how a replaced file invalidates itself. */
  hash: string;
};

export type FontFamily = {
  id: string;
  name: string;
  slug: string;
  category: string;
  variable: boolean;
  featured: boolean;
  faces: FontFace[];
};

/** The same rule the importer and the storage paths use. */
export const slugOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * The face a request resolves to, and the rule when the exact one is missing.
 *
 * A family that offers 400 and 700 asked for 600 gets the 700: the nearest
 * weight, and on a tie the heavier one, because a heading asked to be heavier
 * than the body should not come back lighter. Slant is preferred but not
 * required — a family with no italic gives its upright rather than nothing.
 */
export function faceFor(family: FontFamily, weight: number, italic: boolean): FontFace | null {
  if (family.faces.length === 0) return null;
  const slanted = family.faces.filter((face) => face.italic === italic);
  const pool = slanted.length > 0 ? slanted : family.faces;
  return pool.slice().sort((a, b) => {
    const byDistance = Math.abs(a.weight - weight) - Math.abs(b.weight - weight);
    return byDistance !== 0 ? byDistance : b.weight - a.weight;
  })[0] ?? null;
}

/**
 * The name this face is registered under at runtime.
 *
 * Deterministic, and carrying the slug rather than the display name, so two
 * families whose names differ only by punctuation cannot collide and so the
 * name can be read back to find the family again.
 */
export const faceId = (slug: string, weight: number, italic: boolean): string =>
  `jx_${slug}_${weight}${italic ? "i" : ""}`;

/** The family a registered name came from, or null for a bundled face. */
export function slugOfFaceId(name: string): string | null {
  const match = /^jx_([a-z0-9]+)_\d{3}i?$/.exec(name);
  return match?.[1] ?? null;
}
