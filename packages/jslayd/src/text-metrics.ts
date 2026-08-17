import type { TextStyle } from "./document.ts";

/**
 * How much copy fits in a box, estimated from the type it is set in.
 *
 * Deliberately rough. A real answer needs the font's own advance widths, and
 * the renderer already has a shrink pass for the cases this misses — what this
 * is for is telling a writer how much to write *before* anything is written,
 * which is the difference between a slide composed for its copy and a slide
 * with the copy squeezed into it afterwards.
 *
 * Lived in `analyze.ts` first, where it decided whether a design had a block
 * too small to hold anything. It moved here when the writing side needed the
 * same number: two estimates of the same thing drift, and then the design
 * checker and the writer disagree about what fits.
 */

/**
 * Mean glyph advance as a fraction of font size.
 *
 * 0.53 is close for Latin text in the humanist sans faces these designs use.
 * It is wrong for a line of capital Ws and wrong the other way for `illi`,
 * which is why nothing downstream treats the result as exact.
 */
export const GLYPH_RATIO = 0.53;

/**
 * Uzbek runs longer than English for the same meaning.
 *
 * Agglutination is most of it: one English preposition becomes a suffix, and
 * `imkoniyatlaridan` is a single word where English would spend three shorter
 * ones. Measured across the deck copy in this repo it lands around 12% more
 * characters, so a budget written for English and handed to an Uzbek writer
 * asks for text that will not fit.
 *
 * Applied to the *budget*, never to the capacity: the box holds what the box
 * holds. This only changes how much of it a writer is asked to aim for.
 */
const LANGUAGE_DENSITY = { uz: 0.88, ru: 0.90, en: 1 } as const;

export function densityFor(language: string | null | undefined): number {
  const code = (language ?? "uz").slice(0, 2).toLowerCase();
  if (code === "en") return LANGUAGE_DENSITY.en;
  if (code === "ru") return LANGUAGE_DENSITY.ru;
  return LANGUAGE_DENSITY.uz;
}

/** Characters that fit on one line at this size. */
export function charactersPerLine(width: number, style: Pick<TextStyle, "fontSize">): number {
  return Math.max(1, Math.floor(width / Math.max(1, style.fontSize * GLYPH_RATIO)));
}

/** Lines that fit in this height, capped by the style's own `maxLines`. */
export function linesThatFit(height: number, style: Pick<TextStyle, "fontSize" | "lineHeight" | "maxLines">): number {
  const fits = Math.max(1, Math.floor(height / Math.max(1, style.fontSize * style.lineHeight)));
  return Math.min(fits, style.maxLines ?? fits);
}

/** Rough character budget at the declared size. */
export function characterCapacity(
  width: number,
  height: number,
  style: Pick<TextStyle, "fontSize" | "lineHeight" | "maxLines">,
): number {
  return charactersPerLine(width, style) * linesThatFit(height, style);
}

/** Characters per cell in a table column, at the table's own cell size. */
export function cellCapacity(columnWidth: number, padding: number, cellSize: number): number {
  return Math.floor((columnWidth - padding * 2) / (cellSize * GLYPH_RATIO));
}
