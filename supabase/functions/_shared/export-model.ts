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

