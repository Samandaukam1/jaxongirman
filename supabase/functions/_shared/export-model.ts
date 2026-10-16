export const MODEL_WIDTH = 1000;
export const MODEL_HEIGHT = 562.5;
export const PPTX_WIDTH = 13.333333;
export const PPTX_HEIGHT = 7.5;

export type ExportFormat = "pdf" | "pptx";
export type JsonObject = Record<string, unknown>;

export type ExportPresentation = {
  id: string;
  owner_id: string;
  title: string;
};

export type ExportSlide = {
  id: string;
  presentation_id: string;
  position: number;
  title: string | null;
  background: unknown;
};

export type ExportElement = {
  id: string;
  slide_id: string;
  presentation_id: string;
  type: "text" | "image" | "shape" | "icon" | "chart" | "table" | "line" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  opacity: number;
  style: unknown;
  content: unknown;
};

export type ExportDeck = {
  presentation: ExportPresentation;
  slides: ExportSlide[];
  elements: ExportElement[];
};

export type Rgba = { red: number; green: number; blue: number; alpha: number };

export function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

export function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function number(value: unknown, fallback: number): number {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isFinite(candidate) ? candidate : fallback;
}

export function boolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function hexByte(value: string): number {
  return Number.parseInt(value, 16);
}

/** Supports every colour spelling the editor accepts: RGB, RGBA, RRGGBB and RRGGBBAA. */
export function rgba(value: unknown, fallback = "#151A18"): Rgba {
  const source = typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value)
    ? value.slice(1)
    : fallback.slice(1);
  const expanded = source.length === 3 || source.length === 4
    ? source.split("").map((part) => part + part).join("")
    : source;
  const withAlpha = expanded.length === 6 ? `${expanded}ff` : expanded.padEnd(8, "f").slice(0, 8);
  return {
    red: hexByte(withAlpha.slice(0, 2)) / 255,
    green: hexByte(withAlpha.slice(2, 4)) / 255,
    blue: hexByte(withAlpha.slice(4, 6)) / 255,
    alpha: hexByte(withAlpha.slice(6, 8)) / 255,
  };
}

export function pptxColor(value: unknown, fallback = "#151A18"): string {
  const parsed = rgba(value, fallback);
  const byte = (part: number) => Math.round(part * 255).toString(16).padStart(2, "0");
  return `${byte(parsed.red)}${byte(parsed.green)}${byte(parsed.blue)}`.toUpperCase();
}

export function transparency(opacity: number, colorAlpha = 1): number {
  return Math.round((1 - clamp(opacity, 0, 1) * clamp(colorAlpha, 0, 1)) * 100);
}

export function inch(value: number): number {
  return value / 75;
}

/** The authored width is 1000 px while a widescreen PPTX is 960 points wide. */
export function fontPoints(value: number): number {
  return Math.max(1, value * 0.96);
}

export function applyTextTransform(text: string, style: JsonObject): string {
  const transform = string(style.textTransform, "none");
  if (transform === "uppercase") return text.toLocaleUpperCase();
  if (transform === "lowercase") return text.toLocaleLowerCase();
  if (transform === "capitalize") return text.replace(/(^|\s)\S/g, (part) => part.toLocaleUpperCase());
  return text;
}

export function isBold(style: JsonObject): boolean {
  const family = string(style.fontFamily);
  const weight = number(style.fontWeight, 400);
  return weight >= 600 || /_(600SemiBold|700Bold|800ExtraBold|900Black)$/.test(family);
}

