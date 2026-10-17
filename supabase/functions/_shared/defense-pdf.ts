/**
 * The spoken script, as a page a person can hold.
 *
 * Deliberately not the deck exporter, though it borrows the deck's pages. This
 * is a document to read from while standing up, so it is set like a printed
 * programme rather than a form: an ivory sheet in a fine frame, the app's mark
 * at the head of every page, a book serif (Spectral) for what is said and a
 * plain sans for the labels round it.
 *
 * Every slide starts its own page, and the page opens with that slide drawn
 * small beside its number and title — so a glance down from the audience lands
 * on the picture they are looking at and the words for it, and nobody loses
 * their place. The pictures are the deck's own PDF pages, embedded, so what the
 * script shows is exactly what the screen shows.
 *
 * Faces are embedded whole. Helvetica has no o‘ or g‘, and a subset is one more
 * way for fontkit to drop a glyph.
 */

import type { DeckLanguage } from "./glass/language.ts";
import fontkit from "@pdf-lib/fontkit";
import {
  appendBezierCurve, clip, closePath, endPath, lineTo, moveTo, PDFDocument, popGraphicsState,
  pushGraphicsState, rgb, StandardFonts, type PDFEmbeddedPage, type PDFFont, type PDFImage, type PDFPage, type RGB,
} from "pdf-lib";

import { BRAND_MARK_PNG } from "./brand-mark.ts";
import type { DefenseScript } from "./defense.ts";
import { bundledUrl, designFontUrl } from "./fonts.ts";

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 58;
const COLUMN = PAGE.width - MARGIN * 2;
/** Where the running head ends and the page's own content may begin. */
const TOP = PAGE.height - 96;
/** Where the running foot begins. */
const BOTTOM = 70;

const PAPER = rgb(0.988, 0.976, 0.955);
const FRAME = rgb(0.83, 0.79, 0.9);
const RULE = rgb(0.89, 0.86, 0.93);
const INK = rgb(0.11, 0.08, 0.19);
const MUTED = rgb(0.42, 0.39, 0.5);
const ACCENT = rgb(0.36, 0.17, 0.71);
const WASH = rgb(0.955, 0.94, 0.985);

/** Words a minute, read aloud at a defence's pace. */
const PACE = 125;

type Book = {
  serif: PDFFont;
  serifItalic: PDFFont;
  serifStrong: PDFFont;
  serifBold: PDFFont;
  sans: PDFFont;
  sansStrong: PDFFont;
  /** True when every face above is a real file, false on the Helvetica fallback. */
  unicode: boolean;
};

async function fetchBytes(url: string | null): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function loadBook(pdf: PDFDocument): Promise<Book> {
  const serif = (name: string) => fetchBytes(designFontUrl(`library/spectral/${name}.ttf`));
  const [regular, italic, semibold, bold, sans, sansStrong] = await Promise.all([
    serif("Spectral-Regular"), serif("Spectral-Italic"), serif("Spectral-SemiBold"), serif("Spectral-Bold"),
    fetchBytes(bundledUrl("Manrope_600SemiBold")), fetchBytes(bundledUrl("Manrope_700Bold")),
  ]);
  if (regular && sans) {
    const embed = (bytes: Uint8Array | null, fallback: PDFFont) => bytes ? pdf.embedFont(bytes) : Promise.resolve(fallback);
    const serifFace = await pdf.embedFont(regular);
    const sansFace = await pdf.embedFont(sans);
    return {
      serif: serifFace,
      serifItalic: await embed(italic, serifFace),
      serifStrong: await embed(semibold, serifFace),
      serifBold: await embed(bold, serifFace),
      sans: sansFace,
      sansStrong: await embed(sansStrong, sansFace),
      unicode: true,
    };
  }
  const times = await pdf.embedFont(StandardFonts.TimesRoman);
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  return {
    serif: times,
    serifItalic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
    serifStrong: await pdf.embedFont(StandardFonts.TimesRomanBold),
    serifBold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    sans: helvetica,
    sansStrong: await pdf.embedFont(StandardFonts.HelveticaBold),
    unicode: false,
  };
}

/**
 * A word's width, measured once per face and size.
 *
 * Measuring runs the face's shaper over the text. The wrap used to measure the
 * whole line again for every word it tried to add — for a twenty-slide script,
 * thousands of shapings of ever-longer lines, most of the time the PDF took.
 */
const widths = new WeakMap<PDFFont, Map<string, number>>();
function measured(font: PDFFont, text: string, size: number): number {
  let known = widths.get(font);
  if (!known) widths.set(font, known = new Map());
  const key = `${size}|${text}`;
  let width = known.get(key);
  if (width === undefined) known.set(key, width = font.widthOfTextAtSize(text, size));
  return width;
}

