/**
 * The spoken script, as a page a person can hold.
 *
 * Deliberately not the deck exporter. That one reproduces a design — geometry,
 * faces, images, a slide per page. This is a document to read from while
 * standing up, so it is set the way a script is set: one column, generous
 * leading, the slide number where the eye can find it after looking away, and
 * the key point in the margin so a glance recovers the thread.
 *
 * The face is the one the app ships with, embedded, because the alternative is
 * Helvetica and Helvetica has no o‘ or g‘.
 */

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

import type { DefenseScript } from "./defense.ts";
import { DEFAULT_FACE, bundledUrl } from "./fonts.ts";

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 64;
const COLUMN = PAGE.width - MARGIN * 2;

const INK = rgb(0.08, 0.05, 0.14);
const MUTED = rgb(0.36, 0.32, 0.44);
const ACCENT = rgb(0.42, 0.2, 0.79);

type Book = { regular: PDFFont; bold: PDFFont };

async function face(url: string | null): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/** Greedy wrap. A script is prose; nothing here needs justification. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else { if (line) lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

class Writer {
  private page: PDFPage;
  private y: number;

  constructor(private readonly pdf: PDFDocument, private readonly book: Book) {
    this.page = pdf.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
  }

  /** Starts a new page when what is about to be drawn will not fit on this one. */
  private room(height: number): void {
    if (this.y - height >= MARGIN) return;
    this.page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
  }

  gap(height: number): void {
    this.y -= height;
  }

  text(value: string, options: { size: number; bold?: boolean; color?: ReturnType<typeof rgb>; leading?: number }): void {
    if (!value.trim()) return;
    const font = options.bold ? this.book.bold : this.book.regular;
    const leading = options.leading ?? options.size * 1.55;
    for (const line of wrap(value, font, options.size, COLUMN)) {
      this.room(leading);
      this.y -= leading;
      this.page.drawText(line, {
        x: MARGIN, y: this.y, size: options.size, font,
        color: options.color ?? INK,
      });
    }
  }

  /** A slide's number, drawn as the marker the eye returns to. */
  marker(label: string): void {
    this.room(38);
    this.y -= 26;
    this.page.drawText(label, { x: MARGIN, y: this.y, size: 11, font: this.book.bold, color: ACCENT });
    this.y -= 6;
  }
}

export async function renderDefensePdf(input: {
  title: string;
  authorName: string | null;
  teacherName: string | null;
  script: DefenseScript;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const bytes = await face(bundledUrl(DEFAULT_FACE));
  const book: Book = bytes
    ? await (async () => {
      // One embed, reused: the same bytes embedded twice is a second way to
      // produce the same broken subset.
      const face = await pdf.embedFont(bytes);
      return { regular: face, bold: face };
    })()
    : {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    };

  const writer = new Writer(pdf, book);

  writer.text("HIMOYA MATNI", { size: 11, bold: true, color: ACCENT });
  writer.gap(6);
  writer.text(input.title, { size: 22, bold: true, leading: 28 });
  const who = [
    input.authorName ? `Taqdimotchi: ${input.authorName}` : null,
    input.teacherName ? `O‘qituvchi: ${input.teacherName}` : null,
  ].filter(Boolean).join("   ·   ");
  if (who) { writer.gap(4); writer.text(who, { size: 10, color: MUTED }); }

  writer.gap(18);
  writer.text("Kirish", { size: 13, bold: true });
  writer.gap(2);
  writer.text(input.script.introduction, { size: 12 });

  for (const section of input.script.sections) {
    writer.marker(`${section.slide_number}-SLAYD · ${section.slide_title.toLocaleUpperCase("uz")}`);
    writer.text(section.speaker_text, { size: 12 });
    if (section.key_point) {
      writer.gap(6);
      writer.text(`Asosiy fikr: ${section.key_point}`, { size: 10, color: MUTED });
    }
    if (section.transition_to_next) {
      writer.gap(2);
      writer.text(`O‘tish: ${section.transition_to_next}`, { size: 10, color: MUTED });
    }
  }

  writer.gap(20);
  writer.text("Xulosa", { size: 13, bold: true });
  writer.gap(2);
  writer.text(input.script.conclusion, { size: 12 });

  return await pdf.save();
}
