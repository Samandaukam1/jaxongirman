/**
 * The light behind the glass, composed for one page.
 *
 * Every background is built here at generation time out of plain vector
 * shapes — radial-gradient ellipses for the light, and a handful of glass
 * objects (spheres, capsules, rings) made of the same — so the phone, the web
 * viewer, the PDF and the PowerPoint file all draw it from the same rows, and
 * no picture exists before the deck does.
 *
 * Placement is decided against the page's own content. A layout says where it
 * would like the light ("behind the cards", "to the right of the title"); the
 * glow is put there and dimmed wherever words sit straight on the ground, and
 * a glass object is only placed where it touches nothing the reader needs.
 * Each page has its own seed, so no two pages of a deck light the same way.
 */

import { alpha } from "./color.ts";
import type { DesignDNA } from "./dna.ts";

export const W = 1000;
export const H = 562.5;

export type Rect = { x: number; y: number; width: number; height: number };

export type Row = {
  type: "text" | "image" | "shape" | "line" | "chart" | "icon";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  opacity: number;
  locked: boolean;
  style: Record<string, unknown>;
  content: Record<string, unknown>;
};

/** Where a layout wants its light. */
export type Light = "left" | "right" | "top" | "bottom" | "center" | "corners";

export const round = (value: number) => Math.round(value * 10) / 10;

export function intersects(a: Rect, b: Rect, pad = 0): boolean {
  return a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;
}

const inside = (x: number, y: number, rect: Rect) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

function decor(rect: Rect, style: Record<string, unknown>, rotation = 0, kind = "light"): Row {
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
    content: { kind, decor: true },
  };
}

/** A soft light: a radial gradient fading to nothing, which reads as blur everywhere. */
function glow(center: { x: number; y: number }, width: number, height: number, color: string, strength: number, rotation: number): Row {
  return decor({ x: center.x - width / 2, y: center.y - height / 2, width, height }, {
    shape: "ellipse",
    gradientType: "radial",
    gradientStops: [
      { color: alpha(color, strength), offset: 0 },
      { color: alpha(color, strength * 0.72), offset: 30 },
      { color: alpha(color, strength * 0.3), offset: 62 },
      { color: alpha(color, 0), offset: 100 },
    ],
  }, rotation);
}

/** Where the light sources go for each wish, as ranges in page fractions. */
const ANCHORS: Record<Light, { x: [number, number]; y: [number, number] }[]> = {
  right: [{ x: [0.78, 1.05], y: [0.05, 0.45] }, { x: [0.72, 1.02], y: [0.6, 1.08] }, { x: [0.48, 0.7], y: [0.85, 1.12] }],
  left: [{ x: [-0.05, 0.22], y: [0.05, 0.45] }, { x: [-0.02, 0.28], y: [0.6, 1.08] }, { x: [0.3, 0.52], y: [-0.12, 0.12] }],
  top: [{ x: [0.05, 0.35], y: [-0.18, 0.08] }, { x: [0.45, 0.75], y: [-0.22, 0.05] }, { x: [0.82, 1.05], y: [-0.1, 0.25] }],
  bottom: [{ x: [0.02, 0.32], y: [0.9, 1.18] }, { x: [0.4, 0.7], y: [0.92, 1.22] }, { x: [0.78, 1.04], y: [0.72, 1.08] }],
  center: [{ x: [0.4, 0.6], y: [0.35, 0.65] }, { x: [-0.05, 0.12], y: [-0.08, 0.15] }, { x: [0.88, 1.05], y: [0.85, 1.08] }],
  corners: [{ x: [-0.06, 0.1], y: [-0.1, 0.12] }, { x: [0.9, 1.06], y: [0.85, 1.1] }, { x: [0.88, 1.05], y: [-0.08, 0.1] }],
};

function between(next: () => number, [low, high]: [number, number]): number {
  return low + next() * (high - low);
}

/* --------------------------------------------------------- glass objects */

