import { contrastRatio, luminance, mix, parseHex, readableOn, toHex } from "./colors.ts";
import type { ColorFamily } from "./document.ts";
import type { ColorRole } from "./spec.ts";

/**
 * Reading colour off a photograph, and refusing to use it as found.
 *
 * The naive version of this feature is why it needs writing down: take the
 * dominant colour of the picture and paint the slide with it. A yellow-and-pink
 * photograph then produces a yellow-and-pink slide — every surface, every rule,
 * every caption — and it looks like a filter rather than a design. Worse, the
 * text stops being readable, because nothing in the photograph was chosen to
 * sit under words.
 *
 * So this is two steps that are deliberately separate. `extractPalette` reports
 * what is actually in the image and makes no decisions. `harmonise` decides,
 * and it decides conservatively: the image supplies a *hue*, the palette
 * supplies the discipline, and the roles a blueprint has not opened to the
 * image are left exactly as the theme set them.
 *
 * Readability is never traded for it. Every foreground this produces is checked
 * against the ground it lands on, and when the image's own colour cannot carry
 * text the neutral does.
 */

export type ImagePalette = {
  dominant: string;
  secondary: string;
  accent: string;
  lightNeutral: string;
  darkNeutral: string;
};

/* ------------------------------------------------------------------ colour */

type Hsl = { h: number; s: number; l: number };

