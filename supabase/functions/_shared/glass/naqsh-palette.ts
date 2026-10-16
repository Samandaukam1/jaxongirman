/**
 * The national-ornament style's colours and the ornament pictures drawn in them.
 *
 * Both the deck's colours and the pictures under its pages come from here:
 * `supabase/scripts/build-naqsh-tiles.mjs` reads these families to bake each
 * ornament in each family's gradient, and the engine reads them to colour the
 * page the same way. One table, so the two never disagree about a colour.
 *
 * Every family is a gradient from a `deep` ink — dark enough to carry white
 * type — to a `bright` one a step along the colour wheel: lapis to indigo,
 * emerald to turquoise, garnet to saffron. The ornaments are whole tiles of two
 * seamless sources (`supabase/assets/naqsh/`): the bodom (paisley), set in the
 * family's gradient on a pale ground with a white girih lace behind it, and
 * the girih (star lattice) in white over the family's deep gradient — a
 * tilework wall.
 */

export type Rgb = readonly [number, number, number];

export type NaqshFamily = "blue" | "teal" | "green" | "gold" | "orange" | "red" | "pink" | "violet";

export const NAQSH_FAMILIES: Record<NaqshFamily, { hue: number; name: string; deep: Rgb; bright: Rgb }> = {
  blue: { hue: 245, name: "Lojuvard", deep: [26, 62, 128], bright: [94, 70, 168] },
  teal: { hue: 192, name: "Firuza", deep: [14, 92, 104], bright: [22, 128, 124] },
  green: { hue: 150, name: "Zumrad", deep: [24, 92, 66], bright: [22, 120, 128] },
  gold: { hue: 82, name: "Oltin", deep: [124, 82, 14], bright: [160, 112, 28] },
  orange: { hue: 45, name: "Zarg‘aldoq", deep: [156, 62, 22], bright: [180, 104, 28] },
  red: { hue: 18, name: "Anor", deep: [140, 30, 46], bright: [170, 90, 30] },
  pink: { hue: 342, name: "Lola", deep: [140, 32, 82], bright: [190, 80, 104] },
  violet: { hue: 285, name: "Binafsha", deep: [78, 42, 136], bright: [140, 60, 152] },
};

export const NAQSH_FAMILY_KEYS = Object.keys(NAQSH_FAMILIES) as NaqshFamily[];

/** The family whose hue lies nearest round the wheel. */
export function nearestFamily(hue: number): NaqshFamily {
  let best: NaqshFamily = "blue";
  let distance = Infinity;
  for (const family of NAQSH_FAMILY_KEYS) {
    const raw = Math.abs(((hue - NAQSH_FAMILIES[family].hue) % 360 + 360) % 360);
    const around = Math.min(raw, 360 - raw);
    if (around < distance) { distance = around; best = family; }
  }
  return best;
}

export function hex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** A colour carried part of the way to white. */
export function toWhite(rgb: Rgb, share: number): Rgb {
  return rgb.map((channel) => channel + (255 - channel) * share) as unknown as Rgb;
}

/** The pale ground the bodom sits on: each end of the family, nearly white. */
export function paleGround(family: NaqshFamily): [Rgb, Rgb] {
  const { deep, bright } = NAQSH_FAMILIES[family];
  return [toWhite(deep, 0.9), toWhite(bright, 0.86)];
}

/** The tilework wall the girih is laid on: the family a little deeper than its inks. */
export function deepGround(family: NaqshFamily): [Rgb, Rgb] {
  const { deep, bright } = NAQSH_FAMILIES[family];
  return [deep.map((channel) => channel * 0.82) as unknown as Rgb, bright.map((channel) => channel * 0.78) as unknown as Rgb];
}

/**
 * The pictures, by the shape of the row they fill.
 *
 * A row shows its picture with `objectFit: cover`, so each picture is made at
 * exactly its row's proportions — the ornament then lands at the size it was
 * drawn, whole tiles across the narrow side, never stretched or cropped into.
 * `tile` is the size of one repeat in slide units.
 */
export const NAQSH_ASSETS = {
  "band-96": { width: 96, height: 562.5, pattern: "bodom", tile: 96 },
  "band-150": { width: 150, height: 562.5, pattern: "bodom", tile: 150 },
  "panel": { width: 420, height: 562.5, pattern: "bodom", tile: 210 },
  "koshin": { width: 1000, height: 562.5, pattern: "girih", tile: 250 },
} as const;

export type NaqshAsset = keyof typeof NAQSH_ASSETS;

export const NAQSH_BUCKET = "design-assets";

export function naqshPath(family: NaqshFamily, asset: NaqshAsset): string {
  return `naqsh/${family}/${asset}.jpg`;
}

/** The faint girih every page is printed on, in ink over transparency; one for all families. */
export const NAQSH_PAPER = { path: "naqsh/girih-paper.png", width: 1000, height: 562.5, tile: 200 } as const;
