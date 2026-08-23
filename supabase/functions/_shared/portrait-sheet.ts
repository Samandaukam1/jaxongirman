/**
 * Nine 3×4 photographs on one A6 sheet, laid out to be cut apart.
 *
 * Every number here is a physical measurement, and that is the whole reason
 * this file exists separately from the code that draws it. A print sheet is
 * wrong in a way a screen never is: nobody notices until it comes out of a
 * printer and the photographs are four per cent too small for the form they
 * were cut for, which is a wasted trip rather than a bug report.
 *
 * So the geometry is arithmetic, in one place, with tests — and the drawing is
 * left to say `drawImage(x, y, w, h)`.
 *
 * The standard is 30 × 40 mm on A6, which is 105 × 148 mm. Three by three fits
 * with room for a cutting margin; four across does not fit at all.
 */

/** PostScript points per millimetre. A point is 1/72 inch. */
export const PT_PER_MM = 72 / 25.4;

export const mm = (value: number): number => value * PT_PER_MM;

export const SHEET = { widthMm: 105, heightMm: 148 } as const;
export const PHOTO = { widthMm: 30, heightMm: 40 } as const;
export const GRID = { columns: 3, rows: 3 } as const;

/** The gap between photographs — enough for a blade, not enough to waste paper. */
const GUTTER_MM = 3;

/**
 * What a photograph must be to survive printing.
 *
 * 300 dots per inch is the floor for anything a person hands to an office. At
 * 30 × 40 mm that is 354 × 472 pixels, and below it the print is visibly soft —
 * which on an identity photograph reads as a bad photograph rather than as a
 * bad print.
 */
export const MIN_PIXELS = {
  width: Math.ceil((PHOTO.widthMm / 25.4) * 300),
  height: Math.ceil((PHOTO.heightMm / 25.4) * 300),
} as const;

export type Slot = { x: number; y: number; width: number; height: number };

/**
 * Where each photograph goes, in PDF points from the bottom-left.
 *
 * Centred as a block rather than pinned to a margin: a sheet that is even on
 * all four sides can be cut from any edge, and the trimmed-off strip is the
 * same width wherever the paper was fed slightly crooked.
 */
export function slots(): Slot[] {
  const photoWidth = mm(PHOTO.widthMm);
  const photoHeight = mm(PHOTO.heightMm);
  const gutter = mm(GUTTER_MM);

  const blockWidth = GRID.columns * photoWidth + (GRID.columns - 1) * gutter;
  const blockHeight = GRID.rows * photoHeight + (GRID.rows - 1) * gutter;
  const left = (mm(SHEET.widthMm) - blockWidth) / 2;
  const bottom = (mm(SHEET.heightMm) - blockHeight) / 2;

  const out: Slot[] = [];
  for (let row = 0; row < GRID.rows; row += 1) {
    for (let column = 0; column < GRID.columns; column += 1) {
      out.push({
        x: left + column * (photoWidth + gutter),
        // Rows fill from the top, because that is the order a person reads a
        // sheet and the order they will cut it.
        y: bottom + (GRID.rows - 1 - row) * (photoHeight + gutter),
        width: photoWidth,
        height: photoHeight,
      });
    }
  }
  return out;
}

export type SourceProblem =
  | { code: "too_small"; message: string }
  | { code: "not_portrait"; message: string };

export type SourceCheck = {
  /** Fatal: the sheet is not worth printing. */
  problems: SourceProblem[];
  /** Worth saying, not worth refusing over. */
  warnings: string[];
};

/**
 * Whether this picture can become a printed identity photograph.
 *
 * Two refusals and one warning, deliberately. Resolution below 300 dpi and a
 * landscape picture are both certain failures — the first prints soft, the
 * second has to lose most of its width. An aspect that is portrait but not 3:4
 * is neither: the picture is cropped from the centre, which is where a head
 * is, and the person is told what will be trimmed so they can send a better one
 * if it matters.
 *
 * What this cannot do is tell whether the crop cuts a chin off. That needs to
 * see the face, and nothing in this stack does. Saying so is better than a
 * check that silently passes everything.
 */
export function checkSource(width: number, height: number): SourceCheck {
  const problems: SourceProblem[] = [];
  const warnings: string[] = [];

  if (height <= width) {
    problems.push({
      code: "not_portrait",
      message: "Rasm bo‘yiga (portret) bo‘lishi kerak. Eniga olingan rasmdan hujjat rasmi chiqmaydi.",
    });
  }

  if (width < MIN_PIXELS.width || height < MIN_PIXELS.height) {
    problems.push({
      code: "too_small",
      message: `Rasm juda kichik: ${width}×${height}. Chop etish uchun eng kamida `
        + `${MIN_PIXELS.width}×${MIN_PIXELS.height} kerak.`,
    });
  }

  const wanted = PHOTO.widthMm / PHOTO.heightMm;
  const actual = width / height;
  if (height > width && Math.abs(actual - wanted) > 0.06) {
    const trimmed = actual > wanted
      ? `chap va o‘ng chekkalaridan ${Math.round((1 - wanted / actual) * 100)}%`
      : `yuqori va quyi chekkalaridan ${Math.round((1 - actual / wanted) * 100)}%`;
    warnings.push(`Rasm nisbati 3:4 emas — markazidan kesiladi, ${trimmed} qirqiladi.`);
  }

  return { problems, warnings };
}

/**
 * The part of the source to draw, so it fills the slot without stretching.
 *
 * Returns the crop in source pixels. Centred: an identity photograph has the
 * head in the middle, and any other choice needs to know where the face is.
 */
export function coverCrop(width: number, height: number): { x: number; y: number; width: number; height: number } {
  const wanted = PHOTO.widthMm / PHOTO.heightMm;
  const actual = width / height;
  if (Math.abs(actual - wanted) < 0.0001) return { x: 0, y: 0, width, height };

  if (actual > wanted) {
    const cropped = Math.round(height * wanted);
    return { x: Math.round((width - cropped) / 2), y: 0, width: cropped, height };
  }
  const cropped = Math.round(width / wanted);
  return { x: 0, y: Math.round((height - cropped) / 2), width, height: cropped };
}
