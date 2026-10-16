/**
 * Mozaika: the geometric deck.
 *
 * Its ornament is a mosaic in the Bauhaus manner — a grid of square cells,
 * each a flat colour or the page, holding one bold figure of another colour:
 * a quarter disc, a half disc, a disc, a ring, a leaf, an arch, a drop,
 * stripes, four dots, a square, a burst of rays, a bow of two quarters. Nothing
 * is drawn in advance: every cell's figure, turn and colours are chosen here
 * from the deck's seed, so no two decks — and no two pages — share a mosaic.
 *
 * A hero page (the cover, a statement, a quotation, the close) is a field of
 * the family's colour with a block of mosaic beside its words; the cover's
 * photograph sits in the mosaic, cut to a disc. Every other page is white with
 * a single column of cells down one edge, as narrow as it must be to clear
 * everything on the page.
 *
 * Every figure is a plain shape — a rectangle with some corners swept to a
 * full quarter circle, or an ellipse — so the phone, the web viewer, the PDF
 * and the PowerPoint file all draw it exactly.
 */

import { H, intersects, round, W, type Rect, type Row } from "./backdrop.ts";
import type { DesignDNA } from "./dna.ts";
import type { NaqshFamily } from "./naqsh-palette.ts";

const PINK = "#F2447C";
const ORANGE = "#FF7A1F";
const YELLOW = "#FFC21F";
const TEAL = "#13B5A6";
const GREEN = "#22B45A";
const BLUE = "#2F6DF6";
const VIOLET = "#8B5CF6";
const RED = "#EF3E36";
const SKY = "#38B6E8";
const WHITE = "#FFFFFF";

/**
 * By family: `hero` is the field of a hero page (white type on it at 4.5:1);
 * `lead` the colour small words take on the white page; `tiles` the mosaic's
 * colours on white and `heroTiles` on the field — bright, there to be seen,
 * not read; `spectrum` the darker twins figures and icon discs are set in,
 * each 4.5:1 against white both ways.
 */
export const MOZAIKA_FAMILIES: Record<NaqshFamily, {
  hero: string;
  lead: string;
  tiles: string[];
  heroTiles: string[];
  spectrum: [string, string, string, string, string];
}> = {
  blue: { hero: "#14206B", lead: "#2563EB", tiles: [BLUE, PINK, ORANGE, YELLOW, TEAL, "#14206B"], heroTiles: [PINK, ORANGE, YELLOW, TEAL, SKY, WHITE], spectrum: ["#2563EB", "#DB2777", "#C2410C", "#0F766E", "#15803D"] },
  teal: { hero: "#0B4D5A", lead: "#0F766E", tiles: [TEAL, YELLOW, ORANGE, PINK, "#0B4D5A", SKY], heroTiles: [TEAL, YELLOW, ORANGE, PINK, SKY, WHITE], spectrum: ["#0F766E", "#C2410C", "#DB2777", "#1E3A8A", "#A16207"] },
  green: { hero: "#0E5A3A", lead: "#15803D", tiles: [GREEN, YELLOW, ORANGE, BLUE, PINK, "#0E5A3A"], heroTiles: [GREEN, YELLOW, ORANGE, SKY, PINK, WHITE], spectrum: ["#15803D", "#2563EB", "#C2410C", "#DB2777", "#A16207"] },
  gold: { hero: "#17151F", lead: "#A16207", tiles: [YELLOW, ORANGE, GREEN, BLUE, VIOLET, PINK], heroTiles: [YELLOW, ORANGE, GREEN, BLUE, VIOLET, PINK], spectrum: ["#A16207", "#C2410C", "#15803D", "#2563EB", "#7C3AED"] },
  orange: { hero: "#C2410C", lead: "#C2410C", tiles: [ORANGE, YELLOW, TEAL, VIOLET, BLUE, PINK], heroTiles: [YELLOW, TEAL, VIOLET, BLUE, PINK, WHITE], spectrum: ["#C2410C", "#0F766E", "#7C3AED", "#2563EB", "#DB2777"] },
  red: { hero: "#C81E2B", lead: "#DC2626", tiles: [RED, VIOLET, BLUE, ORANGE, YELLOW, GREEN], heroTiles: [VIOLET, BLUE, ORANGE, YELLOW, GREEN, WHITE], spectrum: ["#DC2626", "#7C3AED", "#2563EB", "#C2410C", "#15803D"] },
  pink: { hero: "#B0175F", lead: "#DB2777", tiles: [PINK, YELLOW, ORANGE, TEAL, VIOLET, BLUE], heroTiles: [YELLOW, ORANGE, TEAL, VIOLET, SKY, WHITE], spectrum: ["#DB2777", "#C2410C", "#7C3AED", "#0F766E", "#2563EB"] },
  violet: { hero: "#3A1A8F", lead: "#7C3AED", tiles: [VIOLET, PINK, YELLOW, ORANGE, TEAL, GREEN], heroTiles: [PINK, YELLOW, ORANGE, TEAL, GREEN, WHITE], spectrum: ["#7C3AED", "#DB2777", "#C2410C", "#0F766E", "#15803D"] },
};