/** Greedy wrap. A script is prose; nothing here needs justification. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  const space = measured(font, " ", size);
  for (const paragraph of text.split("\n")) {
    let line = "";
    let lineWidth = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const wordWidth = measured(font, word, size);
      if (!line) { line = word; lineWidth = wordWidth; }
      else if (lineWidth + space + wordWidth <= width) { line = `${line} ${word}`; lineWidth += space + wordWidth; }
      else { lines.push(line); line = word; lineWidth = wordWidth; }
    }
    lines.push(line);
  }
  return lines;
}

/** One line cut to a width, with an ellipsis where it was cut. */
function clipLine(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function words(text: string | null | undefined): number {
  return (text ?? "").split(/\s+/).filter(Boolean).length;
}

/** A rounded rectangle as an SVG path from its top-left corner, for `drawSvgPath`. */
function roundedPath(width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  return `M ${r} 0 H ${width - r} Q ${width} 0 ${width} ${r} V ${height - r} Q ${width} ${height} ${width - r} ${height} `
    + `H ${r} Q 0 ${height} 0 ${height - r} V ${r} Q 0 0 ${r} 0 Z`;
}

/** Clips what is drawn next to a rounded rectangle given by its lower-left corner. */
function pushRoundedClip(page: PDFPage, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  const k = r * 0.5523;
  page.pushOperators(
    pushGraphicsState(),
    moveTo(x + r, y),
    lineTo(x + width - r, y),
    appendBezierCurve(x + width - r + k, y, x + width, y + r - k, x + width, y + r),
    lineTo(x + width, y + height - r),
    appendBezierCurve(x + width, y + height - r + k, x + width - r + k, y + height, x + width - r, y + height),
    lineTo(x + r, y + height),
    appendBezierCurve(x + r - k, y + height, x, y + height - r + k, x, y + height - r),
    lineTo(x, y + r),
    appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y),
    closePath(),
    clip(),
    endPath(),
  );
}

class Script {
  readonly pages: PDFPage[] = [];
  private page!: PDFPage;
  y = TOP;

  constructor(private readonly pdf: PDFDocument, readonly book: Book) {
    this.newPage();
  }

  /** A fresh sheet: the paper and its frame. Heads and feet are drawn last, once the count is known. */
  newPage(): void {
    this.page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.page.drawRectangle({ x: 0, y: 0, width: PAGE.width, height: PAGE.height, color: PAPER });
    this.page.drawRectangle({
      x: 22, y: 22, width: PAGE.width - 44, height: PAGE.height - 44,
      borderColor: FRAME, borderWidth: 0.6,
    });
    this.pages.push(this.page);
    this.y = TOP;
  }

  get current(): PDFPage {
    return this.page;
  }

  /** Room for `height` more points on this page, or a new one. Returns whether a page was turned. */
  room(height: number): boolean {
    if (this.y - height >= BOTTOM) return false;
    this.newPage();
    return true;
  }

  gap(height: number): void {
    this.y -= height;
  }

  /** Text that may run over the page, setting each line where it falls. */
  prose(value: string, options: { font: PDFFont; size: number; leading: number; color?: RGB; indent?: number; onTurn?: () => void }): void {
    const text = this.safe(value);
    if (!text.trim()) return;
    const indent = options.indent ?? 0;
    const paragraphs = text.split(/\n+/).map((part) => part.trim()).filter(Boolean);
    paragraphs.forEach((paragraph, index) => {
      if (index > 0) this.y -= options.leading * 0.45;
      for (const line of wrap(paragraph, options.font, options.size, COLUMN - indent)) {
        if (this.room(options.leading)) options.onTurn?.();
        this.y -= options.leading;
        this.page.drawText(line, { x: MARGIN + indent, y: this.y, size: options.size, font: options.font, color: options.color ?? INK });
      }
    });
  }

  /** Text for the standard-font fallback, which cannot encode anything outside WinAnsi. */
  safe(value: string): string {
    if (this.book.unicode) return value;
    return value
      .replace(/[‘’ʻʼ]/g, "'")
      .replace(/[“”]/g, "\"")
      .replace(/[–—]/g, "-")
      .replace(/→/g, "->")
      .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");
  }
}

/** A small label in spaced capitals. */
function label(page: PDFPage, book: Book, text: string, x: number, y: number, color: RGB = ACCENT, size = 7.5): void {
  let cursor = x;
  for (const char of text) {
    page.drawText(char, { x: cursor, y, size, font: book.sansStrong, color });
    cursor += book.sansStrong.widthOfTextAtSize(char, size) + size * 0.16;
  }
}

