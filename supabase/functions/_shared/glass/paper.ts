/**
 * The page behind an editorial deck: paper, and a few printed marks on it.
 *
 * Where the glass style lights a page, this one sets it — a colour strip down
 * one edge, a large circle or square of the deck's colour cut by the page
 * edge, a field of dots or a stack of rules in a corner. All of it is plain
 * vector shapes, locked, and placed only where it touches nothing a reader
 * needs: every mark is tested against the page's own words and pictures before
 * it is kept. Each page draws its own marks from its own seed.
 */

import { alpha } from "./color.ts";
import { H, intersects, round, W, type Light, type Rect, type Row } from "./backdrop.ts";
import type { DesignDNA } from "./dna.ts";

function mark(rect: Rect, style: Record<string, unknown>, kind = "paper"): Row {
  return {
    type: "shape",
    x: round(rect.x),
    y: round(rect.y),
    width: round(Math.max(1, rect.width)),
    height: round(Math.max(1, rect.height)),
    rotation: 0,
    z_index: 0,
    opacity: 1,
    locked: true,
    style,
    content: { kind, decor: true },
  };
}

/** Corners as the side a layout leaves free: its light wish, read as "away from here". */
const CORNERS: Record<Light, ("tl" | "tr" | "bl" | "br")[]> = {
  right: ["tr", "br", "bl", "tl"],
  left: ["tl", "bl", "br", "tr"],
  top: ["tr", "tl", "br", "bl"],
  bottom: ["br", "bl", "tr", "tl"],
  center: ["br", "tr", "bl", "tl"],
  corners: ["br", "tl", "tr", "bl"],
};

export function paperBackdrop(input: {
  dna: DesignDNA;
  next: () => number;
  light: Light;
  /** Everything the page shows; no mark may touch any of it. */
  keep: Rect[];
  hero: boolean;
}): Row[] {
  const { dna, next } = input;
  const { colors } = dna;
  const dark = dna.direction.mode === "dark";
  const rows: Row[] = [];
  const taken: Rect[] = [...input.keep];
  const free = (box: Rect, pad = 14) => !taken.some((rect) => intersects(box, rect, pad));
  const claim = (box: Rect) => taken.push(box);

  // A strip of colour down one edge: the deck's signature, on most pages.
  if (next() < (input.hero ? 0.5 : 0.7)) {
    const width = 8 + Math.round(next() * 6);
    const left = next() < 0.5;
    const strip = { x: left ? 0 : W - width, y: 0, width, height: H };
    if (free(strip, 6)) {
      rows.push(mark(strip, { fill: next() < 0.6 ? colors.block : colors.accent, borderRadius: 0 }));
      claim(strip);
    }
  }

  // One large form cut by the page edge, in a corner the layout left open.
  const corners = CORNERS[input.light];
  const size = (input.hero ? 300 : 210) * (0.8 + next() * 0.45);
  const round_ = next() < 0.6;
  const solid = next() < 0.55;
  for (const corner of corners) {
    const inset = size * (0.38 + next() * 0.14);
    const x = corner === "tl" || corner === "bl" ? -inset : W - size + inset;
    const y = corner === "tl" || corner === "tr" ? -inset : H - size + inset;
    const box = { x, y, width: size, height: size };
    if (!free(box)) continue;
    const form = round_ ? { shape: "ellipse" } : { borderRadius: 0 };
    rows.push(mark(box, solid
      ? { ...form, fill: alpha(colors.block, dark ? 0.15 : 0.13) }
      : { ...form, fill: "#00000000", stroke: alpha(colors.block, dark ? 0.6 : 0.45), strokeWidth: 1.5 }));
    claim(box);
    break;
  }

  // A small printed texture: a field of dots or a stack of short rules.
  if (!input.hero || next() < 0.4) {
    const dots = next() < 0.55;
    const columns = dots ? 6 : 1;
    const lines = dots ? 4 : 5;
    const step = dots ? 13 : 8;
    const width = dots ? (columns - 1) * step + 4 : 64;
    const height = (lines - 1) * step + (dots ? 4 : 2);
    const spots: { x: number; y: number }[] = [
      { x: W - 40 - width, y: 22 }, { x: 40, y: 22 }, { x: W - 40 - width, y: H - 22 - height }, { x: 40, y: H - 22 - height },
      { x: W / 2 - width / 2, y: 22 },
    ];
    const start = Math.floor(next() * spots.length);
    for (let offset = 0; offset < spots.length; offset += 1) {
      const spot = spots[(start + offset) % spots.length]!;
      const box = { x: spot.x, y: spot.y, width, height };
      if (!free(box, 10)) continue;
      const ink = alpha(colors.ink, dark ? 0.3 : 0.24);
      if (dots) {
        for (let row = 0; row < lines; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            rows.push(mark({ x: spot.x + column * step, y: spot.y + row * step, width: 4, height: 4 }, { shape: "ellipse", fill: ink }));
          }
        }
      } else {
        for (let row = 0; row < lines; row += 1) {
          rows.push(mark({ x: spot.x, y: spot.y + row * step, width: row % 2 ? width * 0.62 : width, height: 2 }, { fill: row === 0 ? colors.accent : ink, borderRadius: 0 }));
        }
      }
      claim(box);
      break;
    }
  }

  return rows;
}