function shape(rect: Rect, style: Record<string, unknown>, rotation = 0): Row {
  return {
    type: "shape",
    x: round(rect.x),
    y: round(rect.y),
    width: round(Math.max(1, rect.width)),
    height: round(Math.max(1, rect.height)),
    rotation,
    z_index: 0,
    opacity: 1,
    locked: true,
    style,
    content: { kind: "tile", decor: true },
  };
}

/** A rectangle with some corners swept round; `borderRadius` is what an older renderer draws instead. */
const swept = (fill: string, corners: number[]) => ({ fill, borderRadius: 0, borderRadiusCorners: corners.map(round) });

type Motif = "quarter" | "half" | "circle" | "ring" | "leaf" | "arch" | "drop" | "stripes" | "dots" | "square" | "burst" | "bow";

const MOTIFS: [Motif, number][] = [
  ["quarter", 3], ["half", 2], ["circle", 1.5], ["ring", 1.4], ["leaf", 1.4], ["arch", 1.4],
  ["drop", 1], ["bow", 0.9], ["stripes", 0.8], ["square", 0.7], ["dots", 0.6], ["burst", 0.5],
];

function pickMotif(next: () => number): Motif {
  let roll = next() * MOTIFS.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [motif, weight] of MOTIFS) {
    roll -= weight;
    if (roll <= 0) return motif;
  }
  return "quarter";
}

/**
 * One cell: its ground (`bg`, or nothing — the page shows), then its figure
 * in `fg`, with `fg2` for the figures that have a second part. `turn` (0–3)
 * is which corner or edge the figure faces, top-left first, clockwise. A
 * hole cut in a figure is filled with what lies under the cell, `under`.
 */
export function cellRows(at: { x: number; y: number }, s: number, motif: Motif, turn: number, colors: { bg: string | null; under: string; fg: string; fg2: string }): Row[] {
  const { x, y } = at;
  const { fg, fg2 } = colors;
  const under = colors.bg ?? colors.under;
  const t = ((turn % 4) + 4) % 4;
  const rows: Row[] = [];
  if (colors.bg) rows.push(shape({ x, y, width: s, height: s }, { fill: colors.bg }));
  const inset = (share: number): Rect => ({ x: x + s * share, y: y + s * share, width: s * (1 - share * 2), height: s * (1 - share * 2) });
  const corners = (values: [number, number, number, number]) => values;
  switch (motif) {
    case "quarter": {
      const c = corners([0, 0, 0, 0]);
      c[t] = s;
      rows.push(shape({ x, y, width: s, height: s }, swept(fg, c)));
      break;
    }
    case "half": {
      // A half disc, its flat side on the cell's edge; often its twin turned
      // the other way, in the second colour, to make a parted circle.
      const r = s / 2;
      const domes: [Rect, [number, number, number, number]][] = [
        [{ x, y: y + r, width: s, height: r }, [r, r, 0, 0]],
        [{ x, y, width: r, height: s }, [0, r, r, 0]],
        [{ x, y, width: s, height: r }, [0, 0, r, r]],
        [{ x: x + r, y, width: r, height: s }, [r, 0, 0, r]],
      ];
      const [rect, c] = domes[t]!;
      rows.push(shape(rect, swept(fg, c)));
      if ((turn >> 2) % 2 === 1) {
        const [twin, d] = domes[(t + 2) % 4]!;
        rows.push(shape(twin, swept(fg2, d)));
      }
      break;
    }
    case "circle":
      rows.push(shape(inset(0.08), { shape: "ellipse", fill: fg }));
      break;
    case "ring":
      rows.push(shape(inset(0.08), { shape: "ellipse", fill: fg }));
      rows.push(shape(inset(0.29), { shape: "ellipse", fill: under }));
      if (t % 2) rows.push(shape(inset(0.4), { shape: "ellipse", fill: fg2 }));
      break;
    case "leaf":
      rows.push(shape({ x, y, width: s, height: s }, swept(fg, t % 2 ? [0, s, 0, s] : [s, 0, s, 0])));
      break;
    case "arch": {
      const c = corners([0, 0, 0, 0]);
      c[t] = s / 2;
      c[(t + 1) % 4] = s / 2;
      rows.push(shape({ x, y, width: s, height: s }, swept(fg, c)));
      break;
    }
    case "drop": {
      const c = corners([s / 2, s / 2, s / 2, s / 2]);
      c[t] = 0;
      rows.push(shape(inset(0.06), swept(fg, c.map((value) => value * 0.88) as [number, number, number, number])));
      break;
    }
    case "bow": {
      // Two quarter discs meeting at the centre, like a bow.
      const r = s / 2;
      if (t % 2 === 0) {
        rows.push(shape({ x, y, width: r, height: r }, swept(fg, [r, 0, 0, 0])));
        rows.push(shape({ x: x + r, y: y + r, width: r, height: r }, swept(fg2, [0, 0, r, 0])));
      } else {
        rows.push(shape({ x: x + r, y, width: r, height: r }, swept(fg, [0, r, 0, 0])));
        rows.push(shape({ x, y: y + r, width: r, height: r }, swept(fg2, [0, 0, 0, r])));
      }
      break;
    }
    case "stripes": {
      const count = 5;
      const thick = s * 0.075;
      const span = s * 0.72;
      const step = (span - thick) / (count - 1);
      for (let index = 0; index < count; index += 1) {
        const offset = s * 0.14 + index * step;
        rows.push(shape(t % 2
          ? { x: x + offset, y: y + s * 0.14, width: thick, height: span }
          : { x: x + s * 0.14, y: y + offset, width: span, height: thick }, { fill: fg, borderRadius: round(thick / 2) }));
      }
      break;
    }
    case "dots": {
      const d = s * 0.36;
      for (const [dx, dy] of [[0.1, 0.1], [0.54, 0.1], [0.1, 0.54], [0.54, 0.54]] as const) {
        rows.push(shape({ x: x + s * dx, y: y + s * dy, width: d, height: d }, { shape: "ellipse", fill: fg }));
        rows.push(shape({ x: x + s * dx + d * 0.3, y: y + s * dy + d * 0.3, width: d * 0.4, height: d * 0.4 }, { shape: "ellipse", fill: fg2 }));
      }
      break;
    }
    case "square":
      rows.push(shape(inset(0.22), { fill: fg }));
      rows.push(shape(inset(0.4), { shape: "ellipse", fill: fg2 }));
      break;
    case "burst": {
      // Twelve rounded rays round the centre, each turned to face outward.
      const w = s * 0.07;
      const h = s * 0.3;
      const distance = s * 0.27;
      for (let ray = 0; ray < 12; ray += 1) {
        const angle = ray * 30;
        const radians = (angle * Math.PI) / 180;
        const cx = x + s / 2 + distance * Math.sin(radians);
        const cy = y + s / 2 - distance * Math.cos(radians);
        rows.push(shape({ x: cx - w / 2, y: cy - h / 2, width: w, height: h }, { fill: fg, borderRadius: round(w / 2) }, angle));
      }
      break;
    }
  }
  return rows;
}