/** Cross-platform filename: readable, deterministic and free of path/control characters. */
export function safeFileName(title: string, format: ExportFormat): string {
  const stem = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .toLowerCase() || "presentation";
  return `${stem}.${format}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function mimeDataUri(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

export function interpolateHex(from: unknown, to: unknown, progress: number): string {
  const start = rgba(from);
  const finish = rgba(to);
  const at = clamp(progress, 0, 1);
  const byte = (left: number, right: number) =>
    Math.round((left + (right - left) * at) * 255).toString(16).padStart(2, "0");
  return `${byte(start.red, finish.red)}${byte(start.green, finish.green)}${byte(start.blue, finish.blue)}`.toUpperCase();
}


/* --------------------------------------------------------------- gradients */

/** One colour stop, unpacked: six-digit hex, its alpha, and where it sits (0–1). */
export type Stop = { hex: string; alpha: number; at: number };

/**
 * A shape's fill as stops, from either vocabulary.
 *
 * `gradientStops` (with eight-digit hex, so each stop can carry its own
 * alpha) is what the Liquid Glass engine and JSLAYD write; `fill`/`gradientTo`
 * is the older pair. A flat fill comes back as a single stop.
 */
export function stopsOf(style: JsonObject, fallback = "#EEEEEE"): Stop[] {
  const raw = Array.isArray(style.gradientStops) ? style.gradientStops : [];
  const stops = raw
    .map((entry) => object(entry))
    .filter((entry) => typeof entry.color === "string")
    .map((entry) => {
      const color = rgba(entry.color, fallback);
      return { hex: pptxColor(entry.color, fallback), alpha: color.alpha, at: clamp(number(entry.offset, 0) / 100, 0, 1) };
    })
    .sort((left, right) => left.at - right.at);
  if (stops.length >= 2) return stops;
  const fill = rgba(style.fill, fallback);
  const first = { hex: pptxColor(style.fill, fallback), alpha: fill.alpha, at: 0 };
  const to = string(style.gradientTo);
  if (to) return [first, { hex: pptxColor(to, fallback), alpha: rgba(to, fallback).alpha, at: 1 }];
  return [first];
}

/** The colour and alpha a gradient has at `t` (0–1). */
export function colorAt(stops: readonly Stop[], t: number): { hex: string; alpha: number } {
  if (stops.length === 0) return { hex: "EEEEEE", alpha: 1 };
  if (stops.length === 1 || t <= stops[0]!.at) return { hex: stops[0]!.hex, alpha: stops[0]!.alpha };
  for (let index = 1; index < stops.length; index += 1) {
    const right = stops[index]!;
    if (t <= right.at) {
      const left = stops[index - 1]!;
      const span = right.at - left.at || 1;
      const progress = (t - left.at) / span;
      return { hex: interpolateHex(`#${left.hex}`, `#${right.hex}`, progress), alpha: left.alpha + (right.alpha - left.alpha) * progress };
    }
  }
  const last = stops[stops.length - 1]!;
  return { hex: last.hex, alpha: last.alpha };
}

/**
 * A radial gradient as concentric layers a vector format can draw.
 *
 * Neither pdf-lib nor pptxgenjs has a radial fill, so the gradient is drawn as
 * nested ellipses from the rim inwards. Each layer's own alpha is solved so
 * that the layers stacked over any point add up to the gradient's alpha at
 * that radius — `1 − ∏(1 − aᵢ) = A(r)` — which is why a glow exported this way
 * fades the way it does on the phone instead of banding into rings of grey.
 */
export function radialBands(stops: readonly Stop[], steps = 18): { scale: number; hex: string; alpha: number }[] {
  const bands: { scale: number; hex: string; alpha: number }[] = [];
  let covered = 0;
  for (let index = 0; index < steps; index += 1) {
    const scale = 1 - index / steps;
    // Sample in the middle of the ring this layer is the outermost cover for.
    const { hex, alpha } = colorAt(stops, clamp(scale - 0.5 / steps, 0, 1));
    const target = clamp(alpha, 0, 0.999);
    const own = covered >= 0.999 ? 0 : clamp(1 - (1 - target) / (1 - covered), 0, 1);
    if (own > 0.002) bands.push({ scale, hex, alpha: own });
    covered = 1 - (1 - covered) * (1 - own);
  }
  return bands;
}

/**
 * A linear gradient as strips across its direction.
 *
 * Returned in the shape's own unit square: each strip is `[from, to)` along
 * the dominant axis, so a caller lays them across whatever box it is drawing.
 */
export function linearBands(stops: readonly Stop[], angle: number, steps = 24): { vertical: boolean; reverse: boolean; from: number; to: number; hex: string; alpha: number }[] {
  const normal = ((angle % 360) + 360) % 360;
  // CSS angles: 0 points up, 90 right, 180 down. Strips run across the axis
  // the gradient travels along.
  const horizontalTravel = (normal >= 45 && normal < 135) || (normal >= 225 && normal < 315);
  const reverse = horizontalTravel ? normal >= 225 : !(normal >= 135 && normal < 225);
  return Array.from({ length: steps }, (_, index) => {
    const { hex, alpha } = colorAt(stops, (index + 0.5) / steps);
    return { vertical: horizontalTravel, reverse, from: index / steps, to: (index + 1) / steps, hex, alpha };
  });
}

/** A gradient's colour averaged over its length — for exporters that can only fill flat. */
export function averageColor(stops: readonly Stop[]): { hex: string; alpha: number } {
  if (stops.length === 1) return { hex: stops[0]!.hex, alpha: stops[0]!.alpha };
  let red = 0; let green = 0; let blue = 0; let alpha = 0;
  const samples = 12;
  for (let index = 0; index < samples; index += 1) {
    const sample = colorAt(stops, (index + 0.5) / samples);
    const parsed = rgba(`#${sample.hex}`);
    red += parsed.red; green += parsed.green; blue += parsed.blue; alpha += sample.alpha;
  }
  const byte = (value: number) => Math.round((value / samples) * 255).toString(16).padStart(2, "0");
  return { hex: `${byte(red)}${byte(green)}${byte(blue)}`.toUpperCase(), alpha: alpha / samples };
}
