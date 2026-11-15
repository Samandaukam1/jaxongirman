/**
 * A test to print, and its key.
 *
 * Two ways to set the sheet, both one PDF:
 * - "combined": A4 landscape — the questions on the left, the answer panel on
 *   the right of the first page; questions that do not fit go on in two
 *   columns on the pages after it;
 * - "separate": the questions on A4 portrait pages, then an answer page with
 *   the panel drawn larger, so the bubbles are easier to fill.
 *
 * The panel is drawn from `sheetLayout`, the same numbers the scanner reads
 * with, scaled as a whole; a scale changes nothing for the scanner, which
 * works from the four corners. Around the panel there is always blank paper,
 * so its corner squares never run into the edge of the page or a table.
 *
 * The key is its own PDF: a sheet handed to a class must not have the answers
 * on its last page.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { toNewAlphabet } from "./alphabet.ts";
import { bundledUrl } from "./fonts.ts";
import { encodeSheetCode, OPTION_LETTERS, sheetLayout, testFingerprint, type SheetLayout } from "./test-sheet.ts";

export type TestLanguage = "uz" | "en" | "ru" | "tr";
export type PrintableQuestion = { prompt: string; options: string[]; correct: number };
export type PrintableTest = {
  id: string;
  title: string;
  language: TestLanguage;
  optionCount: number;
  layout: "combined" | "separate";
  questions: PrintableQuestion[];
};

const A4 = { long: 841.89, short: 595.28 };
const MARGIN = 30;
const BLACK = rgb(0, 0, 0);
const INK = rgb(0.09, 0.07, 0.15);
const MUTED = rgb(0.42, 0.39, 0.5);
const RULE = rgb(0.8, 0.78, 0.86);
const RING = rgb(0.38, 0.36, 0.42);
const LETTER = rgb(0.68, 0.66, 0.72);
const ACCENT = rgb(0.39, 0.22, 0.78);

type Labels = {
  test: string; sheet: string; name: string; group: string; date: string; hint: string;
  key: string; questions: (count: number) => string; page: (number: number) => string;
};

const RAW_LABELS: Record<TestLanguage, Labels> = {
  uz: {
    test: "TEST", sheet: "JAVOBLAR VARAQASI", name: "Ism, familiya", group: "Sinf", date: "Sana",
    hint: "Har bir savolga bitta doirachani to‘liq bo‘yang.", key: "Javoblar kaliti",
    questions: (count) => `${count} ta savol`, page: (number) => `${number}-sahifa`,
  },
  en: {
    test: "TEST", sheet: "ANSWER SHEET", name: "Name", group: "Class", date: "Date",
    hint: "Fill in one bubble completely for each question.", key: "Answer key",
    questions: (count) => `${count} questions`, page: (number) => `Page ${number}`,
  },
  ru: {
    test: "ТЕСТ", sheet: "БЛАНК ОТВЕТОВ", name: "Фамилия, имя", group: "Класс", date: "Дата",
    hint: "На каждый вопрос полностью закрасьте один кружок.", key: "Ключ ответов",
    questions: (count) => `Вопросов: ${count}`, page: (number) => `Стр. ${number}`,
  },
  tr: {
    test: "TEST", sheet: "CEVAP KÂĞIDI", name: "Ad, soyad", group: "Sınıf", date: "Tarih",
    hint: "Her soru için bir daireyi tamamen doldurun.", key: "Cevap anahtarı",
    questions: (count) => `${count} soru`, page: (number) => `Sayfa ${number}`,
  },
};

function labelsFor(language: TestLanguage): Labels {
  const labels = RAW_LABELS[language] ?? RAW_LABELS.uz;
  if (language !== "uz") return labels;
  // Uzbek is printed in the updated alphabet, like everything the app makes.
  const spell = toNewAlphabet;
  return {
    ...labels,
    name: spell(labels.name), hint: spell(labels.hint), key: spell(labels.key), sheet: spell(labels.sheet),
    questions: (count) => spell(labels.questions(count)), page: (number) => spell(labels.page(number)),
  };
}

type Faces = { regular: PDFFont; strong: PDFFont; bold: PDFFont };

async function fetchBytes(url: string | null): Promise<Uint8Array> {
  if (!url) throw new Error("font url missing");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function loadFaces(pdf: PDFDocument): Promise<Faces> {
  const [regular, strong, bold] = await Promise.all([
    fetchBytes(bundledUrl("Manrope_500Medium")),
    fetchBytes(bundledUrl("Manrope_600SemiBold")),
    fetchBytes(bundledUrl("Manrope_700Bold")),
  ]);
  return { regular: await pdf.embedFont(regular), strong: await pdf.embedFont(strong), bold: await pdf.embedFont(bold) };
}

/** Manrope has no modifier-letter marks (ʻ ʼ); the quotation marks look the same. */
function printable(text: string): string {
  return text.replace(/ʻ/g, "‘").replace(/ʼ/g, "’").replace(/\s+/g, " ").trim();
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of printable(text).split(" ").filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

// ------------------------------------------------------------------- panel --

/** The answer panel with its top-left corner at (left, top) on the page, `scale` times its size. */
function drawPanel(page: PDFPage, faces: Faces, labels: Labels, test: PrintableTest, layout: SheetLayout, left: number, top: number, scale: number): void {
  const X = (x: number) => left + x * scale;
  const Y = (y: number) => top - y * scale;
  const square = (p: { x: number; y: number }, side: number) =>
    page.drawRectangle({ x: X(p.x - side / 2), y: Y(p.y + side / 2), width: side * scale, height: side * scale, color: BLACK });

  layout.markers.forEach((p) => square(p, layout.markerSize));
  layout.middles.forEach((p) => square(p, layout.middleSize));
  square(layout.orientation, layout.orientationSize);
  encodeSheetCode({ questions: layout.questions, options: layout.options, fingerprint: testFingerprint(test.id) })
    .forEach((bit, at) => { if (bit) square(layout.code[at]!, layout.codeSize); });

  // The header: what the sheet is, whose it is, how to fill it.
  const h = layout.header;
  const headerWidth = (h.right - h.left) * scale;
  page.drawText(labels.sheet, { x: X(h.left), y: Y(h.top + 11), size: 10.5 * scale, font: faces.bold, color: INK });
  const title = wrap(test.title, faces.regular, 7.5 * scale, headerWidth)[0] ?? "";
  page.drawText(title, { x: X(h.left), y: Y(h.top + 22), size: 7.5 * scale, font: faces.regular, color: MUTED });
  page.drawText(`${labels.name}:`, { x: X(h.left), y: Y(h.top + 41), size: 8 * scale, font: faces.strong, color: MUTED });
  const nameStart = X(h.left) + faces.strong.widthOfTextAtSize(`${labels.name}:`, 8 * scale) + 4 * scale;
  page.drawRectangle({ x: nameStart, y: Y(h.top + 42), width: X(h.right) - nameStart, height: 0.6 * scale, color: RULE });
  page.drawText(labels.hint, { x: X(h.left), y: Y(h.top + 56), size: 6.5 * scale, font: faces.regular, color: MUTED });

  for (const label of layout.labels) {
    const text = `${label.question + 1}`;
    const size = 7.5 * scale;
    page.drawText(text, {
      x: X(label.x) - faces.strong.widthOfTextAtSize(text, size), y: Y(label.y) - size * 0.36, size, font: faces.strong, color: INK,
    });
  }
  for (const bubble of layout.bubbles) {
    page.drawCircle({ x: X(bubble.x), y: Y(bubble.y), size: bubble.r * scale, borderColor: RING, borderWidth: 0.7 * scale });
    const letter = OPTION_LETTERS[bubble.option]!;
    const size = bubble.r * 1.05 * scale;
    page.drawText(letter, {
      x: X(bubble.x) - faces.bold.widthOfTextAtSize(letter, size) / 2, y: Y(bubble.y) - size * 0.36, size, font: faces.bold, color: LETTER,
    });
  }
}

// --------------------------------------------------------------- questions --

/** One question, set at (x, y) in `width`; returns its height. Measures only when `page` is null. */
function setQuestion(page: PDFPage | null, faces: Faces, question: PrintableQuestion, number: number, x: number, y: number, width: number): number {
  const size = 9.6;
  const lead = 12.6;
  const indent = 20;
  const prompt = wrap(question.prompt, faces.strong, size, width - indent);
  let height = prompt.length * lead + 2;
  if (page) {
    page.drawText(`${number}.`, { x, y: y - size, size, font: faces.bold, color: INK });
    prompt.forEach((line, at) => page.drawText(line, { x: x + indent, y: y - size - at * lead, size, font: faces.strong, color: INK }));
  }
  // Short options sit two to a line; long ones one each.
  const optionWidth = width - indent;
  const texts = question.options.map((option, at) => `${OPTION_LETTERS[at]}) ${printable(option)}`);
  const half = (optionWidth - 10) / 2;
  const paired = texts.every((text) => faces.regular.widthOfTextAtSize(text, size - 0.6) <= half);
  if (paired) {
    for (let at = 0; at < texts.length; at += 2) {
      if (page) {
        page.drawText(texts[at]!, { x: x + indent, y: y - size - height, size: size - 0.6, font: faces.regular, color: INK });
        if (texts[at + 1]) page.drawText(texts[at + 1]!, { x: x + indent + half + 10, y: y - size - height, size: size - 0.6, font: faces.regular, color: INK });
      }
      height += lead;
    }
  } else {
    for (const text of texts) {
      const lines = wrap(text, faces.regular, size - 0.6, optionWidth - 12);
      lines.forEach((line, at) => {
        if (page) page.drawText(line, { x: x + indent + (at ? 12 : 0), y: y - size - height - at * lead, size: size - 0.6, font: faces.regular, color: INK });
      });
      height += lines.length * lead;
    }
  }
  return height + 8;
}

type Column = { x: number; top: number; bottom: number; width: number };

/** Questions into columns, page after page, from question `from`; a new page from `newPage` when the columns are full. */
function flowQuestions(
  faces: Faces, test: PrintableTest, from: number, first: { page: PDFPage; columns: Column[] },
  newPage: () => { page: PDFPage; columns: Column[] },
): void {
  let { page, columns } = first;
  let column = 0;
  let y = columns[0]!.top;
  for (let index = from; index < test.questions.length; index += 1) {
    const question = test.questions[index]!;
    let col = columns[column]!;
    const needed = setQuestion(null, faces, question, index + 1, col.x, y, col.width);
    if (y - needed < col.bottom && y < col.top) {
      column += 1;
      if (column >= columns.length) {
        ({ page, columns } = newPage());
        column = 0;
      }
      col = columns[column]!;
      y = col.top;
    }
    y -= setQuestion(page, faces, question, index + 1, col.x, y, col.width);
  }
}

function header(page: PDFPage, faces: Faces, labels: Labels, test: PrintableTest, x: number, top: number, width: number): number {
  page.drawText(`${labels.test} · ${labels.questions(test.questions.length)}`, { x, y: top - 8, size: 8, font: faces.bold, color: ACCENT });
  let y = top - 14;
  for (const line of wrap(test.title, faces.bold, 16, width).slice(0, 2)) {
    y -= 19;
    page.drawText(line, { x, y, size: 16, font: faces.bold, color: INK });
  }
  y -= 22;
  const fields = [labels.name, labels.group, labels.date];
  const widths = [width * 0.52, width * 0.2, width * 0.24];
  let fx = x;
  fields.forEach((field, at) => {
    page.drawText(`${field}:`, { x: fx, y, size: 8.5, font: faces.strong, color: MUTED });
    const start = fx + faces.strong.widthOfTextAtSize(`${field}:`, 8.5) + 4;
    page.drawRectangle({ x: start, y: y - 2, width: Math.max(10, fx + widths[at]! - start - 8), height: 0.6, color: RULE });
    fx += widths[at]! + width * 0.02;
  });
  return y - 18;
}

function footers(pages: PDFPage[], faces: Faces, labels: Labels): void {
  pages.forEach((page, index) => {
    const { width } = page.getSize();
    page.drawText("jaxongirman.app", { x: MARGIN, y: 16, size: 7.5, font: faces.strong, color: MUTED });
    const text = labels.page(index + 1);
    page.drawText(text, { x: width - MARGIN - faces.regular.widthOfTextAtSize(text, 7.5), y: 16, size: 7.5, font: faces.regular, color: MUTED });
  });
}

export async function renderTestPdf(test: PrintableTest): Promise<Uint8Array> {
  return (await renderTestSheet(test)).bytes;
}

/** Where the panel was put: its page, its top-left corner (PDF points, y up) and its scale. */
export type PanelPlacement = { page: number; left: number; top: number; scale: number; pageWidth: number; pageHeight: number };

export async function renderTestSheet(test: PrintableTest): Promise<{ bytes: Uint8Array; panel: PanelPlacement }> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const labels = labelsFor(test.language);
  pdf.setTitle(`${labels.test} — ${test.title}`);
  pdf.setCreator("Jaxongirman");
  const faces = await loadFaces(pdf);
  const layout = sheetLayout(test.questions.length, test.optionCount);
  const pages: PDFPage[] = [];
  const add = (width: number, height: number) => {
    const page = pdf.addPage([width, height]);
    pages.push(page);
    return page;
  };
  let placed: PanelPlacement | undefined;

  if (test.layout === "combined") {
    // Landscape: the panel on the right of the first page, the questions beside it.
    const page = add(A4.long, A4.short);
    const panelLeft = A4.long - MARGIN - layout.width;
    const panelTop = A4.short - (A4.short - layout.height) / 2;
    drawPanel(page, faces, labels, test, layout, panelLeft, panelTop, 1);
    placed = { page: 0, left: panelLeft, top: panelTop, scale: 1, pageWidth: A4.long, pageHeight: A4.short };
    const width = panelLeft - MARGIN - 24;
    const top = header(page, faces, labels, test, MARGIN, A4.short - MARGIN, width);
    const gutter = 20;
    const fullColumns = (): Column[] => {
      const columnWidth = (A4.long - MARGIN * 2 - gutter) / 2;
      return [0, 1].map((at) => ({ x: MARGIN + at * (columnWidth + gutter), top: A4.short - MARGIN, bottom: 34, width: columnWidth }));
    };
    flowQuestions(faces, test, 0, { page, columns: [{ x: MARGIN, top, bottom: 34, width }] },
      () => ({ page: add(A4.long, A4.short), columns: fullColumns() }));
  } else {
    // Portrait question pages, then the answer page with the panel as large as fits.
    const page = add(A4.short, A4.long);
    const width = A4.short - MARGIN * 2;
    const top = header(page, faces, labels, test, MARGIN, A4.long - MARGIN, width);
    const column = (from: number): Column => ({ x: MARGIN, top: from, bottom: 34, width });
    flowQuestions(faces, test, 0, { page, columns: [column(top)] },
      () => ({ page: add(A4.short, A4.long), columns: [column(A4.long - MARGIN)] }));

    const sheet = add(A4.short, A4.long);
    const fieldsBottom = header(sheet, faces, labels, test, MARGIN, A4.long - MARGIN, width);
    const room = { width: A4.short - MARGIN * 2 - 20, height: fieldsBottom - 40 - 20 };
    const scale = Math.min(room.width / layout.width, room.height / layout.height);
    const panelLeft = (A4.short - layout.width * scale) / 2;
    const panelTop = fieldsBottom - 10 - (room.height - layout.height * scale) / 2;
    drawPanel(sheet, faces, labels, test, layout, panelLeft, panelTop, scale);
    placed = { page: pages.length - 1, left: panelLeft, top: panelTop, scale, pageWidth: A4.short, pageHeight: A4.long };
  }

  footers(pages, faces, labels);
  return { bytes: await pdf.save(), panel: placed! };
}

