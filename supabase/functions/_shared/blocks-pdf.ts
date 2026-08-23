/**
 * The same blocks a Word document is built from, drawn as a PDF.
 *
 * One description of the document and two renderers, rather than two
 * descriptions. The alternative — writing the obyektivka once for DOCX and
 * again for PDF — guarantees that a change lands in one of them, and the person
 * who downloads the other format gets last week's document with this week's
 * name on it.
 *
 * Deliberately small. It draws paragraphs, tables, images and page breaks,
 * which is what these documents are made of; anything it does not understand it
 * skips rather than approximates.
 */

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

import type { Block, DocxImage, Paragraph, Run, Table } from "./docx.ts";
import { DEFAULT_FACE, bundledUrl } from "./fonts.ts";

/** Points per centimetre. */
const PT_PER_CM = 72 / 2.54;
const cm = (value: number) => value * PT_PER_CM;
/** Twips to points: a twip is a twentieth of a point. */
const tw = (value: number) => value / 20;

const INK = rgb(0, 0, 0);
const LINE = rgb(0, 0, 0);

type Book = { regular: PDFFont; bold: PDFFont };

async function load(url: string | null): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

function fontFor(run: Run, book: Book): PDFFont {
  return run.bold ? book.bold : book.regular;
}

/** Greedy wrap, measuring each run's own face. */
function lines(runs: readonly Run[], book: Book, size: number, width: number): { runs: Run[] }[] {
  const out: { runs: Run[] }[] = [];
  let current: Run[] = [];
  let used = 0;

  const push = () => { out.push({ runs: current }); current = []; used = 0; };

  for (const run of runs) {
    for (const [index, part] of run.text.split("\n").entries()) {
      if (index > 0) push();
      const font = fontFor(run, book);
      const points = run.size ?? size;
      for (const word of part.split(/(\s+)/)) {
        if (!word) continue;
        const advance = font.widthOfTextAtSize(word, points);
        if (used + advance > width && used > 0 && word.trim()) push();
        if (!word.trim() && used === 0) continue;
        current.push({ ...run, text: word });
        used += advance;
      }
    }
  }
  if (current.length > 0 || out.length === 0) push();
  return out;
}

function measure(runs: readonly Run[], book: Book, size: number, width: number, spacing: number): number {
  return lines(runs, book, size, width).length * size * spacing;
}

class Sheet {
  page: PDFPage;
  y: number;
  /**
   * True while a table cell is being drawn.
   *
   * A row's height is measured and its space claimed before any of it is
   * drawn, so nothing inside it needs to break — and a paragraph that broke
   * mid-cell would leave the row's rule on one page and half its text on the
   * next.
   */
  private locked = false;

  constructor(
    private readonly pdf: PDFDocument,
    private readonly geometry: { width: number; height: number; left: number; right: number; top: number; bottom: number },
  ) {
    this.page = pdf.addPage([geometry.width, geometry.height]);
    this.y = geometry.height - geometry.top;
  }

  get textWidth(): number {
    return this.geometry.width - this.geometry.left - this.geometry.right;
  }

  get left(): number { return this.geometry.left; }

  break(): void {
    this.page = this.pdf.addPage([this.geometry.width, this.geometry.height]);
    this.y = this.geometry.height - this.geometry.top;
  }

  room(height: number): void {
    if (this.locked) return;
    if (this.y - height < this.geometry.bottom) this.break();
  }

  /** Draws the contents of one cell from `top`, without breaking the page. */
  inCell<T>(top: number, draw: () => T): T {
    const saved = this.y;
    this.locked = true;
    this.y = top;
    try {
      return draw();
    } finally {
      this.locked = false;
      this.y = saved;
    }
  }
}

function drawParagraph(
  sheet: Sheet,
  block: Paragraph,
  book: Book,
  base: number,
  box: { x: number; width: number },
): void {
  if (block.pageBreakBefore) sheet.break();

  const size = block.style ? base + (block.style === "Heading1" ? 4 : block.style === "Heading2" ? 2 : 1) : base;
  const bold = Boolean(block.style);
  const runs = block.runs.map((run) => (bold ? { ...run, bold: true } : run));
  const spacing = block.lineSpacing ?? 1.25;

  for (const line of lines(runs, book, size, box.width)) {
    sheet.room(size * spacing);
    sheet.y -= size * spacing;

    const width = line.runs.reduce((sum, run) => sum + fontFor(run, book).widthOfTextAtSize(run.text, run.size ?? size), 0);
    let x = box.x;
    if (block.align === "center") x = box.x + (box.width - width) / 2;
    else if (block.align === "right") x = box.x + box.width - width;

    for (const run of line.runs) {
      const font = fontFor(run, book);
      const points = run.size ?? size;
      sheet.page.drawText(run.text, { x, y: sheet.y, size: points, font, color: INK });
      x += font.widthOfTextAtSize(run.text, points);
    }
  }
  sheet.y -= (block.spaceAfter ?? 0);
}

