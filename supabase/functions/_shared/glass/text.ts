/**
 * Words, made safe to set and sized to fit.
 *
 * Two jobs, both of them about never shipping a broken page.
 *
 * The first is Uzbek orthography. Models write o‘ and g‘ with whatever
 * apostrophe they last saw — ', `, ʻ, ’ — and most display faces have no glyph
 * for ʻ (U+02BB): measured across the library this design system uses, nine of
 * twelve families draw it as a box. So every string is normalised to the
 * typographic pair every face has: ‘ after o/g, ’ for the tutuq belgisi.
 *
 * The second is fitting. Nothing here measures with a real font — the server
 * has none loaded — so widths are estimated from each face's measured average
 * advance (`FontPick.em`) with per-character corrections, and the estimate is
 * deliberately pessimistic. A box that is a few points too generous looks
 * calm; one that is too tight puts a line under the next element on the
 * phone, which grows text boxes downwards rather than clipping them.
 */

import type { FontPick } from "./dna.ts";
import { CHARSET, METRICS } from "./metrics.ts";

/* ------------------------------------------------------------ orthography */

// An English possessive ("dog's") or "o'clock" is not an Uzbek o‘ or g‘;
// "o‘sish" still is, because its s is followed by a letter.
const OKINA = /([oOgG])['`ʻʼ’‘´](?!s\b)(?!clock)/g;
const TUTUQ = /([A-Za-zÀ-ž])['`ʻʼ´]([A-Za-zÀ-ž])/g;

/** Uzbek Latin with the apostrophes every face can draw. */
export function normalizeUz(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(OKINA, "$1‘")
    .replace(TUTUQ, "$1’$2")
    // A straight double quote reads as inches on a slide.
    .replace(/"([^"\n]{1,200})"/g, "«$1»")
    .replace(/\s+—\s*|\s*—\s+/g, " — ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** One line of plain text: no markdown, no list markers, no stray quotes. */
export function cleanLine(value: unknown, max = 400): string {
  if (typeof value !== "string") return "";
  const text = normalizeUz(
    value
      .replace(/\*\*|__|`/g, "")
      .replace(/^\s*(?:[-*•▪◦]|\d+[.)])\s+/, "")
      .replace(/\s*\n+\s*/g, " "),
  );
  return text.length > max ? clip(text, max) : text;
}

/** Cut at a word boundary and say so, never mid-word. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(1, max - 1));
  const space = cut.lastIndexOf(" ");
  const base = (space > max * 0.55 ? cut.slice(0, space) : cut).replace(/[\s,;:—–-]+$/, "");
  return `${base}…`;
}

/* -------------------------------------------------------------- measuring */

/**
 * Each face's real advance widths, decoded once.
 *
 * Measured from the font files themselves (`metrics.ts`), so a line is known
 * to break exactly where the phone, the browser and the PDF will break it. An
 * average-width estimate was tried first and was out by a fifth on display
 * serifs — enough to put a title's last line on top of the subtitle.
 */
const decoded = new Map<string, Map<string, number>>();

function table(font: FontPick): Map<string, number> {
  const key = `${font.family}|${font.weight}`;
  const cached = decoded.get(key);
  if (cached) return cached;
  const encoded = METRICS[key] ?? METRICS[`Manrope|${font.weight >= 600 ? 700 : 400}`]!;
  const widths = new Map<string, number>();
  for (let index = 0; index < CHARSET.length; index += 1) {
    widths.set(CHARSET[index]!, Number.parseInt(encoded.slice(index * 2, index * 2 + 2), 36) / 1000);
  }
  decoded.set(key, widths);
  return widths;
}

/** Kerning is ignored, which only ever over-estimates; this covers hinting and rounding. */
const SAFETY = 1.035;

export function textWidth(text: string, size: number, font: FontPick, upper = false): number {
  const widths = table(font);
  const average = widths.get("n") ?? 0.5;
  const tracking = font.tracking ?? 0;
  let units = 0;
  let count = 0;
  for (const char of upper ? text.toUpperCase() : text) {
    units += widths.get(char) ?? (/[A-ZÀ-Þ]/.test(char) ? average * 1.25 : average);
    count += 1;
  }
  return units * size * SAFETY + tracking * count;
}

/**
 * A word wider than its line, broken where a reader would break it.
 *
 * Addresses and long compounds have no space to wrap at; left whole, one draws
 * past its box into the next — a bibliography of long links did exactly that.
 * Such a word is split after its last "/", "-", "." or "_" that keeps the piece
 * on the line, or between letters when there is none, and the split is a real
 * line break so every renderer — phone, PDF, PowerPoint — draws the same lines
 * the layout measured.
 */
export function breakLong(text: string, size: number, font: FontPick, width: number, upper = false): string {
  if (width <= 0) return text;
  return text.split("\n").map((paragraph) => paragraph.split(/(\s+)/).map((token) => {
    if (!token || /^\s+$/.test(token) || textWidth(token, size, font, upper) <= width) return token;
    const pieces: string[] = [];
    let rest = token;
    while (rest && textWidth(rest, size, font, upper) > width) {
      let cut = 1;
      while (cut < rest.length && textWidth(rest.slice(0, cut + 1), size, font, upper) <= width) cut += 1;
      // A slash first — it ends a step of an address — then the lesser marks.
      const slash = rest.lastIndexOf("/", cut - 1);
      const soft = slash >= Math.floor(cut / 2) ? slash : Math.max(...["-", ".", "_"].map((mark) => rest.lastIndexOf(mark, cut - 1)));
      if (soft >= Math.floor(cut / 2)) cut = soft + 1;
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest) pieces.push(rest);
    return pieces.join("\n");
  }).join("")).join("\n");
}

/** Greedy wrap, as every renderer does it. */
export function wrap(text: string, size: number, font: FontPick, width: number, upper = false): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (!line || textWidth(next, size, font, upper) <= width) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export type Fitted = {
  text: string;
  size: number;
  lineHeight: number;
  lines: number;
  /** The height the copy actually takes, so the next element can sit under it. */
  height: number;
};

/**
 * The largest size, from `max` down to `min`, at which the copy fits the box.
 *
 * When even `min` will not hold it, the copy is cut at a word boundary to the
 * lines that do fit — a sentence that ends in an ellipsis is a far smaller
 * fault than one that runs into the card below it.
 */
export function fit(input: {
  text: string;
  font: FontPick;
  width: number;
  height: number;
  max: number;
  min: number;
  leading: number;
  upper?: boolean;
  maxLines?: number;
}): Fitted {
  const text = input.text.trim();
  const upper = input.upper ?? false;
  for (let size = input.max; size >= input.min; size -= size > 24 ? 2 : 1) {
    const lineHeight = Math.round(size * input.leading * 10) / 10;
    const lines = wrap(text, size, input.font, input.width, upper);
    const allowed = Math.min(input.maxLines ?? Infinity, Math.floor((input.height + 0.5) / lineHeight));
    // A single word wider than the box would be broken mid-word by the
    // renderer, so it counts as not fitting at this size.
    const tooWide = lines.some((line) => textWidth(line, size, input.font, upper) > input.width + 0.5);
    if (lines.length <= allowed && !tooWide) {
      return { text, size, lineHeight, lines: lines.length, height: Math.round(lines.length * lineHeight * 10) / 10 };
    }
  }

  const size = input.min;
  const lineHeight = Math.round(size * input.leading * 10) / 10;
  const allowed = Math.max(1, Math.min(input.maxLines ?? Infinity, Math.floor((input.height + 0.5) / lineHeight)));
  // At the smallest size a word still too wide is broken rather than drawn past the box.
  const whole = breakLong(text, size, input.font, input.width, upper);
  const words = text.split(/\s+/);
  let kept = words.length;
  let candidate = whole;
  if (wrap(whole, size, input.font, input.width, upper).length > allowed) {
    while (kept > 1) {
      kept -= 1;
      candidate = breakLong(`${words.slice(0, kept).join(" ").replace(/[\s,;:—–-]+$/, "")}…`, size, input.font, input.width, upper);
      if (wrap(candidate, size, input.font, input.width, upper).length <= allowed) break;
    }
  }
  const lines = wrap(candidate, size, input.font, input.width, upper).length;
  return { text: candidate, size, lineHeight, lines, height: Math.round(lines * lineHeight * 10) / 10 };
}

/** The copy at one exact size, cut to `maxLines` if it has to be. */
export function setAt(input: {
  text: string;
  font: FontPick;
  width: number;
  size: number;
  leading: number;
  upper?: boolean;
  maxLines?: number;
}): Fitted & { cut: boolean } {
  const upper = input.upper ?? false;
  const whole = input.text.trim();
  const text = breakLong(whole, input.size, input.font, input.width, upper);
  // A word that had to be broken counts as not fitting, so a caller that can
  // go smaller (fitGroup) does — a word is split only when no size keeps it whole.
  const broken = text !== whole;
  const lineHeight = Math.round(input.size * input.leading * 10) / 10;
  let lines = wrap(text, input.size, input.font, input.width, upper);
  const tooWide = broken || lines.some((line) => textWidth(line, input.size, input.font, upper) > input.width + 0.5);
  if (!text) return { text, size: input.size, lineHeight, lines: 0, height: 0, cut: false };
  if (input.maxLines === undefined || lines.length <= input.maxLines) {
    return { text, size: input.size, lineHeight, lines: lines.length, height: Math.round(lines.length * lineHeight * 10) / 10, cut: tooWide };
  }
  const words = text.split(/\s+/);
  let kept = words.length;
  let candidate = text;
  while (kept > 1) {
    kept -= 1;
    candidate = breakLong(`${words.slice(0, kept).join(" ").replace(/[\s,;:—–-]+$/, "")}…`, input.size, input.font, input.width, upper);
    lines = wrap(candidate, input.size, input.font, input.width, upper);
    if (lines.length <= input.maxLines) break;
  }
  return { text: candidate, size: input.size, lineHeight, lines: lines.length, height: Math.round(lines.length * lineHeight * 10) / 10, cut: true };
}

export type Spec = {
  text: string;
  font: FontPick;
  /** The size at full scale. */
  size: number;
  /** Never smaller than this. */
  min: number;
  leading: number;
  maxLines?: number;
  upper?: boolean;
  /** Space above this piece, in model units, at full scale. */
  gap?: number;
};

export type Placed = Fitted & { gap: number };

/** The height a column of pieces takes. */
export function columnHeight(pieces: readonly Placed[]): number {
  let total = 0;
  let first = true;
  for (const piece of pieces) {
    if (!piece.text) continue;
    total += (first ? 0 : piece.gap) + Math.max(piece.lineHeight, piece.height);
    first = false;
  }
  return Math.round(total * 10) / 10;
}

/**
 * Sizes for a group of siblings — three cards, four tiles — at one scale.
 *
 * Siblings share a type size: a row of cards where one card's copy is set
 * smaller because it happened to be longer reads as a mistake. The scale is
 * the largest at which every sibling's column fits `budget`; only if none does
 * is the longest piece of each column cut, at the smallest sizes.
 */
export function fitGroup(columns: readonly (readonly Spec[])[], width: number, budget: number): { pieces: Placed[][]; scale: number } {
  const at = (scale: number, cut: boolean) => columns.map((specs) => specs.map((spec) => {
    const size = Math.max(spec.min, Math.round(spec.size * scale * 2) / 2);
    const set = setAt({ text: spec.text, font: spec.font, width, size, leading: spec.leading, upper: spec.upper, maxLines: cut ? spec.maxLines : spec.maxLines });
    return { ...set, gap: Math.round((spec.gap ?? 0) * Math.max(scale, 0.75) * 10) / 10 };
  }));

  // Down to each piece's own minimum (sizes never go below `min`) before
  // anything is cut or a word is split.
  const floor = 0.4;
  for (let scale = 1; scale >= floor - 0.001; scale -= 0.05) {
    const pieces = at(scale, false);
    const fits = pieces.every((column) => columnHeight(column) <= budget && column.every((piece) => !(piece as Placed & { cut?: boolean }).cut));
    if (fits) return { pieces, scale };
  }

  // Nothing fits whole: smallest sizes, and the longest piece of each column
  // cut to the lines that remain.
  const pieces = at(floor, false).map((column, index) => {
    const specs = columns[index]!;
    let longest = 0;
    column.forEach((piece, at) => { if (piece.height > (column[longest]?.height ?? 0)) longest = at; });
    const others = columnHeight(column.filter((_, at) => at !== longest));
    const piece = column[longest]!;
    const spec = specs[longest]!;
    const room = Math.max(piece.lineHeight, budget - others - piece.gap);
    const lines = Math.max(1, Math.floor((room + 0.5) / piece.lineHeight));
    const cut = setAt({ text: spec.text, font: spec.font, width, size: piece.size, leading: spec.leading, upper: spec.upper, maxLines: Math.min(lines, spec.maxLines ?? lines) });
    return column.map((one, at) => (at === longest ? { ...cut, gap: one.gap } : one));
  });
  return { pieces, scale: floor };
}
