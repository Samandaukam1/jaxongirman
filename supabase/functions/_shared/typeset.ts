/**
 * The page layout of a document: where every word lands on every page.
 *
 * One layout feeds two pictures of the same document — the PDF someone
 * downloads, and the A4 preview the app draws before they do — so a line
 * breaks in the preview exactly where it breaks in the file. That is the
 * whole point of a preview: one that wraps differently from the document is
 * a picture of a different document.
 *
 * It sets what an academic paper needs and no more: paragraphs justified or
 * aligned, a first-line or a hanging indent, line spacing as a multiple of
 * single, space before and after, a heading kept with what follows it,
 * superscripts, tables whose header row repeats on a new page, images, page
 * breaks, and a page number at the foot.
 *
 * Pure. Text is measured by a function the caller supplies — the PDF's own
 * embedded faces on the server — so the layout is the font's, not a guess.
 * Units are points, with y measured down from the top of the page; a text
 * item's y is its baseline.
 */

import type { Block, Paragraph, Run, Table } from "./docx.ts";

export type Face = { bold: boolean; italic: boolean };
export type Measure = (text: string, size: number, face: Face) => number;
export type PageGeometry = { widthCm: number; heightCm: number; marginCm: { top: number; right: number; bottom: number; left: number } };

export type TextItem = { kind: "text"; x: number; y: number; size: number; text: string; bold?: boolean; italic?: boolean; link?: string };
export type Item =
  | TextItem
  | { kind: "box"; x: number; y: number; width: number; height: number }
  | { kind: "image"; x: number; y: number; width: number; height: number; index: number };
export type TypesetPage = { items: Item[] };
export type Typeset = { width: number; height: number; pages: TypesetPage[] };

export const PT_PER_CM = 72 / 2.54;
/** Single spacing in Word for a Times-metric face: ascent, descent and gap, as a share of the size. */
export const LINE_FACTOR = 1.15;
const SUPERSCRIPT = { scale: 0.62, rise: 0.36 };
const CELL_PAD = 4;
const twips = (value: number) => value / 20;

type Token = { text: string; width: number; size: number; bold: boolean; italic: boolean; link?: string; rise: number; space: boolean };
type Line = { tokens: Token[]; width: number; hard: boolean; size: number };
/** One laid-out line, relative to the box it sits in: items by x from the box's left, y from the line's top. */
type PlacedLine = { height: number; items: TextItem[] };

/* -------------------------------------------------------------- one line */

function tokens(runs: readonly Run[], base: number, measure: Measure): (Token | "break")[] {
  const out: (Token | "break")[] = [];
  for (const run of runs) {
    const size0 = run.size ?? base;
    const size = run.superscript ? size0 * SUPERSCRIPT.scale : size0;
    const rise = run.superscript ? size0 * SUPERSCRIPT.rise : 0;
    const face = { bold: Boolean(run.bold), italic: Boolean(run.italic) };
    run.text.split("\n").forEach((part, index) => {
      if (index > 0) out.push("break");
      for (const piece of part.split(/(\s+)/)) {
        if (!piece) continue;
        const space = !piece.trim();
        const text = space ? " " : piece;
        out.push({ text, width: measure(text, size, face), size, bold: face.bold, italic: face.italic, link: run.link, rise, space });
      }
    });
  }
  return out;
}

/**
 * Greedy breaking: as many words as fit. A word longer than the whole line
 * goes on a line of its own rather than vanishing — a URL in a bibliography
 * is the usual one.
 */
function breakLines(runs: readonly Run[], base: number, first: number, rest: number, measure: Measure): Line[] {
  const lines: Line[] = [];
  let current: Token[] = [];
  let used = 0;
  const close = (hard: boolean) => {
    while (current.length && current[current.length - 1]!.space) current.pop();
    const size = current.reduce((max, token) => Math.max(max, token.rise ? 0 : token.size), 0) || base;
    lines.push({ tokens: current, width: current.reduce((sum, token) => sum + token.width, 0), hard, size });
    current = [];
    used = 0;
  };
  for (const token of tokens(runs, base, measure)) {
    if (token === "break") { close(true); continue; }
    const room = lines.length === 0 ? first : rest;
    if (token.space) {
      if (used === 0) continue;
      current.push(token);
      used += token.width;
      continue;
    }
    // Punctuation glued to the word before it stays with it.
    if (used + token.width > room && used > 0) close(false);
    current.push(token);
    used += token.width;
  }
  if (current.length > 0 || lines.length === 0) close(true);
  // The paragraph's last line is never stretched.
  lines[lines.length - 1]!.hard = true;
  return lines;
}