function sphere(dna: DesignDNA, center: { x: number; y: number }, diameter: number): Row[] {
  const dark = dna.direction.mode === "dark";
  const box = { x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter };
  const white = "#FFFFFF";
  const body = decor(box, {
    shape: "ellipse",
    gradientType: "radial",
    // Fresnel: clear where you look through it, bright where light skims the rim.
    gradientStops: dark
      ? [{ color: alpha(white, 0.03), offset: 0 }, { color: alpha(white, 0.05), offset: 58 }, { color: alpha(white, 0.17), offset: 88 }, { color: alpha(white, 0.34), offset: 100 }]
      : [{ color: alpha(white, 0.2), offset: 0 }, { color: alpha(white, 0.3), offset: 58 }, { color: alpha(white, 0.62), offset: 90 }, { color: alpha(white, 0.9), offset: 100 }],
    stroke: alpha(white, dark ? 0.42 : 0.95),
    strokeWidth: 1,
    backdropBlur: 14,
    shadows: [{ color: dark ? "#000000" : dna.colors.shadow, opacity: dark ? 0.42 : 0.16, blur: Math.round(diameter * 0.18), offsetX: 0, offsetY: Math.round(diameter * 0.09) }],
  }, 0, "glass-sphere");
  const caustic = glow(
    { x: center.x + diameter * 0.1, y: center.y + diameter * 0.3 },
    diameter * 0.62, diameter * 0.26, dna.colors.glows[1], dark ? 0.62 : 0.5, -8,
  );
  const highlight = glow(
    { x: center.x - diameter * 0.16, y: center.y - diameter * 0.27 },
    diameter * 0.42, diameter * 0.22, white, dark ? 0.7 : 0.95, -28,
  );
  const spark = glow(
    { x: center.x - diameter * 0.2, y: center.y - diameter * 0.3 },
    Math.max(3, diameter * 0.08), Math.max(2, diameter * 0.05), white, 1, -28,
  );
  for (const row of [caustic, highlight, spark]) row.content = { kind: "glass-light", decor: true };
  return [body, caustic, highlight, spark];
}

function capsule(dna: DesignDNA, center: { x: number; y: number }, width: number, rotation: number): Row[] {
  const dark = dna.direction.mode === "dark";
  const height = width * 0.34;
  const white = "#FFFFFF";
  return [decor({ x: center.x - width / 2, y: center.y - height / 2, width, height }, {
    fill: alpha(white, dark ? 0.08 : 0.55),
    gradientStops: dark
      ? [{ color: alpha(white, 0.34), offset: 0 }, { color: alpha(white, 0.06), offset: 48 }, { color: alpha(white, 0.16), offset: 100 }]
      : [{ color: alpha(white, 0.96), offset: 0 }, { color: alpha(white, 0.5), offset: 50 }, { color: alpha(white, 0.72), offset: 100 }],
    gradientAngle: 180,
    borderRadius: round(height / 2),
    stroke: alpha(white, dark ? 0.4 : 0.95),
    strokeWidth: 1,
    backdropBlur: 12,
    shadows: [{ color: dark ? "#000000" : dna.colors.shadow, opacity: dark ? 0.4 : 0.14, blur: 18, offsetX: 0, offsetY: 9 }],
  }, rotation, "glass-capsule")];
}

function ring(dna: DesignDNA, center: { x: number; y: number }, diameter: number): Row[] {
  const dark = dna.direction.mode === "dark";
  const white = "#FFFFFF";
  const band = Math.max(6, diameter * 0.09);
  const outer = { x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter };
  const inner = { x: outer.x + band * 0.5, y: outer.y + band * 0.5, width: diameter - band, height: diameter - band };
  return [
    decor(inner, { shape: "ellipse", fill: alpha(white, 0), stroke: alpha(white, dark ? 0.16 : 0.62), strokeWidth: round(band) }, 0, "glass-ring"),
    decor(outer, { shape: "ellipse", fill: alpha(white, 0), stroke: alpha(white, dark ? 0.46 : 0.95), strokeWidth: 1 }, 0, "glass-ring"),
    decor({ x: outer.x + band, y: outer.y + band, width: diameter - band * 2, height: diameter - band * 2 }, {
      shape: "ellipse", fill: alpha(white, 0), stroke: alpha(dna.colors.glows[1], dark ? 0.5 : 0.45), strokeWidth: 1,
    }, 0, "glass-ring"),
  ];
}

function ribbon(dna: DesignDNA, center: { x: number; y: number }, length: number, rotation: number): Row {
  const dark = dna.direction.mode === "dark";
  return glow(center, length, Math.max(14, length * 0.045), "#FFFFFF", dark ? 0.42 : 0.75, rotation);
}

/* -------------------------------------------------------------- the page */

/**
 * Light and glass for one page.
 *
 * `keep` is everything the reader needs — words, cards, pictures, charts —
 * and `words` is the subset that sits directly on the ground. Glass objects
 * never touch `keep`; glows never sit at full strength under `words`.
 */
