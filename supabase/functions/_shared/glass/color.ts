/**
 * Colour, computed rather than chosen.
 *
 * Every palette the Liquid Glass engine draws with is generated at generation
 * time from a hue and a mood, in OKLCH: a space where "the same lightness" is
 * the same lightness to an eye, so a violet and a yellow built at L=0.7 really
 * do sit at one level, and a harmony rotated round the wheel stays a harmony.
 * HSL cannot promise that — its yellows glow and its blues sink — which is why
 * palettes built in it need a designer to fix them afterwards. These do not.
 *
 * Legibility is checked, not hoped for: ink and accents are walked in
 * lightness until they clear WCAG contrast against the ground they sit on.
 */

export type Oklch = { l: number; c: number; h: number };

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** OKLCH → linear sRGB, per Björn Ottosson's reference matrices. */
function toLinear({ l, c, h }: Oklch): [number, number, number] {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

const inGamut = (rgb: [number, number, number]) => rgb.every((channel) => channel >= -0.0005 && channel <= 1.0005);

const encode = (linear: number) => {
  const value = clamp(linear);
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
};

/**
 * The colour as hex, pulled into gamut by losing chroma rather than hue.
 *
 * A saturated teal asked for at a lightness sRGB cannot show would otherwise be
 * clipped channel by channel and come out a different hue. Reducing chroma
 * keeps it the same teal, a little quieter.
 */
export function oklch(l: number, c: number, h: number): string {
  let chroma = Math.max(0, c);
  let rgb = toLinear({ l: clamp(l), c: chroma, h });
  for (let step = 0; step < 24 && !inGamut(rgb); step += 1) {
    chroma *= 0.88;
    rgb = toLinear({ l: clamp(l), c: chroma, h });
  }
  return `#${rgb.map((channel) => Math.round(encode(channel) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Eight-digit hex, which every renderer in this product reads as colour plus alpha. */
export function alpha(hex: string, value: number): string {
  const body = hex.replace("#", "").slice(0, 6);
  return `#${body}${Math.round(clamp(value) * 255).toString(16).padStart(2, "0")}`.toUpperCase();
}

export function rgbOf(hex: string): [number, number, number] {
  const body = hex.replace("#", "");
  return [0, 2, 4].map((start) => Number.parseInt(body.slice(start, start + 2), 16) / 255) as [number, number, number];
}

/** Composite a translucent colour over an opaque one. */
export function over(top: string, base: string): string {
  const body = top.replace("#", "");
  const a = body.length >= 8 ? Number.parseInt(body.slice(6, 8), 16) / 255 : 1;
  const [r1, g1, b1] = rgbOf(top);
  const [r2, g2, b2] = rgbOf(base);
  const mix = (x: number, y: number) => Math.round((x * a + y * (1 - a)) * 255).toString(16).padStart(2, "0");
  return `#${mix(r1, r2)}${mix(g1, g2)}${mix(b1, b2)}`.toUpperCase();
}

export function luminance(hex: string): number {
  const channel = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgbOf(hex).map(channel) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The colour at this hue and chroma, at the lightness nearest `l` that clears
 * `ratio` against every one of `grounds`.
 *
 * Walks towards white on a dark ground and towards black on a light one, so
 * the answer is the least change that makes it legible.
 */
export function legible(input: { l: number; c: number; h: number; grounds: string[]; ratio: number; dark: boolean }): string {
  let lightness = input.l;
  for (let step = 0; step < 60; step += 1) {
    const candidate = oklch(lightness, input.c, input.h);
    if (input.grounds.every((ground) => contrast(candidate, ground) >= input.ratio)) return candidate;
    lightness = input.dark ? lightness + 0.01 : lightness - 0.01;
    if (lightness > 0.995 || lightness < 0.04) break;
  }
  return input.dark ? "#FFFFFF" : "#111111";
}

/** Hue arithmetic that stays on the wheel. */
export const turn = (hue: number, by: number) => (((hue + by) % 360) + 360) % 360;

/**
 * A seeded generator, so a deck's design is reproducible from its seed and two
 * slides of one deck draw from one sequence rather than from `Math.random`.
 */
export function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** A small, stable hash of a string. */
export function hashOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