/** A paragraph's lines, set inside a box `width` wide. */
function placeParagraph(block: Paragraph, base: number, width: number, measure: Measure): PlacedLine[] {
  const indentFirst = block.hanging ? 0 : (block.indent ?? 0) * PT_PER_CM;
  const indentRest = block.hanging ? block.hanging * PT_PER_CM : 0;
  const bold = Boolean(block.style);
  const runs = block.runs.map((run) => (bold ? { ...run, bold: true } : run));
  const spacing = (block.lineSpacing ?? 1) * LINE_FACTOR;
  const lines = breakLines(runs, base, width - indentFirst, width - indentRest, measure);

  return lines.map((line, index) => {
    const left = index === 0 ? indentFirst : indentRest;
    const room = width - left;
    const height = line.size * spacing;
    // The descent sits at the foot of the line; extra spacing goes above, as Word puts it.
    const baseline = height - line.size * 0.26;
    const gaps = line.tokens.filter((token) => token.space).length;
    const stretch = block.align === "both" && !line.hard && gaps > 0 ? (room - line.width) / gaps : 0;
    let x = left;
    if (block.align === "center") x = left + (room - line.width) / 2;
    else if (block.align === "right") x = left + room - line.width;

    const items: TextItem[] = [];
    for (const token of line.tokens) {
      if (token.space) { x += token.width + stretch; continue; }
      items.push({
        kind: "text", x, y: baseline - token.rise, size: token.size, text: token.text,
        ...(token.bold ? { bold: true } : {}), ...(token.italic ? { italic: true } : {}), ...(token.link ? { link: token.link } : {}),
      });
      x += token.width;
    }
    return { height, items };
  });
}

/* ------------------------------------------------------------- the sheet */

class Sheet {
  pages: TypesetPage[] = [];
  y = 0;
  constructor(private readonly top: number, private readonly bottom: number) { this.fresh(); }
  get page(): TypesetPage { return this.pages[this.pages.length - 1]!; }
  get empty(): boolean { return this.page.items.length === 0; }
  get limit(): number { return this.bottom; }
  fresh(): void { this.pages.push({ items: [] }); this.y = this.top; }
  fits(height: number): boolean { return this.y + height <= this.bottom + 0.01; }
  ensure(height: number): void { if (!this.fits(height) && !this.empty) this.fresh(); }
}

function cellHeight(blocks: readonly Block[], base: number, width: number, measure: Measure): number {
  let height = CELL_PAD * 2;
  for (const block of blocks) {
    if (block.kind === "paragraph") {
      height += placeParagraph(block, base, width - CELL_PAD * 2, measure).reduce((sum, line) => sum + line.height, 0) + (block.spaceAfter ?? 0);
    } else if (block.kind === "image") {
      height += block.heightCm * PT_PER_CM;
    }
  }
  return height;
}

function drawRow(
  sheet: Sheet, row: Table["rows"][number], widths: number[], height: number, left: number, borders: boolean, base: number, measure: Measure,
): void {
  let x = left;
  row.cells.forEach((cell, index) => {
    const cellWidth = widths[index]!;
    if (borders) sheet.page.items.push({ kind: "box", x, y: sheet.y, width: cellWidth, height });
    let y = sheet.y + CELL_PAD;
    for (const block of cell.blocks) {
      if (block.kind === "paragraph") {
        const content = row.header ? { ...block, runs: block.runs.map((run) => ({ ...run, bold: true })) } : block;
        for (const line of placeParagraph(content, base, cellWidth - CELL_PAD * 2, measure)) {
          for (const item of line.items) sheet.page.items.push({ ...item, x: x + CELL_PAD + item.x, y: y + item.y });
          y += line.height;
        }
        y += block.spaceAfter ?? 0;
      } else if (block.kind === "image") {
        const w = block.widthCm * PT_PER_CM;
        const h = block.heightCm * PT_PER_CM;
        sheet.page.items.push({ kind: "image", x: block.align === "right" ? x + cellWidth - w - CELL_PAD : x + CELL_PAD, y, width: w, height: h, index: block.index });
        y += h;
      }
    }
    x += cellWidth;
  });
  sheet.y += height;
}