function labelWidth(book: Book, text: string, size = 7.5): number {
  return [...text].reduce((sum, char) => sum + book.sansStrong.widthOfTextAtSize(char, size) + size * 0.16, 0);
}

/** The slide, small, on a lifted card — or its number in a box when the deck could not be drawn. */
function thumbnail(page: PDFPage, book: Book, slide: PDFEmbeddedPage | null, number: number, x: number, top: number, width: number): number {
  const height = slide ? width * (slide.height / slide.width) : width * 0.5625;
  const y = top - height;
  // A soft shadow from three widening layers; no renderer here blurs.
  for (const [grow, alpha] of [[6, 0.035], [3.5, 0.05], [1.5, 0.07]] as const) {
    page.drawSvgPath(roundedPath(width + grow * 2, height + grow * 2, 10 + grow), {
      x: x - grow, y: y + height + grow - 3, color: rgb(0.2, 0.1, 0.35), opacity: alpha, borderWidth: 0,
    });
  }
  if (slide) {
    pushRoundedClip(page, x, y, width, height, 9);
    page.drawPage(slide, { x, y, width, height });
    page.pushOperators(popGraphicsState());
  } else {
    page.drawSvgPath(roundedPath(width, height, 9), { x, y: y + height, color: WASH, borderWidth: 0 });
    const text = `${number}`;
    const size = height * 0.36;
    page.drawText(text, {
      x: x + width / 2 - book.serifBold.widthOfTextAtSize(text, size) / 2,
      y: y + height / 2 - size * 0.34, size, font: book.serifBold, color: ACCENT,
    });
  }
  page.drawSvgPath(roundedPath(width, height, 9), { x, y: y + height, borderColor: RULE, borderWidth: 0.8 });
  return height;
}

/** The script's headings, in the deck's language. */
const LABELS = {
  uz: { script: "Himoya matni", scriptUpper: "HIMOYA MATNI", presenter: "TAQDIMOTCHI", teacher: "O‘QITUVCHI", slides: "SLAYDLAR", duration: "DAVOMIYLIGI",
        intro: "Kirish", slide: "SLAYD", keyPoint: "ASOSIY FIKR", next: "KEYINGI SLAYDGA O‘TISH", end: "YAKUN", conclusion: "Xulosa", thanks: "E’tiboringiz uchun rahmat!",
        count: (n: number) => `${n} ta`,
        minutes: (value: number) => (value < 1 ? "1 daqiqadan kam" : `~${Math.round(value)} daqiqa`) },
  en: { script: "Presentation script", scriptUpper: "PRESENTATION SCRIPT", presenter: "PRESENTER", teacher: "SUPERVISOR", slides: "SLIDES", duration: "DURATION",
        intro: "Introduction", slide: "SLIDE", keyPoint: "KEY POINT", next: "TRANSITION TO THE NEXT SLIDE", end: "CLOSING", conclusion: "Conclusion", thanks: "Thank you for your attention!",
        count: (n: number) => String(n),
        minutes: (value: number) => (value < 1 ? "under a minute" : `~${Math.round(value)} min`) },
  ru: { script: "Текст выступления", scriptUpper: "ТЕКСТ ВЫСТУПЛЕНИЯ", presenter: "ДОКЛАДЧИК", teacher: "ПРЕПОДАВАТЕЛЬ", slides: "СЛАЙДЫ", duration: "ДЛИТЕЛЬНОСТЬ",
        intro: "Вступление", slide: "СЛАЙД", keyPoint: "ГЛАВНАЯ МЫСЛЬ", next: "ПЕРЕХОД К СЛЕДУЮЩЕМУ СЛАЙДУ", end: "ЗАВЕРШЕНИЕ", conclusion: "Заключение", thanks: "Спасибо за внимание!",
        count: (n: number) => String(n),
        minutes: (value: number) => (value < 1 ? "меньше минуты" : `~${Math.round(value)} мин`) },
};