function drawTable(
  sheet: Sheet,
  block: Table,
  book: Book,
  base: number,
  images: Map<number, PDFImage>,
  box: { x: number; width: number },
): void {
  const width = block.width ? tw(block.width) : box.width;
  const columns = Math.max(1, ...block.rows.map((row) => row.cells.reduce((sum, cell) => sum + (cell.span ?? 1), 0)));

  for (const row of block.rows) {
    // Every cell is measured before any is drawn, so a row's rule is drawn at
    // the height of its tallest cell rather than its first.
    const widths = row.cells.map((cell) => (cell.width ? tw(cell.width) : (width / columns) * (cell.span ?? 1)));
    const heights = row.cells.map((cell, index) => cell.blocks.reduce((sum, inner) => {
      if (inner.kind === "paragraph") {
        return sum + measure(inner.runs, book, base, widths[index]! - 8, inner.lineSpacing ?? 1.25) + (inner.spaceAfter ?? 0);
      }
      if (inner.kind === "image") return sum + cm(inner.heightCm);
      return sum + 12;
    }, 6));
    const height = Math.max(...heights, base * 1.6);

    sheet.room(height);
    const top = sheet.y;

    let x = box.x;
    row.cells.forEach((cell, index) => {
      const cellWidth = widths[index]!;
      if (block.borders) {
        sheet.page.drawRectangle({
          x, y: top - height, width: cellWidth, height,
          borderColor: LINE, borderWidth: 0.75,
        });
      }

      sheet.inCell(top - 3, () => {
        for (const child of cell.blocks) {
          if (child.kind === "paragraph") {
            drawParagraph(sheet, child, book, base, { x: x + 4, width: cellWidth - 8 });
            continue;
          }
          if (child.kind !== "image") continue;
          const picture = images.get(child.index);
          if (!picture) continue;
          const pictureWidth = cm(child.widthCm);
          const pictureHeight = cm(child.heightCm);
          sheet.y -= pictureHeight;
          sheet.page.drawImage(picture, {
            x: child.align === "right" ? x + cellWidth - pictureWidth - 4 : x + 4,
            y: sheet.y, width: pictureWidth, height: pictureHeight,
          });
        }
      });

      x += cellWidth;
    });

    sheet.y = top - height;
  }
}

export async function renderBlocksPdf(input: {
  blocks: readonly Block[];
  images?: readonly DocxImage[];
  fontSize?: number;
  page?: { widthCm: number; heightCm: number; marginCm: { top: number; right: number; bottom: number; left: number } };
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  /**
   * The face is embedded, not chosen from the standard fourteen.
   *
   * Helvetica has no o‘ and no g‘, and a document that drops them is not the
   * person's name any more.
   */
  const bytes = await load(bundledUrl(DEFAULT_FACE));
  const book: Book = bytes
    ? { regular: await pdf.embedFont(bytes, { subset: true }), bold: await pdf.embedFont(bytes, { subset: true }) }
    : { regular: await pdf.embedFont(StandardFonts.TimesRoman), bold: await pdf.embedFont(StandardFonts.TimesRomanBold) };

  const layout = input.page ?? {
    widthCm: 21, heightCm: 29.7,
    marginCm: { top: 2, right: 1.5, bottom: 2, left: 3 },
  };

  const embedded = new Map<number, PDFImage>();
  for (const [index, picture] of (input.images ?? []).entries()) {
    embedded.set(index, picture.extension === "png"
      ? await pdf.embedPng(picture.bytes)
      : await pdf.embedJpg(picture.bytes));
  }

  const sheet = new Sheet(pdf, {
    width: cm(layout.widthCm),
    height: cm(layout.heightCm),
    left: cm(layout.marginCm.left),
    right: cm(layout.marginCm.right),
    top: cm(layout.marginCm.top),
    bottom: cm(layout.marginCm.bottom),
  });

  const base = input.fontSize ?? 14;
  const box = { x: sheet.left, width: sheet.textWidth };

  for (const block of input.blocks) {
    if (block.kind === "paragraph") drawParagraph(sheet, block, book, base, box);
    else if (block.kind === "table") drawTable(sheet, block, book, base, embedded, box);
    else if (block.kind === "image") {
      const picture = embedded.get(block.index);
      if (!picture) continue;
      const width = cm(block.widthCm);
      const height = cm(block.heightCm);
      sheet.room(height);
      sheet.y -= height;
      const x = block.align === "right" ? box.x + box.width - width
        : block.align === "center" ? box.x + (box.width - width) / 2 : box.x;
      sheet.page.drawImage(picture, { x, y: sheet.y, width, height });
    }
  }

  return await pdf.save();
}
