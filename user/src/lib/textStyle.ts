import type { Json } from "@jaxongirman/types";
import type { TextStyle } from "react-native";

/**
 * The text style vocabulary shared by the canvas renderer and the editor
 * toolbar. Both read from the same helpers so a toggle in the toolbar always
 * lights up for exactly the styles the canvas draws.
 */

export type StyleBag = { [key: string]: Json | undefined };

export function str(value: Json | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function num(value: Json | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function bag(value: Json | undefined): StyleBag {
  return value && typeof value === "object" && !Array.isArray(value) ? value as StyleBag : {};
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export type FontOption = {
  key: string;
  label: string;
  /** Every concrete font name of this family starts with this prefix. */
  prefix: string;
  regular: string;
  bold: string;
};

const MANROPE: FontOption = { key: "manrope", label: "Manrope", prefix: "Manrope", regular: "Manrope_400Regular", bold: "Manrope_700Bold" };

/** The four voices loaded in app/_layout.tsx — nothing else can render. */
export const FONTS: FontOption[] = [
  MANROPE,
  { key: "league", label: "League Spartan", prefix: "LeagueSpartan", regular: "LeagueSpartan_700Bold", bold: "LeagueSpartan_800ExtraBold" },
  { key: "arimo", label: "Arimo", prefix: "Arimo", regular: "Arimo_400Regular", bold: "Arimo_700Bold" },
  { key: "pinyon", label: "Pinyon Script", prefix: "PinyonScript", regular: "PinyonScript_400Regular", bold: "PinyonScript_400Regular" },
];

export const DEFAULT_FONT_SIZE = 30;

/** The concrete font name a text element renders with, defaults included. */
export function fontNameOf(style: StyleBag): string {
  const explicit = str(style.fontFamily);
  if (explicit) return explicit;
  return str(style.fontWeight) === "700" ? "Manrope_700Bold" : "Manrope_400Regular";
}

export function fontOptionOf(style: StyleBag): FontOption {
  const name = fontNameOf(style);
  return FONTS.find((font) => name.startsWith(font.prefix)) ?? MANROPE;
}

/** League Spartan's lightest cut is already named Bold, so the family's own
 *  regular/bold pair decides before the weight suffix does. */
export function isBoldStyle(style: StyleBag): boolean {
  const name = fontNameOf(style);
  const option = fontOptionOf(style);
  if (name === option.regular) return false;
  if (name === option.bold) return true;
  return /_(600SemiBold|700Bold|800ExtraBold|900Black)$/.test(name);
}

export function withFont(style: StyleBag, option: FontOption, bold: boolean): StyleBag {
  return { ...style, fontFamily: bold ? option.bold : option.regular, fontWeight: bold ? "700" : "400" };
}

export function isItalic(style: StyleBag): boolean {
  return style.fontStyle === "italic";
}

export function isUnderline(style: StyleBag): boolean {
  return style.underline === true || str(style.textDecoration).includes("underline");
}

export function isStrikethrough(style: StyleBag): boolean {
  return style.strikethrough === true || str(style.textDecoration).includes("line-through");
}

export function decorationOf(style: StyleBag): TextStyle["textDecorationLine"] {
  const underline = isUnderline(style);
  const strike = isStrikethrough(style);
  if (underline && strike) return "underline line-through";
  if (underline) return "underline";
  if (strike) return "line-through";
  return "none";
}

export const ALIGNMENTS = ["left", "center", "right", "justify"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

export function alignmentOf(style: StyleBag): Alignment {
  const value = str(style.textAlign, "left");
  return (ALIGNMENTS as readonly string[]).includes(value) ? value as Alignment : "left";
}

export function nextAlignment(current: Alignment): Alignment {
  return ALIGNMENTS[(ALIGNMENTS.indexOf(current) + 1) % ALIGNMENTS.length] ?? "left";
}

export const TEXT_CASES = ["none", "uppercase", "lowercase"] as const;
export type TextCase = (typeof TEXT_CASES)[number];

export function textCaseOf(style: StyleBag): TextCase {
  const value = str(style.textTransform, "none");
  return (TEXT_CASES as readonly string[]).includes(value) ? value as TextCase : "none";
}

export function nextTextCase(current: TextCase): TextCase {
  return TEXT_CASES[(TEXT_CASES.indexOf(current) + 1) % TEXT_CASES.length] ?? "none";
}

export const TEXT_EFFECTS = [
  { key: "none", label: "Yo‘q" },
  { key: "shadow", label: "Soya" },
  { key: "glow", label: "Nur" },
  { key: "lift", label: "Ko‘tarish" },
] as const;

export type TextEffect = (typeof TEXT_EFFECTS)[number]["key"];

export function effectOf(style: StyleBag): TextEffect {
  const value = str(style.textEffect, "none");
  return TEXT_EFFECTS.some((effect) => effect.key === value) ? value as TextEffect : "none";
}

/** Effects are drawn with the platform text shadow, so they survive export. */
export function effectTextStyle(effect: TextEffect, color: string): TextStyle {
  if (effect === "shadow") return { textShadowColor: "rgba(0,0,0,.45)", textShadowOffset: { width: 2, height: 3 }, textShadowRadius: 3 };
  if (effect === "glow") return { textShadowColor: color, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16 };
  if (effect === "lift") return { textShadowColor: "rgba(0,0,0,.32)", textShadowOffset: { width: 0, height: 7 }, textShadowRadius: 12 };
  return {};
}

/** Line height is stored absolute; the ratio is what the user actually edits. */
export function lineHeightRatio(style: StyleBag): number {
  const size = num(style.fontSize, DEFAULT_FONT_SIZE) || DEFAULT_FONT_SIZE;
  return round(num(style.lineHeight, size * 1.2) / size, 2);
}

export function withFontSize(style: StyleBag, size: number): StyleBag {
  const ratio = lineHeightRatio(style);
  const next = Math.max(4, round(size, 1));
  return { ...style, fontSize: next, lineHeight: round(next * ratio, 1) };
}

/**
 * Below one em the platform clips the ascenders of the first line, so this is
 * the tightest leading that still draws every glyph in full.
 */
export const MIN_LINE_HEIGHT_RATIO = 1;

export function withLineHeightRatio(style: StyleBag, ratio: number): StyleBag {
  const size = num(style.fontSize, DEFAULT_FONT_SIZE);
  return { ...style, lineHeight: round(size * Math.max(MIN_LINE_HEIGHT_RATIO, Math.min(3, ratio)), 1) };
}

export const VERTICAL_ALIGNS = ["top", "center", "bottom"] as const;
export type VerticalAlign = (typeof VERTICAL_ALIGNS)[number];

const JUSTIFY: Record<VerticalAlign, "flex-start" | "center" | "flex-end"> = {
  top: "flex-start",
  center: "center",
  bottom: "flex-end",
};

/** Text sits centred inside its box unless a template asks otherwise, so a
 *  resized frame keeps the type where the selection outline says it is. */
export function verticalAlignOf(style: StyleBag): "flex-start" | "center" | "flex-end" {
  const value = str(style.verticalAlign, "center");
  return JUSTIFY[value as VerticalAlign] ?? "center";
}

/** Perceived lightness, used to pick ink that reads on the current slide. */
export function isDarkColor(hex: string): boolean {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((char) => char + char).join("") : value.slice(0, 6);
  if (full.length < 6) return false;
  const red = Number.parseInt(full.slice(0, 2), 16);
  const green = Number.parseInt(full.slice(2, 4), 16);
  const blue = Number.parseInt(full.slice(4, 6), 16);
  if (![red, green, blue].every(Number.isFinite)) return false;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 140;
}

/** Corner handles scale the whole type block, not just its box. */
export function scaleTextStyle(style: StyleBag, factor: number): StyleBag {
  const size = num(style.fontSize, DEFAULT_FONT_SIZE);
  const next: StyleBag = { ...style, fontSize: Math.max(4, round(size * factor, 1)) };
  if (typeof style.lineHeight === "number") next.lineHeight = round(style.lineHeight * factor, 1);
  if (typeof style.letterSpacing === "number") next.letterSpacing = round(style.letterSpacing * factor, 2);
  return next;
}

export const BULLET = "•  ";

export function hasBullets(text: string): boolean {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  return lines.length > 0 && lines.every((line) => line.trimStart().startsWith("•"));
}

export function toggleBullets(text: string): string {
  const remove = hasBullets(text);
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed.length) return line;
      return remove ? trimmed.replace(/^•\s*/, "") : BULLET + trimmed;
    })
    .join("\n");
}

/** Neutral swatches that read on both light and dark slides. */
export const BASE_SWATCHES = [
  "#FFFFFF", "#F1EDF9", "#9189A6", "#5B5270", "#150E24", "#000000",
  "#6C34C9", "#8B5CF6", "#C7B2F3", "#1D4ED8", "#0F9D74", "#B4690E", "#C43552", "#E8B4C8",
];

const COLOR_KEYS = ["color", "fill", "gradientTo", "stroke", "labelColor", "trackColor"] as const;

/** Colours already on the slide, so recolouring stays inside the deck's palette. */
export function slideSwatches(background: Json | undefined, styles: StyleBag[]): string[] {
  const seen: string[] = [];
  const push = (value: Json | undefined) => {
    if (typeof value !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(value)) return;
    const hex = value.toUpperCase();
    if (!seen.includes(hex)) seen.push(hex);
  };
  push(bag(background).color);
  for (const style of styles) {
    for (const key of COLOR_KEYS) push(style[key]);
  }
  return seen.slice(0, 12);
}

/** 47.9 → "47,9" and 48 → "48", matching how sizes read in the toolbar. */
export function formatSize(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}
