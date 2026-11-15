/**
 * A crossword to print: the empty grid and its clues, then the answers on a
 * page of their own.
 *
 * Set for a classroom: the title, a line for the solver's name, class and
 * date, the grid as large as the page allows, and the clues in two columns —
 * across, then down — each with its length. The answers page repeats the grid
 * with every letter in it and lists the words by number, so a teacher can
 * check a sheet at a glance.
 *
 * Manrope is embedded whole: it has the updated Uzbek letters (Ö Ğ Ş Ç), the
 * Cyrillic and the Turkish İ, and Helvetica has none of them.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { crosswordCells, type Crossword, type CrosswordLanguage, type CrosswordWord } from "./crossword.ts";
import { bundledUrl } from "./fonts.ts";

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 46;
const CONTENT = PAGE.width - MARGIN * 2;
const BOTTOM = 56;

const INK = rgb(0.09, 0.07, 0.15);
const MUTED = rgb(0.42, 0.39, 0.5);
const RULE = rgb(0.82, 0.79, 0.9);
const ACCENT = rgb(0.39, 0.22, 0.78);
const CELL_LINE = rgb(0.16, 0.13, 0.24);
const ANSWER_FILL = rgb(0.96, 0.94, 1);

type Labels = {
  kind: string; across: string; down: string; answers: string; name: string; group: string; date: string;
  words: (count: number) => string; page: (number: number) => string;
  /** A clue's length, after it: "5 harf". */
  letters: (count: number) => string;
};

/** Uzbek in the updated alphabet, like everything the app prints. */
const LABELS: Record<CrosswordLanguage, Labels> = {
  uz: {
    kind: "KROSSVORD", across: "Gorizontal", down: "Vertikal", answers: "Javoblar",
    name: "Ism", group: "Sinf", date: "Sana", words: (count) => `${count} ta söz`, page: (number) => `${number}-sahifa`,
    letters: (count) => `${count} harf`,
  },
  en: {
    kind: "CROSSWORD", across: "Across", down: "Down", answers: "Answers",
    name: "Name", group: "Class", date: "Date", words: (count) => `${count} words`, page: (number) => `Page ${number}`,
    letters: (count) => `${count} letters`,
  },
  ru: {
    kind: "КРОССВОРД", across: "По горизонтали", down: "По вертикали", answers: "Ответы",
    name: "Имя", group: "Класс", date: "Дата", words: (count) => `${count} слов`, page: (number) => `Стр. ${number}`,
    letters: (count) => `${count} ${count % 10 === 1 && count % 100 !== 11 ? "буква" : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? "буквы" : "букв"}`,
  },
  tr: {
    kind: "BULMACA", across: "Soldan sağa", down: "Yukarıdan aşağıya", answers: "Cevaplar",
    name: "Ad", group: "Sınıf", date: "Tarih", words: (count) => `${count} kelime`, page: (number) => `Sayfa ${number}`,
    letters: (count) => `${count} harf`,
  },
};

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
  return {
    regular: await pdf.embedFont(regular),
    strong: await pdf.embedFont(strong),
    bold: await pdf.embedFont(bold),
  };
}

/** Manrope has no modifier-letter marks (ʻ ʼ); the quotation marks look the same and it has those. */
function printable(text: string): string {
  return text.replace(/ʻ/g, "‘").replace(/ʼ/g, "’");
}

/** U+00A0 holds two words on one line; it is drawn as a plain space. */
const GLUE = "\u00A0";

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/[ \t\n]+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next.split(GLUE).join(" "), size) <= width || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.map((entry) => entry.split(GLUE).join(" "));
}

