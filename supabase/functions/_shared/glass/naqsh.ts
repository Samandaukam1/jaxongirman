/**
 * The page behind a national-ornament deck, and the marks it is drawn with.
 *
 * Every page is printed on a faint girih, like a sheet of embossed paper. A
 * content page then carries a band of bodom down its right edge — whole
 * tiles, the family's gradient flowing through them — as wide as the words on
 * the page allow; cards may lie over it, words never touch it. The cover and
 * the closing page lay their own ornament (`compose.ts`), and get only the
 * paper here.
 *
 * The marks are Uzbek ones: the eight-pointed star (two squares, one turned a
 * quarter) for numbers, bullets and labels, and the bodom's leaf — two
 * opposite corners swept wide — for photographs and the closing card.
 */

import { alpha } from "./color.ts";
import { H, intersects, round, W, type Light, type Rect, type Row } from "./backdrop.ts";
import type { DesignDNA } from "./dna.ts";
import { NAQSH_ASSETS, NAQSH_BUCKET, NAQSH_PAPER, naqshPath, type NaqshAsset, type NaqshFamily } from "./naqsh-palette.ts";

function shape(rect: Rect, style: Record<string, unknown>, kind: string, locked: boolean, rotation = 0): Row {
  return {
    type: "shape",
    x: round(rect.x),
    y: round(rect.y),
    width: round(Math.max(1, rect.width)),
    height: round(Math.max(1, rect.height)),
    rotation,
    z_index: 0,
    opacity: 1,
    locked,
    style,
    content: locked ? { kind, decor: true } : { kind },
  };
}

/**
 * One ornament picture, at its own proportions so `objectFit: cover` shows it
 * whole and at the size it was drawn. Placed by its top-left corner, which may
 * lie off the page: a band shows the part of itself the page has room for.
 */
export function ornament(family: NaqshFamily, asset: NaqshAsset, at: { x: number; y: number }, style: Record<string, unknown> = {}, opacity = 1): Row {
  const size = NAQSH_ASSETS[asset];
  return {
    type: "image",
    x: round(at.x),
    y: round(at.y),
    width: round(size.width),
    height: round(size.height),
    rotation: 0,
    z_index: 0,
    opacity,
    locked: true,
    style: { objectFit: "cover", ...style },
    content: { kind: "image", storageBucket: NAQSH_BUCKET, storagePath: naqshPath(family, asset), ornament: asset, decor: true },
  };
}

/** The faint girih the whole page is printed on. */
export function paperRow(): Row {
  return {
    type: "image",
    x: 0,
    y: 0,
    width: NAQSH_PAPER.width,
    height: round(NAQSH_PAPER.height),
    rotation: 0,
    z_index: 0,
    opacity: 0.055,
    locked: true,
    style: { objectFit: "cover" },
    content: { kind: "image", storageBucket: NAQSH_BUCKET, storagePath: NAQSH_PAPER.path, ornament: "paper", decor: true },
  };
}

/** The deck's gradient, deep to bright, light falling from the upper left. */
export function familyFill(dna: DesignDNA, angle = 135): Record<string, unknown> {
  return {
    fill: dna.colors.accent,
    gradientStops: [{ color: dna.colors.accent, offset: 0 }, { color: dna.colors.accent2, offset: 100 }],
    gradientAngle: angle,
  };
}

/**
 * An eight-pointed star: two squares, the second turned 45°, sharing a centre.
 * `diameter` is point to point; the squares are a little rounded, so the star
 * reads as cut tile rather than as a clip-art sparkle.
 */
export function starRows(center: { x: number; y: number }, diameter: number, style: Record<string, unknown>, kind = "star", locked = false): Row[] {
  const side = diameter / Math.SQRT2;
  const box = { x: center.x - side / 2, y: center.y - side / 2, width: side, height: side };
  const corner = round(side * 0.1);
  return [
    shape(box, { ...style, borderRadius: corner }, kind, locked, 0),
    shape(box, { ...style, borderRadius: corner }, kind, locked, 45),
  ];
}

/**
 * Radii for the bodom (almond) frame: two opposite corners swept wide, the
 * other two nearly square — the shape of the ornament's own leaf, set modern.
 * Order is top-left, top-right, bottom-right, bottom-left.
 */
export function leafCorners(width: number, height: number, small = 10): number[] {
  const wide = round(Math.min(width, height) * 0.34);
  return [wide, small, wide, small];
}

/** How wide the band may show on a page, widest first; past 96 it is the wide picture. */
const BAND_WIDTHS = [150, 128, 112, 96, 80, 64] as const;

export function naqshBackdrop(input: {
  dna: DesignDNA;
  family: NaqshFamily;
  next: () => number;
  light: Light;
  /** Words set straight on the page: the band never touches them. */
  words: Rect[];
  keep: Rect[];
  hero: boolean;
}): Row[] {
  const { dna, family } = input;
  const rows: Row[] = [paperRow()];
  if (input.hero) return rows;

  // The band, down the right edge, as wide as the words leave room for. Cards
  // may lie over it; it is the ground they float on.
  for (const visible of BAND_WIDTHS) {
    const shown = { x: W - visible, y: 0, width: visible, height: H };
    if (input.words.some((word) => intersects(shown, word, 18))) continue;
    const asset: NaqshAsset = visible > 96 ? "band-150" : "band-96";
    rows.push(ornament(family, asset, { x: W - visible, y: 0 }));
    // A fine rule of the deck's colour where the band meets the page.
    rows.push(shape({ x: W - visible - 4, y: 0, width: 2, height: H }, { fill: alpha(dna.colors.accent, 0.55) }, "rule", true));
    break;
  }

  // Three small stars stepping down an open corner on the left, clear of everything.
  const spots = [{ x: 30, y: H - 34 }, { x: 30, y: 34 }];
  for (const spot of spots) {
    const cluster = [0, 1, 2].map((step) => ({ x: spot.x, y: spot.y + (spot.y > H / 2 ? -step * 16 : step * 16), size: 9 - step * 2 }));
    const bounds = { x: spot.x - 8, y: Math.min(...cluster.map((one) => one.y)) - 8, width: 16, height: 48 };
    if (input.keep.some((rect) => intersects(bounds, rect, 8))) continue;
    for (const one of cluster) rows.push(...starRows({ x: one.x, y: one.y }, one.size, { fill: alpha(dna.colors.accent, 0.5) }, "star", true));
    break;
  }
  return rows;
}