/** The key: each question's letter, in columns, and the panel filled in for laying over a sheet. */
export async function renderTestKeyPdf(test: PrintableTest): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const labels = labelsFor(test.language);
  pdf.setTitle(`${labels.key} — ${test.title}`);
  pdf.setCreator("Jaxongirman");
  const faces = await loadFaces(pdf);
  const page = pdf.addPage([A4.short, A4.long]);
  const width = A4.short - MARGIN * 2;
  page.drawText(labels.key.toUpperCase(), { x: MARGIN, y: A4.long - MARGIN - 8, size: 8, font: faces.bold, color: ACCENT });
  let y = A4.long - MARGIN - 14;
  for (const line of wrap(test.title, faces.bold, 16, width).slice(0, 2)) {
    y -= 19;
    page.drawText(line, { x: MARGIN, y, size: 16, font: faces.bold, color: INK });
  }
  y -= 30;
  const columns = 4;
  const columnWidth = width / columns;
  const rows = Math.ceil(test.questions.length / columns);
  test.questions.forEach((question, index) => {
    const column = Math.floor(index / rows);
    const row = index % rows;
    const x = MARGIN + column * columnWidth;
    const lineY = y - row * 18;
    page.drawText(`${index + 1}.`, { x, y: lineY, size: 11, font: faces.strong, color: MUTED });
    page.drawText(OPTION_LETTERS[question.correct] ?? "?", { x: x + 30, y: lineY, size: 12, font: faces.bold, color: INK });
  });
  footers([page], faces, labels);
  return await pdf.save();
}