/** The grid at (x, top), `cell` points a side; letters only on the answers page. */
function drawGrid(page: PDFPage, faces: Faces, crossword: Crossword, x: number, top: number, cell: number, withLetters: boolean): void {
  const numberSize = Math.max(5, cell * 0.27);
  const letterSize = cell * 0.58;
  for (const square of crosswordCells(crossword).values()) {
    const left = x + square.col * cell;
    const bottom = top - (square.row + 1) * cell;
    page.drawRectangle({
      x: left, y: bottom, width: cell, height: cell,
      color: withLetters ? ANSWER_FILL : rgb(1, 1, 1), borderColor: CELL_LINE, borderWidth: Math.max(0.6, cell / 36),
    });
    if (square.number !== null) {
      page.drawText(String(square.number), {
        x: left + cell * 0.08, y: bottom + cell - numberSize - cell * 0.04, size: numberSize, font: faces.strong, color: MUTED,
      });
    }
    if (withLetters && square.letter) {
      const width = faces.bold.widthOfTextAtSize(square.letter, letterSize);
      page.drawText(square.letter, {
        x: left + (cell - width) / 2, y: bottom + cell * 0.22, size: letterSize, font: faces.bold, color: INK,
      });
    }
  }
}

class Sheet {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;

  constructor(private readonly pdf: PDFDocument) {
    this.add();
  }

  add(): PDFPage {
    this.page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.y = PAGE.height - MARGIN;
    return this.page;
  }
}

/**
 * The clues: across down the left column, down down the right, as printed
 * crosswords set them. A list longer than the page goes on to the next one,
 * both columns together, each under its heading again.
 */
function drawClues(sheet: Sheet, faces: Faces, labels: Labels, words: CrosswordWord[], top: number): void {
  const gutter = 22;
  const column = (CONTENT - gutter) / 2;
  const size = 9.6;
  const lead = 13.2;
  const indent = 20;
  const lists = (["across", "down"] as const).map((direction) => ({
    direction,
    items: words.filter((word) => word.direction === direction).sort((a, b) => a.number - b.number)
      .map((word) => ({ number: word.number, lines: wrap(`${word.clue}${GLUE}·${GLUE}${labels.letters(word.length).replace(/ /g, GLUE)}`, faces.regular, size, column - indent) })),
  }));
  // A heading with fewer than two clues under it starts the next page instead.
  if (top - BOTTOM < 30 + lead * 3) {
    sheet.add();
    top = sheet.y;
  }
  for (let page = 0; lists.some((list) => list.items.length); page += 1) {
    if (page > 0) {
      sheet.add();
      top = sheet.y;
    }
    lists.forEach((list, col) => {
      if (!list.items.length) return;
      const x = MARGIN + col * (column + gutter);
      sheet.page.drawText(list.direction === "across" ? labels.across : labels.down, { x, y: top - 12, size: 11.5, font: faces.bold, color: ACCENT });
      sheet.page.drawRectangle({ x, y: top - 17, width: column, height: 0.8, color: RULE });
      let y = top - 32;
      while (list.items.length) {
        const item = list.items[0]!;
        if (y - (item.lines.length - 1) * lead < BOTTOM) break;
        sheet.page.drawText(`${item.number}.`, { x, y, size, font: faces.bold, color: INK });
        item.lines.forEach((line, at) => {
          sheet.page.drawText(line, { x: x + indent, y: y - at * lead, size, font: faces.regular, color: INK });
        });
        y -= item.lines.length * lead + 4;
        list.items.shift();
      }
    });
  }
}

function footers(sheet: Sheet, faces: Faces, labels: Labels): void {
  sheet.pages.forEach((page, index) => {
    page.drawText("jaxongirman.app", { x: MARGIN, y: 30, size: 8, font: faces.strong, color: MUTED });
    const text = labels.page(index + 1);
    page.drawText(text, {
      x: PAGE.width - MARGIN - faces.regular.widthOfTextAtSize(text, 8), y: 30, size: 8, font: faces.regular, color: MUTED,
    });
  });
}

