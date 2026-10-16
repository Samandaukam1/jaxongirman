/**
 * The page behind a corporate deck, and the shadow its cards float on.
 *
 * White ground; one large form of the brand colour bleeding off the page — a
 * band along the bottom, a great circle in a corner, a tall pill down one
 * side or a thick ring — graded through two steps of the brand's hue; a grid
 * of brand dots in an open corner; the deck's mark in the top-left corner.
 *
 * The form sits behind the content and is meant to: cards and photographs
 * overlap it, which is the whole look. What it may never touch is a word set
 * straight on the white — a title, a lead, a label — because white-on-brand
 * text there would be the wrong colour. Each page picks its form from its own
 * seed, and keeps it only if every such word is clear.
 */

import { alpha } from "./color.ts";
import { H, intersects, round, W, type Light, type Rect, type Row } from "./backdrop.ts";
import type { DesignDNA } from "./dna.ts";

function form(rect: Rect, style: Record<string, unknown>, kind = "brand", locked = true): Row {
  return {
    type: "shape",
    x: round(rect.x),
    y: round(rect.y),
    width: round(Math.max(1, rect.width)),
    height: round(Math.max(1, rect.height)),
    rotation: 0,
    z_index: 0,
    opacity: 1,
    locked,
    style,
    content: locked ? { kind, decor: true } : { kind },
  };
}

/** The brand as a fill: graded through two steps of its hue, light falling from the upper left. */
export function brandFill(dna: DesignDNA, angle = 135): Record<string, unknown> {
  const [brand, brand2] = dna.colors.glows;
  return { fill: brand, gradientStops: [{ color: brand, offset: 0 }, { color: brand2, offset: 100 }], gradientAngle: angle };
}

/**
 * A realistic soft shadow under a floating card: a tight contact shadow and a
 * wide, faint ambient one, each built from stacked translucent layers so every
 * renderer draws it the same — none of them blurs. A card cut to a shape of
 * its own (the naqsh leaf) passes its corners, and the shadow takes them too.
 */
export function dropRows(dna: DesignDNA, rect: Rect, radius: number, depth = 12, locked = false, corners?: readonly number[]): Row[] {
  const rows: Row[] = [];
  const color = dna.colors.shadow;
  const passes: [number, number, number][] = [
    // [vertical offset, spread, total strength]
    [depth * 1.1, depth * 1.6, 0.11],
    [depth * 0.35, depth * 0.45, 0.07],
  ];
  for (const [offset, spread, strength] of passes) {
    const layers = 4;
    for (let layer = layers; layer >= 1; layer -= 1) {
      const grow = (spread * layer) / layers;
      rows.push(form({
        x: rect.x - grow + depth * 0.12,
        y: rect.y - grow * 0.6 + offset,
        width: rect.width + grow * 2 - depth * 0.24,
        height: rect.height + grow * 1.6,
      }, {
        fill: alpha(color, (strength / layers) * (1.2 - layer * 0.1)),
        borderRadius: round(radius + grow),
        // A shaped card's shadow follows its shape: each corner grows with the layer.
        ...(corners ? { borderRadiusCorners: corners.map((corner) => round(corner + grow)) } : {}),
      }, "shadow", locked));
    }
  }
  return rows;
}

/** The deck's mark: a brand disc with a white quarter in it, top left on every page. */
function mark(dna: DesignDNA): Row[] {
  return [
    form({ x: 22, y: 18, width: 28, height: 28 }, { shape: "ellipse", ...brandFill(dna) }, "mark"),
    form({ x: 31, y: 27, width: 10, height: 10 }, { fill: "#FFFFFF", borderRadius: 2 }, "mark"),
  ];
}

const OPEN: Record<Light, ("band" | "circle" | "pill" | "ring")[]> = {
  bottom: ["band", "circle", "ring", "pill"],
  right: ["pill", "circle", "ring", "band"],
  left: ["circle", "ring", "band", "pill"],
  top: ["circle", "ring", "pill", "band"],
  center: ["band", "ring", "circle", "pill"],
  corners: ["circle", "ring", "band", "pill"],
};