/* -------------------------------------------------------------- the flow */

export function typeset(
  blocks: readonly Block[],
  measure: Measure,
  options: { page: PageGeometry; fontSize: number; pageNumbers?: boolean },
): Typeset {
  const { page, fontSize: base } = options;
  const width = page.widthCm * PT_PER_CM;
  const height = page.heightCm * PT_PER_CM;
  const left = page.marginCm.left * PT_PER_CM;
  const textWidth = width - left - page.marginCm.right * PT_PER_CM;
  const sheet = new Sheet(page.marginCm.top * PT_PER_CM, height - page.marginCm.bottom * PT_PER_CM);

  blocks.forEach((block, index) => {
    if (block.kind === "paragraph") {
      if (block.pageBreakBefore && !sheet.empty) sheet.fresh();
      const before = block.spaceBefore ?? (block.style ? 12 : 0);
      if (!sheet.empty) sheet.y += before;
      const lines = placeParagraph(block, base, textWidth, measure);
      // A heading or a caption does not end a page: it moves over with the first line of what it introduces.
      if (block.keepNext || block.style) {
        const next = blocks[index + 1];
        const follow = next?.kind === "paragraph" ? (next.runs[0]?.size ?? base) * (next.lineSpacing ?? 1) * LINE_FACTOR
          : next?.kind === "table" ? base * 2 : 0;
        const whole = lines.reduce((sum, line) => sum + line.height, 0);
        if (!sheet.fits(whole + follow) && !sheet.empty) sheet.fresh();
      }
      for (const line of lines) {
        sheet.ensure(line.height);
        for (const item of line.items) sheet.page.items.push({ ...item, x: left + item.x, y: sheet.y + item.y });
        sheet.y += line.height;
      }
      sheet.y += block.spaceAfter ?? 0;
      return;
    }

    if (block.kind === "table") {
      const tableWidth = block.width ? twips(block.width) : textWidth;
      const columns = Math.max(1, ...block.rows.map((row) => row.cells.reduce((sum, cell) => sum + (cell.span ?? 1), 0)));
      const header = block.rows.filter((row) => row.header);
      const measureRow = (row: Table["rows"][number]) => {
        const widths = row.cells.map((cell) => (cell.width ? twips(cell.width) : (tableWidth / columns) * (cell.span ?? 1)));
        const rowHeight = Math.max(base * LINE_FACTOR + CELL_PAD * 2,
          ...row.cells.map((cell, at) => cellHeight(row.header ? cell.blocks.map((inner) => (inner.kind === "paragraph" ? { ...inner, runs: inner.runs.map((run) => ({ ...run, bold: true })) } : inner)) : cell.blocks, base, widths[at]!, measure)));
        return { widths, rowHeight };
      };
      for (const row of block.rows) {
        const { widths, rowHeight } = measureRow(row);
        if (!sheet.fits(rowHeight) && !sheet.empty) {
          sheet.fresh();
          // A table that breaks repeats its header, so the second page's columns still have names.
          if (!row.header) {
            for (const head of header) {
              const measured = measureRow(head);
              drawRow(sheet, head, measured.widths, measured.rowHeight, left, block.borders, base, measure);
            }
          }
        }
        drawRow(sheet, row, widths, rowHeight, left, block.borders, base, measure);
      }
      return;
    }

    const w = block.widthCm * PT_PER_CM;
    const h = block.heightCm * PT_PER_CM;
    // A picture does not touch the line above it.
    if (!sheet.empty) sheet.y += 6;
    sheet.ensure(h);
    const x = block.align === "right" ? left + textWidth - w : block.align === "center" ? left + (textWidth - w) / 2 : left;
    sheet.page.items.push({ kind: "image", x, y: sheet.y, width: w, height: h, index: block.index });
    sheet.y += h;
  });

  if (options.pageNumbers) {
    const size = Math.max(8, base - 2);
    sheet.pages.forEach((sheetPage, at) => {
      const text = String(at + 1);
      const textW = measure(text, size, { bold: false, italic: false });
      sheetPage.items.push({ kind: "text", x: (width - textW) / 2, y: height - (page.marginCm.bottom * PT_PER_CM) / 2 + size / 3, size, text });
    });
  }

  return { width, height, pages: sheet.pages };
}