/**
 * A grid of cells. Each cell's ground differs from its left and upper
 * neighbours', and its figure from its ground; `fill` is the share of cells
 * given a ground of their own. `hole` keeps a square of cells empty — the
 * place for a photograph.
 */
export function mosaic(input: {
  origin: { x: number; y: number };
  cols: number;
  rows: number;
  cell: number;
  colors: string[];
  under: string;
  next: () => number;
  fill: number;
  hole?: { col: number; row: number; span: number };
}): Row[] {
  const { origin, cols, cell, colors, next } = input;
  const out: Row[] = [];
  const grounds: (string | null)[][] = [];
  const pick = (avoid: (string | null)[]) => {
    const free = colors.filter((color) => !avoid.includes(color));
    const pool = free.length ? free : colors;
    return pool[Math.floor(next() * pool.length)]!;
  };
  for (let row = 0; row < input.rows; row += 1) {
    grounds.push([]);
    for (let col = 0; col < cols; col += 1) {
      const holed = input.hole && col >= input.hole.col && col < input.hole.col + input.hole.span && row >= input.hole.row && row < input.hole.row + input.hole.span;
      if (holed) { grounds[row]!.push(null); continue; }
      const left = col > 0 ? grounds[row]![col - 1]! : null;
      const up = row > 0 ? grounds[row - 1]![col]! : null;
      const bg = next() < input.fill ? pick([left, up, input.under]) : null;
      grounds[row]!.push(bg);
      const fg = pick([bg, bg ? null : input.under, left && !bg ? left : null]);
      const fg2 = pick([fg, bg ?? input.under]);
      out.push(...cellRows({ x: origin.x + col * cell, y: origin.y + row * cell }, cell, pickMotif(next), Math.floor(next() * 8), { bg, under: input.under, fg, fg2 }));
    }
  }
  return out;
}

/**
 * A white page's mosaic: one column of cells down its right edge — or its
 * left, every other page — clear of everything on the page. A page with no
 * room on either edge has none.
 */
export function mozaikaBackdrop(input: { dna: DesignDNA; next: () => number; keep: Rect[]; index: number }): Row[] {
  const colors = input.dna.tiles?.page ?? [input.dna.colors.accent];
  const sides = input.index % 2 ? (["left", "right"] as const) : (["right", "left"] as const);
  for (const side of sides) {
    for (const width of side === "right" ? [56, 48] : [44, 38]) {
      const strip = { x: side === "right" ? W - width : 0, y: 0, width, height: H };
      if (input.keep.some((rect) => intersects(strip, rect, 6))) continue;
      return mosaic({ origin: { x: strip.x, y: 0 }, cols: 1, rows: Math.ceil(H / width), cell: width, colors, under: input.dna.colors.ground, next: input.next, fill: 0.72 });
    }
  }
  return [];
}