export async function renderDefensePdf(input: {
  /** The deck's language; its headings follow it. */
  language?: DeckLanguage;
  title: string;
  authorName: string | null;
  teacherName: string | null;
  script: DefenseScript;
  /**
   * The deck drawn as a PDF, one page per slide in order, and the slide number
   * each page is. Absent when the deck could not be drawn; the script is then
   * set without pictures rather than not at all.
   */
  deck?: { pdf: Uint8Array; numbers: number[] } | null;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const labels = LABELS[input.language ?? "uz"];
  pdf.setTitle(`${labels.script} — ${input.title}`);
  pdf.setCreator("Jaxongirman");

  const book = await loadBook(pdf);
  const mark: PDFImage | null = await pdf.embedPng(BRAND_MARK_PNG).catch(() => null);

  const slides = new Map<number, PDFEmbeddedPage>();
  if (input.deck?.pdf.byteLength) {
    try {
      // Every page asked for by index: left to itself, embedPdf takes only the first.
      const embedded = await pdf.embedPdf(input.deck.pdf, input.deck.numbers.map((_, index) => index));
      embedded.forEach((page, index) => {
        const number = input.deck!.numbers[index];
        if (number) slides.set(number, page);
      });
    } catch {
      // A deck that will not embed costs the pictures, not the script.
    }
  }

  const script = new Script(pdf, book);
  const sections = input.script.sections;
  const spoken = words(input.script.introduction) + words(input.script.conclusion)
    + sections.reduce((sum, section) => sum + words(section.speaker_text), 0);

  /* ------------------------------------------------------------- cover */
  {
    const page = script.current;
    label(page, book, labels.scriptUpper, MARGIN, script.y - 8);
    script.gap(22);
    const titleLines = wrap(script.safe(input.title), book.serifBold, 27, COLUMN);
    for (const line of titleLines.slice(0, 4)) {
      script.gap(33);
      page.drawText(line, { x: MARGIN, y: script.y, size: 27, font: book.serifBold, color: INK });
    }
    script.gap(18);
    page.drawRectangle({ x: MARGIN, y: script.y, width: 44, height: 2, color: ACCENT });
    script.gap(22);

    // The facts of the talk, in two columns of label over value.
    const facts = [
      input.authorName ? [labels.presenter, input.authorName] : null,
      input.teacherName ? [labels.teacher, input.teacherName] : null,
      [labels.slides, labels.count(sections.length)],
      [labels.duration, labels.minutes(spoken / PACE)],
    ].filter((fact): fact is string[] => fact !== null);
    const columnWidth = COLUMN / 2;
    facts.forEach(([name, value], index) => {
      const x = MARGIN + (index % 2) * columnWidth;
      const rowTop = script.y - Math.floor(index / 2) * 40;
      label(page, book, script.safe(name!), x, rowTop - 8, MUTED, 7);
      page.drawText(clipLine(script.safe(value!), book.serifStrong, 12.5, columnWidth - 16), {
        x, y: rowTop - 26, size: 12.5, font: book.serifStrong, color: INK,
      });
    });
    script.gap(Math.ceil(facts.length / 2) * 40 + 14);

    // The title slide, large enough to recognise and small enough to leave the
    // introduction room to start on the same page.
    const cover = slides.get(1) ?? null;
    if (cover) {
      const height = thumbnail(page, book, cover, 1, MARGIN, script.y, COLUMN * 0.78);
      script.gap(height + 30);
    }

    script.room(60);
    script.current.drawText(labels.intro, { x: MARGIN, y: script.y - 18, size: 17, font: book.serifStrong, color: INK });
    script.gap(28);
    script.prose(input.script.introduction, { font: book.serif, size: 12.5, leading: 20.5 });
  }

  /* ------------------------------------------------------------ slides */
  for (const section of sections) {
    script.newPage();
    const page = script.current;
    const number = section.slide_number;
    const slide = slides.get(number) ?? null;

    // The slide on the left, its number and title on the right.
    const thumbWidth = 288;
    const height = thumbnail(page, book, slide, number, MARGIN, script.y, thumbWidth);
    const side = MARGIN + thumbWidth + 22;
    const sideWidth = PAGE.width - MARGIN - side;
    const numeral = String(number).padStart(2, "0");
    page.drawText(numeral, { x: side, y: script.y - 40, size: 40, font: book.serifBold, color: ACCENT });
    label(page, book, labels.slide, side + book.serifBold.widthOfTextAtSize(numeral, 40) + 8, script.y - 30, MUTED, 7);
    let sideY = script.y - 66;
    for (const line of wrap(script.safe(section.slide_title), book.serifStrong, 13.5, sideWidth).slice(0, 4)) {
      sideY -= 18;
      page.drawText(line, { x: side, y: sideY, size: 13.5, font: book.serifStrong, color: INK });
    }
    // Level with the foot of the picture, or under the title when the title runs longer.
    label(page, book, labels.minutes(words(section.speaker_text) / PACE).toLocaleUpperCase("uz"), side, Math.min(script.y - height + 4, sideY - 24), MUTED, 6.8);
    script.gap(height + 26);

    page.drawRectangle({ x: MARGIN, y: script.y, width: COLUMN, height: 0.6, color: RULE });
    script.gap(10);

    const resume = () => {
      label(script.current, book, `${numeral}-SLAYD · DAVOMI`, MARGIN, script.y - 8, MUTED, 7);
      script.gap(20);
    };
    script.prose(section.speaker_text, { font: book.serif, size: 12.5, leading: 21, onTurn: resume });

    if (section.key_point?.trim()) {
      const text = script.safe(section.key_point.trim());
      const lines = wrap(text, book.serifItalic, 11.5, COLUMN - 34);
      const boxHeight = 30 + lines.length * 17;
      script.gap(16);
      if (script.room(boxHeight)) resume();
      const boxTop = script.y;
      script.current.drawSvgPath(roundedPath(COLUMN, boxHeight, 8), { x: MARGIN, y: boxTop, color: WASH, borderWidth: 0 });
      script.current.drawRectangle({ x: MARGIN, y: boxTop - boxHeight + 8, width: 2.6, height: boxHeight - 16, color: ACCENT });
      label(script.current, book, labels.keyPoint, MARGIN + 18, boxTop - 17, ACCENT, 7);
      lines.forEach((line, index) => {
        script.current.drawText(line, { x: MARGIN + 18, y: boxTop - 36 - index * 17, size: 11.5, font: book.serifItalic, color: INK });
      });
      script.gap(boxHeight);
    }

    if (section.transition_to_next?.trim()) {
      script.gap(14);
      if (script.room(40)) resume();
      label(script.current, book, labels.next, MARGIN, script.y - 8, MUTED, 6.8);
      script.gap(12);
      script.prose(`→ ${section.transition_to_next.trim()}`, { font: book.serifItalic, size: 11.5, leading: 18, color: MUTED, onTurn: resume });
    }
  }

  /* ------------------------------------------------------- conclusion */
  if (input.script.conclusion?.trim()) {
    script.newPage();
    label(script.current, book, labels.end, MARGIN, script.y - 8);
    script.gap(16);
    script.current.drawText(labels.conclusion, { x: MARGIN, y: script.y - 22, size: 24, font: book.serifBold, color: INK });
    script.gap(36);
    script.current.drawRectangle({ x: MARGIN, y: script.y, width: 44, height: 2, color: ACCENT });
    script.gap(12);
    script.prose(input.script.conclusion, { font: book.serif, size: 12.5, leading: 21 });
    script.gap(30);
    script.room(30);
    script.current.drawText(script.safe(labels.thanks), { x: MARGIN, y: script.y - 14, size: 14, font: book.serifItalic, color: ACCENT });
  }

  /* -------------------------------------------- running heads and feet */
  const total = script.pages.length;
  const title = script.safe(input.title);
  script.pages.forEach((page, index) => {
    const headY = PAGE.height - 66;
    if (mark) {
      page.drawSvgPath(roundedPath(26, 26, 7), { x: MARGIN, y: headY + 26, color: rgb(1, 1, 1), borderColor: RULE, borderWidth: 0.6 });
      pushRoundedClip(page, MARGIN + 1, headY + 1, 24, 24, 6);
      page.drawImage(mark, { x: MARGIN + 1, y: headY + 1, width: 24, height: 24 });
      page.pushOperators(popGraphicsState());
    }
    const textX = MARGIN + (mark ? 34 : 0);
    label(page, book, "JAXONGIRMAN", textX, headY + 14, INK, 7.5);
    page.drawText("Himoya matni", { x: textX, y: headY + 2, size: 8.5, font: book.serifItalic, color: MUTED });
    const counter = `${index + 1} / ${total}`;
    page.drawText(counter, {
      x: PAGE.width - MARGIN - book.sans.widthOfTextAtSize(counter, 8.5), y: headY + 8, size: 8.5, font: book.sans, color: MUTED,
    });
    page.drawRectangle({ x: MARGIN, y: headY - 12, width: COLUMN, height: 0.6, color: RULE });

    page.drawRectangle({ x: MARGIN, y: 50, width: COLUMN, height: 0.6, color: RULE });
    const site = "jaxongirman.app";
    page.drawText(clipLine(title, book.serifItalic, 8.5, COLUMN - labelWidth(book, site, 6.8) - 24), { x: MARGIN, y: 36, size: 8.5, font: book.serifItalic, color: MUTED });
    label(page, book, site.toUpperCase(), PAGE.width - MARGIN - labelWidth(book, site.toUpperCase(), 6.8), 37, MUTED, 6.8);
  });

  return await pdf.save();
}