export function corporateBackdrop(input: {
  dna: DesignDNA;
  next: () => number;
  light: Light;
  /** Words set straight on the white: no brand form may touch them. */
  words: Rect[];
  /** Everything the page shows: the dot grid stays clear of all of it. */
  keep: Rect[];
  hero: boolean;
}): Row[] {
  const { dna, next } = input;
  const rows: Row[] = [];
  const clear = (box: Rect, of: Rect[], pad: number) => !of.some((rect) => intersects(box, rect, pad));

  const markBox = { x: 18, y: 14, width: 36, height: 36 };
  if (clear(markBox, input.keep, 4)) rows.push(...mark(dna));

  /** One large form, the first of this page's candidates that touches no word on the white. */
  const kinds = [...OPEN[input.light]];
  // The seed turns the order a little, so a deck does not repeat one form.
  if (next() < 0.5) kinds.push(kinds.shift()!);
  const candidates = (kind: string): { box: Rect; style: Record<string, unknown> }[] => {
    switch (kind) {
      case "band": {
        const out = [];
        for (const top of [0.62, 0.68, 0.74, 0.8]) {
          const y = H * top;
          const inset = next() < 0.5 ? 0 : 80 + next() * 120;
          const fromLeft = next() < 0.5;
          out.push({ box: { x: fromLeft ? -40 : inset, y, width: W - inset + 40, height: H - y + 80 }, style: { ...brandFill(dna, 160), borderRadius: 48 } });
        }
        return out;
      }
      case "circle": {
        const out = [];
        for (const size of [520, 440, 360, 300]) {
          for (const corner of ["tr", "bl", "br", "tl"] as const) {
            const inset = size * (0.42 + next() * 0.12);
            const x = corner === "tl" || corner === "bl" ? -inset : W - size + inset;
            const y = corner === "tl" || corner === "tr" ? -inset : H - size + inset;
            out.push({ box: { x, y, width: size, height: size }, style: { shape: "ellipse", ...brandFill(dna) } });
          }
        }
        return out;
      }
      case "pill": {
        const out = [];
        for (const width of [260, 210, 170]) {
          const right = next() < 0.65;
          out.push({ box: { x: right ? W - width + 70 : -70, y: 40 + next() * 30, width, height: H - 90 }, style: { ...brandFill(dna, right ? 180 : 0), borderRadius: 90 } });
        }
        return out;
      }
      default: {
        const out = [];
        for (const size of [420, 340, 280]) {
          for (const corner of ["tr", "bl", "br", "tl"] as const) {
            const inset = size * 0.38;
            const x = corner === "tl" || corner === "bl" ? -inset : W - size + inset;
            const y = corner === "tl" || corner === "tr" ? -inset : H - size + inset;
            out.push({ box: { x, y, width: size, height: size }, style: { shape: "ellipse", fill: "#00000000", stroke: alpha(dna.colors.glows[0], 0.22), strokeWidth: 26 } });
          }
        }
        return out;
      }
    }
  };
  let placed: Rect | null = null;
  for (const kind of kinds) {
    for (const candidate of candidates(kind)) {
      // Clear of every word on the white, and of the mark.
      if (!clear(candidate.box, input.words, 14) || !clear(candidate.box, [markBox], 6)) continue;
      rows.push(form(candidate.box, candidate.style));
      placed = candidate.box;
      break;
    }
    if (placed) break;
  }

  // A grid of brand dots in an open corner.
  const columns = 6;
  const lines = 4;
  const step = 13;
  const size = 5;
  const width = (columns - 1) * step + size;
  const height = (lines - 1) * step + size;
  const spots = [
    { x: W - 34 - width, y: 22 }, { x: W - 34 - width, y: H - 22 - height }, { x: 70, y: H - 22 - height }, { x: W / 2 - width / 2, y: H - 22 - height },
  ];
  const start = Math.floor(next() * spots.length);
  for (let offset = 0; offset < spots.length; offset += 1) {
    const spot = spots[(start + offset) % spots.length]!;
    const box = { x: spot.x, y: spot.y, width, height };
    if (!clear(box, input.keep, 10) || (placed && intersects(box, placed, 6))) continue;
    for (let row = 0; row < lines; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        rows.push(form({ x: spot.x + column * step, y: spot.y + row * step, width: size, height: size }, { shape: "ellipse", fill: alpha(dna.colors.glows[0], 0.55) }, "dots"));
      }
    }
    break;
  }
  return rows;
}