export async function renderCrosswordPdf(input: {
  title: string;
  language: CrosswordLanguage;
  crossword: Crossword;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const labels = LABELS[input.language] ?? LABELS.uz;
  pdf.setTitle(`${labels.kind} — ${input.title}`);
  pdf.setCreator("Jaxongirman");
  const faces = await loadFaces(pdf);
  const crossword: Crossword = { ...input.crossword, words: input.crossword.words.map((word) => ({ ...word, clue: printable(word.clue) })) };
  input = { ...input, title: printable(input.title) };

  /* ------------------------------------------------------- the puzzle */
  const sheet = new Sheet(pdf);
  let y = sheet.y;
  sheet.page.drawText(`${labels.kind} · ${labels.words(crossword.words.length)}`, {
    x: MARGIN, y: y - 8, size: 8, font: faces.bold, color: ACCENT,
  });
  y -= 20;
  for (const line of wrap(input.title, faces.bold, 20, CONTENT).slice(0, 2)) {
    y -= 24;
    sheet.page.drawText(line, { x: MARGIN, y, size: 20, font: faces.bold, color: INK });
  }
  // Where the solver writes who they are.
  y -= 30;
  const fields = [labels.name, labels.group, labels.date];
  const widths = [CONTENT * 0.5, CONTENT * 0.22, CONTENT * 0.22];
  let x = MARGIN;
  fields.forEach((field, index) => {
    sheet.page.drawText(`${field}:`, { x, y, size: 9.5, font: faces.strong, color: MUTED });
    const start = x + faces.strong.widthOfTextAtSize(`${field}:`, 9.5) + 5;
    sheet.page.drawRectangle({ x: start, y: y - 2, width: x + widths[index]! - start - 10, height: 0.7, color: RULE });
    x += widths[index]! + CONTENT * 0.02;
  });
  y -= 22;

  // As large as fits: the whole width, and no more than about 60% of the page's height.
  const roomBelow = y - BOTTOM;
  const cell = Math.min(30, CONTENT / crossword.width, (roomBelow * 0.62) / crossword.height);
  const gridWidth = cell * crossword.width;
  const gridLeft = MARGIN + (CONTENT - gridWidth) / 2;
  drawGrid(sheet.page, faces, crossword, gridLeft, y, cell, false);
  y -= cell * crossword.height + 26;
  sheet.y = y;
  drawClues(sheet, faces, labels, crossword.words, y);

  /* ------------------------------------------------------ the answers */
  sheet.add();
  y = sheet.y;
  sheet.page.drawText(labels.answers, { x: MARGIN, y: y - 18, size: 18, font: faces.bold, color: INK });
  sheet.page.drawText(input.title, { x: MARGIN, y: y - 34, size: 9.5, font: faces.regular, color: MUTED });
  y -= 52;
  const answerCell = Math.min(22, CONTENT / crossword.width, ((y - BOTTOM) * 0.55) / crossword.height);
  const answerLeft = MARGIN + (CONTENT - answerCell * crossword.width) / 2;
  drawGrid(sheet.page, faces, crossword, answerLeft, y, answerCell, true);
  y -= answerCell * crossword.height + 26;

  const answerWords = crossword.words.map((word) => ({ ...word, clue: word.answer ?? "" }));
  drawAnswerList(sheet, faces, labels, answerWords, y);

  footers(sheet, faces, labels);
  return await pdf.save();
}

/** The answers by number, two columns: "3. KITOB". */
function drawAnswerList(sheet: Sheet, faces: Faces, labels: Labels, words: CrosswordWord[], top: number): void {
  const gutter = 22;
  const column = (CONTENT - gutter) / 2;
  ["across", "down"].forEach((direction, col) => {
    let y = top;
    const x = MARGIN + col * (column + gutter);
    sheet.page.drawText(direction === "across" ? labels.across : labels.down, { x, y: y - 12, size: 11, font: faces.bold, color: ACCENT });
    sheet.page.drawRectangle({ x, y: y - 17, width: column, height: 0.8, color: RULE });
    y -= 30;
    for (const word of words.filter((entry) => entry.direction === direction).sort((a, b) => a.number - b.number)) {
      if (y < BOTTOM) break;
      sheet.page.drawText(`${word.number}.`, { x, y, size: 9.6, font: faces.bold, color: MUTED });
      sheet.page.drawText(word.clue, { x: x + 22, y, size: 9.6, font: faces.strong, color: INK });
      y -= 13.5;
    }
  });
}
