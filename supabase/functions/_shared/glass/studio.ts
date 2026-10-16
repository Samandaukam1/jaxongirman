/**
 * The device behind a soft 3D deck.
 *
 * The page is the face of an instrument, all one material, and each page
 * carries one of its controls in a corner the layout left open: a dial with
 * its scale and lit marker, a slider with its track filled to a point, a pair
 * of switches, a speaker grille. Everything is raised out of the surface or
 * pressed into it (`glass/soft.ts`); the only colour is the indicator light.
 * Covers and closing pages carry the large dial.
 *
 * A control is placed only where it touches nothing the page shows, whole and
 * clear of the edges, and each page picks its control from its own seed.
 */

import { alpha } from "./color.ts";
import { H, intersects, round, W, type Light, type Rect, type Row } from "./backdrop.ts";
import type { DesignDNA } from "./dna.ts";
import { face, indicator, lift, raisedRows, wellRow } from "./soft.ts";

function mark(rect: Rect, style: Record<string, unknown>, rotation = 0): Row {
  return {
    type: "shape",
    x: round(rect.x),
    y: round(rect.y),
    width: round(Math.max(1, rect.width)),
    height: round(Math.max(1, rect.height)),
    rotation: Math.round(rotation),
    z_index: 0,
    opacity: 1,
    locked: true,
    style,
    content: { kind: "device", decor: true },
  };
}

/** A dial: a raised disc with a scale round its rim and a lit marker in its well. */
function dial(dna: DesignDNA, center: { x: number; y: number }, diameter: number, next: () => number): Row[] {
  const rows: Row[] = [];
  const box = { x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter };
  rows.push(...raisedRows(dna, box, diameter / 2, Math.max(8, diameter * 0.07), "device", true));
  const inner = diameter * 0.6;
  rows.push(wellRow(dna, { x: center.x - inner / 2, y: center.y - inner / 2, width: inner, height: inner }, inner / 2, "device", true));
  // The scale: ticks between the well and the rim, every fourth one longer.
  const ticks = 24;
  const reach = diameter * 0.4;
  const lit = Math.floor(next() * ticks * 0.75) + 4;
  for (let index = 0; index < ticks; index += 1) {
    const turn = (index / ticks) * Math.PI * 2 - Math.PI / 2;
    const long = index % 4 === 0;
    const length = long ? diameter * 0.06 : diameter * 0.035;
    rows.push(mark({ x: center.x + Math.cos(turn) * reach - 1, y: center.y + Math.sin(turn) * reach - length / 2, width: 2, height: length }, {
      fill: index <= lit ? alpha(dna.colors.accent, long ? 0.95 : 0.7) : alpha(dna.colors.ink, 0.18),
      borderRadius: 1,
    }, (turn * 180) / Math.PI + 90));
  }
  // The marker: where the scale stops, lit inside the well's edge.
  const at = (lit / ticks) * Math.PI * 2 - Math.PI / 2;
  rows.push(...indicator(dna, { x: center.x + Math.cos(at) * inner * 0.36, y: center.y + Math.sin(at) * inner * 0.36 }, Math.max(6, diameter * 0.05), true));
  return rows;
}

/** A slider: a pressed track, filled with the accent to a raised knob. */
function slider(dna: DesignDNA, origin: { x: number; y: number }, width: number, fill: number): Row[] {
  const rows: Row[] = [];
  const height = 16;
  rows.push(wellRow(dna, { x: origin.x, y: origin.y, width, height }, height / 2, "device", true));
  const filled = Math.max(height, (width - 6) * fill);
  rows.push(mark({ x: origin.x + 3, y: origin.y + 3, width: filled, height: height - 6 }, {
    fill: dna.colors.accent,
    gradientStops: [{ color: alpha(dna.colors.accent, 0.55), offset: 0 }, { color: dna.colors.accent, offset: 100 }],
    gradientAngle: 90,
    borderRadius: (height - 6) / 2,
  }));
  const knob = 30;
  const kx = origin.x + 3 + filled - knob / 2;
  const knobBox = { x: kx, y: origin.y + height / 2 - knob / 2, width: knob, height: knob };
  rows.push(...lift(dna, knobBox, knob / 2, 5, true), face(dna, knobBox, knob / 2, "device", true));
  rows.push(...indicator(dna, { x: kx + knob / 2, y: origin.y + height / 2 }, 5, true));
  return rows;
}