export function toHsl(hex: string): Hsl {
  const { r, g, b } = parseHex(hex);
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? ((gg - bb) / d + (gg < bb ? 6 : 0))
    : max === gg ? (bb - rr) / d + 2
      : (rr - gg) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

export function fromHsl({ h, s, l }: Hsl): string {
  if (s === 0) {
    const v = Math.round(l * 255);
    return toHex({ r: v, g: v, b: v, a: 1 });
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  const hue = h / 360;
  return toHex({
    r: Math.round(channel(hue + 1 / 3) * 255),
    g: Math.round(channel(hue) * 255),
    b: Math.round(channel(hue - 1 / 3) * 255),
    a: 1,
  });
}

/* --------------------------------------------------------------- extraction */

/**
 * What is in the picture, with no opinion about what to do with it.
 *
 * Pixels are bucketed by hue and lightness rather than by exact value: a
 * photograph has ten thousand distinct colours and the most *frequent* one is
 * usually a shade of the sky nobody would name. Buckets weighted by saturation
 * find the colour a person would point at.
 *
 * `pixels` is RGBA bytes — whatever decoded the image is somebody else's
 * problem, which is what keeps this testable without one.
 */
export function extractPalette(pixels: Uint8Array | Uint8ClampedArray): ImagePalette {
  const buckets = new Map<string, { count: number; weight: number; r: number; g: number; b: number }>();
  let lightest = { hex: "#FFFFFF", l: -1 };
  let darkest = { hex: "#000000", l: 2 };

  for (let at = 0; at + 3 < pixels.length; at += 4) {
    const alpha = pixels[at + 3] ?? 255;
    if (alpha < 128) continue;
    const r = pixels[at] ?? 0;
    const g = pixels[at + 1] ?? 0;
    const b = pixels[at + 2] ?? 0;
    const hex = toHex({ r, g, b, a: 1 });
    const { h, s, l } = toHsl(hex);

    if (l > lightest.l) lightest = { hex, l };
    if (l < darkest.l) darkest = { hex, l };

    // Near-white and near-black carry no hue worth keeping; they become the
    // neutrals instead of competing to be the dominant colour.
    if (l < 0.08 || l > 0.94) continue;
    const key = `${Math.round(h / 20)}:${Math.round(l * 5)}`;
    const bucket = buckets.get(key) ?? { count: 0, weight: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    // Saturation as the weight: a muddy grey that covers half the frame should
    // not outrank the one saturated thing the photograph is of.
    bucket.weight += 0.15 + s;
    bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  }

  const ranked = [...buckets.values()]
    .sort((a, b) => b.weight - a.weight)
    .map((bucket) => toHex({
      r: Math.round(bucket.r / bucket.count),
      g: Math.round(bucket.g / bucket.count),
      b: Math.round(bucket.b / bucket.count),
      a: 1,
    }));

  const dominant = ranked[0] ?? "#808080";
  const secondary = ranked.find((hex) => hueDistance(hex, dominant) > 25) ?? mix(dominant, "#FFFFFF", 0.35);
  const accent = ranked.find((hex) => hueDistance(hex, dominant) > 90) ?? complement(dominant);

  return {
    dominant,
    secondary,
    accent,
    lightNeutral: lightest.l > 0.8 ? lightest.hex : mix(dominant, "#FFFFFF", 0.9),
    darkNeutral: darkest.l < 0.2 ? darkest.hex : mix(dominant, "#000000", 0.85),
  };
}

function hueDistance(first: string, second: string): number {
  const a = toHsl(first).h;
  const b = toHsl(second).h;
  const raw = Math.abs(a - b);
  return Math.min(raw, 360 - raw);
}

const complement = (hex: string): string => {
  const { h, s, l } = toHsl(hex);
  return fromHsl({ h: (h + 180) % 360, s, l });
};

/* -------------------------------------------------------------- harmonising */

/** How far a colour taken from a photograph is allowed to go. */
const SATURATION = { min: 0.18, max: 0.62 };
const LIGHTNESS = { min: 0.22, max: 0.68 };
/** Below this there is no hue to preserve, only a grey to leave alone. */
const NEUTRAL = 0.06;

/**
 * Pull a colour taken from an image into the range a design can use.
 *
 * A photograph's colours are lit, not chosen: they arrive at saturations that
 * look like a highlighter and lightnesses that cannot hold text. Clamping is
 * what turns "the yellow in this picture" into "a yellow this system would have
 * picked".
 */
export function temper(hex: string): string {
  const { h, s, l } = toHsl(hex);
  const lightness = Math.min(Math.max(l, LIGHTNESS.min), LIGHTNESS.max);

  /**
   * A grey stays grey.
   *
   * The saturation floor exists so a washed-out subject still reads as a
   * colour, and applied blindly it turns a neutral into one: `#FBFBFB` has no
   * hue at all, so hue 0 is used by default and the result is pink. A
   * photograph of concrete should not tint a deck rose.
   */
  if (s < NEUTRAL) return fromHsl({ h, s, l: lightness });

  return fromHsl({
    h,
    s: Math.min(Math.max(s, SATURATION.min), SATURATION.max),
    l: lightness,
  });
}

/**
 * Which roles an image is allowed to touch.
 *
 * Deliberately small, and deliberately not `background` or `text`: the ground a
 * deck is set on and the ink it is set in belong to the theme, not to whichever
 * photograph a slide happened to get. A blueprint can narrow this further; it
 * cannot widen it.
 */
export const IMAGE_ROLES: readonly ColorRole[] = ["accent", "secondary", "primary"];

export type Harmonised = {
  colors: ColorFamily;
  /** Roles the image actually changed, for the studio to show. */
  applied: ColorRole[];
  /** Roles the image was allowed to change but could not, and why. */
  rejected: { role: ColorRole; reason: string }[];
};

/**
 * Fold an image's palette into a theme's, one role at a time, refusing anything
 * that cannot be read.
 *
 * Each candidate is tempered, then checked against the ground the role's text
 * sits on. A role whose ink would fall below 4.5:1 keeps the theme's colour —
 * so the worst case of an unusable photograph is a slide that looks like the
 * theme, which is a good worst case.
 */
export function harmonise(
  theme: ColorFamily,
  image: ImagePalette,
  allowed: readonly ColorRole[] = IMAGE_ROLES,
): Harmonised {
  const colors: ColorFamily = { ...theme };
  const applied: ColorRole[] = [];
  const rejected: { role: ColorRole; reason: string }[] = [];

  const candidates: Partial<Record<ColorRole, string>> = {
    accent: image.accent,
    secondary: image.secondary,
    primary: image.dominant,
  };

  for (const role of allowed) {
    const raw = candidates[role];
    if (!raw) continue;
    const value = temper(raw);

    /**
     * A fill has to be distinguishable from the ground it sits on.
     *
     * There is deliberately no "can it hold text" refusal here, and working out
     * why was worth the detour: for any colour at all, one of black or white
     * clears 4.5:1 against it — the two curves cross around a luminance of 0.18
     * and both sides pass there. So `readableOn` always has an answer, and a
     * check for the case where it does not would be a branch that can never
     * run. What can go wrong is the other thing: an accent so close to the
     * background that it stops being an accent.
     */
    const ink = readableOn(value);
    const againstGround = contrastRatio(value, theme.background);
    if (againstGround < 1.35) {
      rejected.push({ role, reason: `fondan ajralmaydi (${againstGround.toFixed(2)}:1)` });
      continue;
    }

    colors[role] = value;
    if (role === "primary") colors.textOnPrimary = ink;
    if (role === "accent") colors.textOnAccent = ink;
    applied.push(role);
  }

  return { colors, applied, rejected };
}

/**
 * The ink to put on a photograph, and how much veil it needs first.
 *
 * Text over an image is the one place where the picture wins by default and the
 * words lose. This answers with both halves: which ink reads better on this
 * image, and the opacity of the scrim that gets it over the line — 0 when the
 * image is already quiet enough.
 */
export function veilFor(image: ImagePalette, target = 4.5): { ink: string; veil: string; opacity: number } {
  const ground = image.dominant;
  const ink = readableOn(ground);
  const veil = luminance(ink) > 0.5 ? "#000000" : "#FFFFFF";

  for (let opacity = 0; opacity <= 0.85; opacity += 0.05) {
    const veiled = mix(ground, veil, opacity);
    if (contrastRatio(ink, veiled) >= target) {
      return { ink, veil, opacity: Number(opacity.toFixed(2)) };
    }
  }
  return { ink, veil, opacity: 0.85 };
}
