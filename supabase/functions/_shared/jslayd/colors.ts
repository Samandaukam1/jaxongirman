// GENERATED FILE — do not edit by hand.
// Source: packages/jslayd/src/colors.ts
// Regenerate with: node supabase/scripts/build-jslayd-runtime.mjs
//
// The JSLAYD runtime, projected into the Edge tree. Edit the package, not this.

import type { ColorFamily, ColorValue } from "./document.ts";
import { COLOR_ROLES, type ColorRole } from "./spec.ts";

/** RGB in 0–255 plus alpha in 0–1, parsed from the canonical `#RRGGBB[AA]`. */
export type Rgba = { r: number; g: number; b: number; a: number };

export function parseHex(value: string): Rgba {
  const body = value.replace("#", "");
  const expanded = body.length <= 4 ? body.split("").map((part) => part + part).join("") : body;
  const byte = (start: number) => Number.parseInt(expanded.slice(start, start + 2), 16);
  return {
    r: byte(0) || 0,
    g: byte(2) || 0,
    b: byte(4) || 0,
    a: expanded.length >= 8 ? (byte(6) || 0) / 255 : 1,
  };
}

export function toHex({ r, g, b, a }: Rgba): string {
  const byte = (part: number) => Math.round(Math.min(255, Math.max(0, part))).toString(16).padStart(2, "0").toUpperCase();
  const alpha = a >= 1 ? "" : byte(a * 255);
  return `#${byte(r)}${byte(g)}${byte(b)}${alpha}`;
}

/** WCAG relative luminance. Drives contrast checks and every derived role. */
export function luminance(value: string): number {
  const { r, g, b } = parseHex(value);
  const channel = (part: number) => {
    const scaled = part / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Whichever of black or white reads better on `background`. */
export function readableOn(background: string): string {
  return contrastRatio(background, "#FFFFFF") >= contrastRatio(background, "#000000") ? "#FFFFFF" : "#000000";
}

export function mix(from: string, to: string, amount: number): string {
  const start = parseHex(from);
  const finish = parseHex(to);
  const at = Math.min(1, Math.max(0, amount));
  return toHex({
    r: start.r + (finish.r - start.r) * at,
    g: start.g + (finish.g - start.g) * at,
    b: start.b + (finish.b - start.b) * at,
    a: start.a + (finish.a - start.a) * at,
  });
}

/**
 * Fills the roles the author did not write.
 *
 * Every derivation is a pure function of the seven required roles, so a design
 * that names only those compiles to the same fourteen every time — the author
 * is spared the bookkeeping and the renderer never meets an absent role. The
 * `textOn*` roles are chosen for legibility rather than taste, which is the one
 * decision a design should not be allowed to get wrong (§94).
 */
export function deriveColorFamily(
  authored: Partial<Record<ColorRole, string>>,
): ColorFamily {
  const background = authored.background ?? "#FFFFFF";
  const surface = authored.surface ?? mix(background, readableOn(background), 0.04);
  const primary = authored.primary ?? "#111111";
  const secondary = authored.secondary ?? mix(primary, background, 0.7);
  const accent = authored.accent ?? primary;
  const text = authored.text ?? readableOn(background);
  const muted = authored.muted ?? mix(text, background, 0.45);

  return {
    background,
    surface,
    surfaceAlt: authored.surfaceAlt ?? mix(surface, text, 0.07),
    contrast: authored.contrast ?? (luminance(background) > 0.5 ? mix(text, "#000000", 0.2) : mix(background, "#000000", 0.6)),
    primary,
    secondary,
    accent,
    text,
    textSecondary: authored.textSecondary ?? muted,
    textOnPrimary: authored.textOnPrimary ?? readableOn(primary),
    textOnAccent: authored.textOnAccent ?? readableOn(accent),
    textOnContrast: authored.textOnContrast ?? readableOn(authored.contrast ?? "#111111"),
    muted,
    border: authored.border ?? mix(background, text, 0.14),
  };
}

/** A `ColorValue` resolved against a family. Literals pass through unchanged. */
export function resolveColor(value: ColorValue, family: ColorFamily): string {
  return "role" in value ? family[value.role] : value.hex;
}

/**
 * Chart colours for a series of `count` values (§35).
 *
 * When the data outruns the palette the extension is deterministic — each extra
 * colour is the palette entry it wraps onto, lightened or darkened by a fixed
 * step away from the background. Two renders of the same deck therefore agree,
 * which a random or hash-based choice could never guarantee.
 */
export function extendChartPalette(palette: readonly string[], count: number, background: string): string[] {
  if (palette.length === 0) return Array.from({ length: count }, () => "#888888");
  const towards = luminance(background) > 0.5 ? "#000000" : "#FFFFFF";
  return Array.from({ length: count }, (_, index) => {
    const base = palette[index % palette.length]!;
    const lap = Math.floor(index / palette.length);
    return lap === 0 ? base : mix(base, towards, Math.min(0.62, lap * 0.22));
  });
}

export function isColorRole(value: string): value is ColorRole {
  return (COLOR_ROLES as readonly string[]).includes(value);
}