/** Two switches, one on: pressed pills with raised knobs. */
function switches(dna: DesignDNA, origin: { x: number; y: number }, on: number): Row[] {
  const rows: Row[] = [];
  for (let index = 0; index < 2; index += 1) {
    const y = origin.y + index * 46;
    const pill = { x: origin.x, y, width: 74, height: 34 };
    rows.push(wellRow(dna, pill, 17, "device", true));
    const active = index === on;
    const knob = { x: active ? pill.x + pill.width - 31 : pill.x + 3, y: y + 3, width: 28, height: 28 };
    rows.push(...lift(dna, knob, 14, 4, true), face(dna, knob, 14, "device", true));
    if (active) rows.push(...indicator(dna, { x: pill.x + 17, y: y + 17 }, 6, true));
  }
  return rows;
}

/** A speaker grille: a field of small wells. */
function grille(dna: DesignDNA, origin: { x: number; y: number }, columns: number, lines: number): Row[] {
  const rows: Row[] = [];
  for (let row = 0; row < lines; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      rows.push(wellRow(dna, { x: origin.x + column * 22, y: origin.y + row * 22, width: 12, height: 12 }, 6, "device", true));
    }
  }
  return rows;
}

/** The side of the page a layout leaves open, read from its light wish. */
const SIDE: Record<Light, { x: [number, number]; y: [number, number] }> = {
  right: { x: [0.62, 0.98], y: [0.06, 0.94] },
  left: { x: [0.02, 0.38], y: [0.06, 0.94] },
  top: { x: [0.06, 0.94], y: [0.02, 0.32] },
  bottom: { x: [0.06, 0.94], y: [0.66, 0.98] },
  center: { x: [0.25, 0.75], y: [0.25, 0.75] },
  corners: { x: [0, 1], y: [0, 1] },
};

export function studioBackdrop(input: {
  dna: DesignDNA;
  next: () => number;
  light: Light;
  /** Everything the page shows; no control may touch any of it. */
  keep: Rect[];
  hero: boolean;
}): Row[] {
  const { dna, next } = input;
  const side = SIDE[input.light];
  const taken: Rect[] = [...input.keep];
  const margin = 18;

  /** A free top-left corner for a control of this size: whole, clear of the edges and of everything shown. */
  const place = (width: number, height: number, depth = 5, tries = 80): { x: number; y: number } | null => {
    // A raised form's shadow reaches about twice its depth past it; that is room it needs.
    const pad = 10 + depth * 2.4;
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const wanted = attempt < tries * 0.6;
      const cx = wanted ? W * (side.x[0] + (side.x[1] - side.x[0]) * next()) : next() * W;
      const cy = wanted ? H * (side.y[0] + (side.y[1] - side.y[0]) * next()) : next() * H;
      const box = { x: cx - width / 2, y: cy - height / 2, width, height };
      // Its shadow stays on the page as well as the control.
      const edge = Math.max(margin, 6 + depth * 2.1);
      if (box.x < edge || box.y < edge || box.x + width > W - edge || box.y + height > H - edge) continue;
      // The control's own shadows reach past it; the room it needs includes them.
      if (taken.some((rect) => intersects(box, rect, pad))) continue;
      taken.push(box);
      return { x: box.x, y: box.y };
    }
    return null;
  };

  const rows: Row[] = [];
  if (input.hero) {
    for (const size of [230, 200, 170, 140]) {
      const at = place(size, size, Math.max(8, size * 0.07));
      if (!at) continue;
      rows.push(...dial(dna, { x: at.x + size / 2, y: at.y + size / 2 }, size, next));
      break;
    }
    const track = 200;
    const spot = place(track, 34);
    if (spot) rows.push(...slider(dna, { x: spot.x, y: spot.y + 9 }, track, 0.35 + next() * 0.5));
    return rows;
  }

  const roll = next();
  if (roll < 0.4) {
    for (const size of [150, 126, 104, 86]) {
      const at = place(size, size, Math.max(8, size * 0.07));
      if (!at) continue;
      rows.push(...dial(dna, { x: at.x + size / 2, y: at.y + size / 2 }, size, next));
      break;
    }
  } else if (roll < 0.65) {
    for (const track of [220, 180, 140]) {
      const spot = place(track, 34);
      if (!spot) continue;
      rows.push(...slider(dna, { x: spot.x, y: spot.y + 9 }, track, 0.3 + next() * 0.55));
      break;
    }
  } else if (roll < 0.85) {
    const spot = place(74, 80);
    if (spot) rows.push(...switches(dna, spot, next() < 0.5 ? 0 : 1));
  } else {
    const columns = 5;
    const lines = 3;
    const spot = place((columns - 1) * 22 + 12, (lines - 1) * 22 + 12);
    if (spot) rows.push(...grille(dna, spot, columns, lines));
  }
  return rows;
}