export function backdrop(input: {
  dna: DesignDNA;
  next: () => number;
  light: Light;
  keep: Rect[];
  words: Rect[];
  /** Covers and closing pages carry the large objects. */
  hero: boolean;
}): Row[] {
  const { dna, next } = input;
  const rows: Row[] = [];
  const motif = dna.motif;

  // The light.
  const anchors = ANCHORS[input.light];
  const extra = motif === "mesh" ? 2 : 1;
  const sources = [...anchors, ...Array.from({ length: extra }, () => ({ x: [0, 1] as [number, number], y: [0, 1] as [number, number] }))];
  sources.forEach((anchor, index) => {
    const x = between(next, anchor.x) * W;
    const y = between(next, anchor.y) * H;
    const size = (input.hero ? 560 : 470) * (0.78 + next() * 0.5) * (index >= anchors.length ? 0.75 : 1);
    const onWords = input.words.some((rect) => inside(x, y, rect));
    const color = dna.colors.glows[index % 4]!;
    const base = dna.intensity * (index === 0 ? 1 : 0.82 - index * 0.06) * (index >= anchors.length ? 0.55 : 1);
    rows.push(glow({ x, y }, size, size * (0.62 + next() * 0.38), color, onWords ? base * 0.45 : base, Math.round((next() - 0.5) * 60)));
  });

  if (motif === "ribbons" || (input.hero && motif !== "mesh")) {
    const count = motif === "ribbons" ? 2 : 1;
    for (let index = 0; index < count; index += 1) {
      const length = (input.hero ? 760 : 620) * (0.8 + next() * 0.3);
      rows.push(ribbon(dna, { x: W * (0.35 + next() * 0.5), y: H * (input.light === "bottom" ? 0.9 : 0.12 + next() * 0.2) }, length, -6 - next() * 16));
    }
  }

  // The glass, only where it touches nothing.
  const blocked = input.keep;
  /**
   * A spot for an object of this size and turn that touches nothing.
   *
   * Measured with the object's real rotated bounds: a capsule tested as the
   * square of its height once landed across the start of a title.
   */
  const place = (width: number, height: number, rotation = 0, tries = 48): { x: number; y: number } | null => {
    const radians = (Math.abs(rotation) * Math.PI) / 180;
    const bw = width * Math.cos(radians) + height * Math.sin(radians);
    const bh = width * Math.sin(radians) + height * Math.cos(radians);
    for (let attempt = 0; attempt < tries; attempt += 1) {
      // Edges and corners: an object half off the page reads as part of a
      // larger space; one floating mid-page reads as a stray.
      const edge = next();
      const x = edge < 0.5 ? (next() < 0.5 ? next() * 0.16 : 0.84 + next() * 0.18) * W : next() * W;
      const y = edge < 0.5 ? next() * H : (next() < 0.5 ? next() * 0.18 : 0.82 + next() * 0.2) * H;
      const box = { x: x - bw / 2, y: y - bh / 2, width: bw, height: bh };
      const visible = Math.max(0, Math.min(W, box.x + box.width) - Math.max(0, box.x)) * Math.max(0, Math.min(H, box.y + box.height) - Math.max(0, box.y));
      if (visible < bw * bh * 0.35) continue;
      if (blocked.some((rect) => intersects(box, rect, 14))) continue;
      return { x, y };
    }
    return null;
  };

  const objects: Row[] = [];
  const hero = input.hero ? 1.9 : 1;
  const spheres = motif === "orbs" ? (input.hero ? 2 : 1 + Math.round(next())) : motif === "mesh" ? (next() < 0.5 ? 1 : 0) : 1;
  for (let index = 0; index < spheres; index += 1) {
    const diameter = (index === 0 ? 110 : 54) * hero * (0.8 + next() * 0.45);
    const at = place(diameter, diameter);
    if (at) objects.push(...sphere(dna, at, diameter));
  }
  if (motif === "halo" || (input.hero && next() < 0.6)) {
    const diameter = 96 * (input.hero ? 1.4 : 1) * (0.8 + next() * 0.4);
    const at = place(diameter, diameter);
    if (at) objects.push(...ring(dna, at, diameter));
  }
  if (motif === "ribbons" || motif === "orbs" || next() < 0.35) {
    const width = 92 * (input.hero ? 1.3 : 1) * (0.85 + next() * 0.35);
    const rotation = Math.round((next() - 0.5) * 50);
    const at = place(width, width * 0.34, rotation);
    if (at) objects.push(...capsule(dna, at, width, rotation));
  }

  return [...rows, ...objects];
}
