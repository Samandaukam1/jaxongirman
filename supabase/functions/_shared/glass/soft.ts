/**
 * Soft UI: the surface and what is raised out of it or pressed into it.
 *
 * Everything in a soft 3D deck is one material in one colour. A card is the
 * ground pushed up toward the viewer — lit along its upper left edge, casting
 * a soft shadow to the lower right; a well is the ground pressed in — shaded
 * along its upper left, catching light along its lower right. No colour and no
 * transparency carry the depth: only light and shade.
 *
 * No renderer here blurs, so a soft shadow is built from four translucent
 * layers, each a little wider than the last, that pile up into a falloff. The
 * phone, the web viewer, the PDF and the PowerPoint file all stack them the
 * same way.
 */

import { alpha } from "./color.ts";
import { round, type Rect, type Row } from "./backdrop.ts";
import type { DesignDNA } from "./dna.ts";

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
 * The two shadows of a raised form: light thrown up and to the left, shade
 * down and to the right. `depth` is how far the form stands off the surface.
 */
export function lift(dna: DesignDNA, rect: Rect, radius: number, depth: number, locked = false): Row[] {
  const dark = dna.direction.mode === "dark";
  const rows: Row[] = [];
  const offset = depth * 0.7;
  const layers = 4;
  for (const [sign, color, strength] of [[-1, dna.colors.sheen, dark ? 0.2 : 0.42], [1, dna.colors.shadow, dark ? 0.26 : 0.17]] as const) {
    for (let layer = layers; layer >= 1; layer -= 1) {
      const spread = layer * depth * 0.32;
      rows.push(shape({
        x: rect.x + sign * offset - spread,
        y: rect.y + sign * offset - spread,
        width: rect.width + spread * 2,
        height: rect.height + spread * 2,
      }, { fill: alpha(color, strength / layers * (1.25 - layer * 0.12)), borderRadius: round(radius + spread) }, "shadow", locked));
    }
  }
  return rows;
}

/** The raised face itself: the ground, a shade lighter where the light falls. */
export function face(dna: DesignDNA, rect: Rect, radius: number, kind = "panel", locked = false, rotation = 0): Row {
  const ground = dna.colors.ground;
  return shape(rect, {
    fill: ground,
    gradientStops: [
      { color: dna.colors.panel, offset: 0 },
      { color: ground, offset: 55 },
      { color: ground, offset: 100 },
    ],
    gradientAngle: 135,
    borderRadius: round(radius),
  }, kind, locked, rotation);
}

/** A raised form: its shadows, then its face. */
export function raisedRows(dna: DesignDNA, rect: Rect, radius: number, depth: number, kind = "panel", locked = false): Row[] {
  return [...lift(dna, rect, radius, depth, locked), face(dna, rect, radius, kind, locked)];
}

/**
 * A well pressed into the surface: shade along the upper left inner edge,
 * light along the lower right, the ground between.
 */
export function wellRow(dna: DesignDNA, rect: Rect, radius: number, kind = "well", locked = false): Row {
  const dark = dna.direction.mode === "dark";
  return shape(rect, {
    fill: dna.colors.ground,
    gradientStops: [
      { color: alpha(dna.colors.shadow, dark ? 0.75 : 0.42), offset: 0 },
      { color: alpha(dna.colors.shadow, 0), offset: 32 },
      { color: alpha(dna.colors.sheen, 0), offset: 66 },
      { color: alpha(dna.colors.sheen, dark ? 0.35 : 0.95), offset: 100 },
    ],
    gradientAngle: 135,
    borderRadius: round(radius),
  }, kind, locked);
}

/** A point of the accent with a halo: the one light the device shows. */
export function indicator(dna: DesignDNA, center: { x: number; y: number }, size: number, locked = false): Row[] {
  const halo = size * 3.2;
  return [
    shape({ x: center.x - halo / 2, y: center.y - halo / 2, width: halo, height: halo }, {
      shape: "ellipse",
      gradientType: "radial",
      gradientStops: [{ color: alpha(dna.colors.accent, 0.45), offset: 0 }, { color: alpha(dna.colors.accent, 0), offset: 100 }],
    }, "glow", locked),
    shape({ x: center.x - size / 2, y: center.y - size / 2, width: size, height: size }, { shape: "ellipse", fill: dna.colors.accent }, "accent", locked),
  ];
}
