/**
 * Spektr: the infographic deck.
 *
 * Two kinds of page. A hero page — the cover, a statement, a quotation, the
 * close — is one vivid field of colour, a three-stop gradient across the whole
 * slide, its words in white on the left and one giant line-drawn icon of the
 * subject standing off the right edge. Every other page is white, and on it
 * each figure, icon and card takes its own colour from the deck's spectrum, so
 * a page of four numbers reads as four colours — the way an infographic does.
 *
 * The colours are a table by family, like the naqsh one. The hero gradient's
 * first two stops carry white type at 4.5:1 — the words sit over them, on the
 * left — and its last brightens toward the icon on the right, still 3:1. Each
 * colour of the spectrum holds 4.5:1 against white both ways, as a figure on
 * the white page and as the disc a white number or glyph sits in; it starts at
 * the family's own colour and walks round the wheel.
 */

import { alpha } from "./color.ts";
import { H, intersects, round, W, type Rect, type Row } from "./backdrop.ts";
import type { DesignDNA } from "./dna.ts";
import { iconVector, lucideName } from "./icons.ts";
import type { NaqshFamily } from "./naqsh-palette.ts";

export const SPEKTR_FAMILIES: Record<NaqshFamily, { hero: [string, string, string]; spectrum: [string, string, string, string, string] }> = {
  blue: { hero: ["#1E3FD8", "#6A2BE0", "#C0268E"], spectrum: ["#2563EB", "#7C3AED", "#DB2777", "#C2410C", "#15803D"] },
  teal: { hero: ["#0B5F7A", "#0B7A94", "#2F6BEA"], spectrum: ["#0E7490", "#2563EB", "#7C3AED", "#15803D", "#C2410C"] },
  green: { hero: ["#04704F", "#0F7A3E", "#4D9A0F"], spectrum: ["#15803D", "#0E7490", "#2563EB", "#B45309", "#DB2777"] },
  gold: { hero: ["#7A5200", "#A16207", "#E07A0A"], spectrum: ["#A16207", "#4D7C0F", "#C2410C", "#0E7490", "#7C3AED"] },
  orange: { hero: ["#B2340A", "#CC4A0A", "#EF6C00"], spectrum: ["#C2410C", "#A16207", "#BE185D", "#7C3AED", "#0E7490"] },
  red: { hero: ["#A81F17", "#DC2626", "#E07A0A"], spectrum: ["#DC2626", "#B45309", "#7C3AED", "#2563EB", "#0F766E"] },
  pink: { hero: ["#A3105A", "#D61F69", "#EF6C00"], spectrum: ["#DB2777", "#C2410C", "#7C3AED", "#2563EB", "#15803D"] },
  violet: { hero: ["#4C1DB3", "#8A2BE2", "#E0378A"], spectrum: ["#7C3AED", "#DB2777", "#C2410C", "#2563EB", "#0E7490"] },
};

function shape(rect: Rect, style: Record<string, unknown>, kind: string, rotation = 0): Row {
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
    content: { kind, decor: true },
  };
}

/** The hero gradient as a fill. */
export function heroFill(dna: DesignDNA, angle = 118): Record<string, unknown> {
  const [from, via, to] = dna.colors.glows as [string, string, string, string];
  return {
    fill: from,
    gradientStops: [{ color: from, offset: 0 }, { color: via, offset: 55 }, { color: to, offset: 100 }],
    gradientAngle: angle,
  };
}

/**
 * The field of a hero page: the gradient edge to edge, and two great soft
 * discs of white laid over its right half, so the colour has depth where the
 * icon stands. Drawn first, under everything.
 */
export function heroField(dna: DesignDNA, next: () => number): Row[] {
  const rows: Row[] = [shape({ x: 0, y: 0, width: W, height: H }, heroFill(dna, 112 + Math.round(next() * 20)), "field")];
  const big = 520 + next() * 120;
  rows.push(shape({ x: W - big * 0.62, y: -big * 0.42, width: big, height: big }, { shape: "ellipse", fill: alpha("#FFFFFF", 0.07) }, "orb"));
  const small = 300 + next() * 80;
  rows.push(shape({ x: W - small * 0.9, y: H - small * 0.55, width: small, height: small }, { shape: "ellipse", fill: alpha("#FFFFFF", 0.06) }, "orb"));
  return rows;
}

/**
 * The giant line icon of a hero page: white line art standing off the right
 * edge, as large as the words leave room for, never touching one. Returns
 * nothing when no size fits.
 */
export function heroIcon(rows: Row[], name: string): Row | null {
  const words = rows.filter((one) => one.type === "text");
  for (const size of [640, 560, 480, 400, 330]) {
    const box = { x: W - size * 0.66, y: (H - size) / 2 + 18, width: size, height: size };
    if (words.some((word) => intersects(box, word, 26))) continue;
    return {
      type: "icon",
      x: round(box.x),
      y: round(box.y),
      width: round(size),
      height: round(size),
      rotation: 0,
      z_index: 0,
      opacity: 0.92,
      locked: true,
      style: { color: "#FFFFFF" },
      content: { icon: lucideName(name), glyph: name, vector: iconVector(name, "line"), kind: "hero-icon", decor: true },
    };
  }
  return null;
}

/** A white page's thin line of the whole spectrum along its foot. */
export function spektrBackdrop(dna: DesignDNA): Row[] {
  const spectrum = dna.colors.chart;
  const stops = spectrum.map((color, index) => ({ color, offset: Math.round((index / (spectrum.length - 1)) * 100) }));
  return [shape({ x: 0, y: H - 5, width: W, height: 5 }, { fill: spectrum[0], gradientStops: stops, gradientAngle: 90 }, "spectrum")];
}
