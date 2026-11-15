/**
 * Crosswords: the letters, the layout, the numbering and the solving.
 *
 * The model only chooses words and writes their clues; where each word goes is
 * decided here, by a deterministic search, so every crossing is a real crossing
 * and the same words always make the same grid. A word the search cannot fit is
 * left out rather than forced in — the model is asked for more than are needed.
 *
 * A grid is stored as its words (start cell, direction, answer, clue); the
 * cells follow from them. What a player is sent has no answers — only where
 * each word starts and how long it is (`length`) — and the app, the board and
 * the PDF all draw from the same helpers.
 *
 * This file is copied byte for byte to supabase/functions/_shared/crossword.ts,
 * and a test keeps the two copies the same.
 */

export type CrosswordLanguage = "uz" | "en" | "ru" | "tr";
export type CrosswordDirection = "across" | "down";

/** A placed word. `answer` is missing from what a player is sent. */
export type CrosswordWord = {
  /** Its number and direction: "3a" is 3 across, "3d" is 3 down. */
  id: string;
  number: number;
  direction: CrosswordDirection;
  row: number;
  col: number;
  length: number;
  clue: string;
  answer?: string;
};

export type Crossword = { width: number; height: number; words: CrosswordWord[] };

/**
 * The letters a crossword in each language is written with — and the keys of
 * the keyboard it is solved on, so nothing depends on what the phone's own
 * keyboard can type. Uzbek is the updated alphabet (Ö Ğ Ş Ç are single
 * letters, one cell each).
 */
export const CROSSWORD_ALPHABETS: Record<CrosswordLanguage, readonly string[]> = {
  uz: ["A", "B", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "X", "Y", "Z", "Ö", "Ğ", "Ş", "Ç"],
  en: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"],
  ru: ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И", "Й", "К", "Л", "М", "Н", "О", "П", "Р", "С", "Т", "У", "Ф", "Х", "Ц", "Ч", "Ш", "Щ", "Ъ", "Ы", "Ь", "Э", "Ю", "Я"],
  tr: ["A", "B", "C", "Ç", "D", "E", "F", "G", "Ğ", "H", "I", "İ", "J", "K", "L", "M", "N", "O", "Ö", "P", "R", "S", "Ş", "T", "U", "Ü", "V", "Y", "Z"],
};

export const CROSSWORD_MIN_LETTERS = 3;

/** Marks, spaces and dashes a written word carries but a grid does not: ma’lumot → MALUMOT. */
const DROPPED = /[\s\-‐‑–—'‘’ʻʼ`´.]/g;

/**
 * A word as the grid holds it: upper case in its language, the marks and
 * spaces dropped — or null when it has a letter the language's crossword does
 * not (a digit, a letter of another alphabet). Uzbek must already be in the
 * updated alphabet.
 */
export function crosswordAnswer(word: string, language: CrosswordLanguage): string | null {
  let text = word.normalize("NFC").replace(DROPPED, "");
  text = language === "tr" ? text.toLocaleUpperCase("tr") : text.toUpperCase();
  if (language === "ru") text = text.replace(/Ё/g, "Е");
  const letters = Array.from(text);
  const alphabet = new Set(CROSSWORD_ALPHABETS[language]);
  if (letters.length < CROSSWORD_MIN_LETTERS || !letters.every((letter) => alphabet.has(letter))) return null;
  return text;
}

// ------------------------------------------------------------------ layout --

type Placed = { index: number; letters: string[]; row: number; col: number; direction: CrosswordDirection };
type Cell = { letter: string; across: boolean; down: boolean };

const key = (row: number, col: number) => `${row},${col}`;

/** A small seeded generator, so the same words give the same grid everywhere. */
function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

class Board {
  readonly cells = new Map<string, Cell>();
  readonly placed: Placed[] = [];
  minRow = 0;
  maxRow = -1;
  minCol = 0;
  maxCol = -1;

  get crossings(): number {
    let count = 0;
    for (const cell of this.cells.values()) if (cell.across && cell.down) count += 1;
    return count;
  }

  /** How many words this placement crosses, or -1 when it may not go there. */
  fit(letters: string[], row: number, col: number, direction: CrosswordDirection, maxSize: number): number {
    const dRow = direction === "down" ? 1 : 0;
    const dCol = direction === "across" ? 1 : 0;
    const endRow = row + dRow * (letters.length - 1);
    const endCol = col + dCol * (letters.length - 1);
    if (this.placed.length) {
      const height = Math.max(this.maxRow, endRow) - Math.min(this.minRow, row) + 1;
      const width = Math.max(this.maxCol, endCol) - Math.min(this.minCol, col) + 1;
      if (height > maxSize || width > maxSize) return -1;
    }
    // Nothing directly before the first letter or after the last.
    if (this.cells.has(key(row - dRow, col - dCol)) || this.cells.has(key(endRow + dRow, endCol + dCol))) return -1;

    let crossings = 0;
    for (let at = 0; at < letters.length; at += 1) {
      const r = row + dRow * at;
      const c = col + dCol * at;
      const cell = this.cells.get(key(r, c));
      if (cell) {
        if (cell.letter !== letters[at] || cell[direction]) return -1;
        crossings += 1;
        continue;
      }
      // An empty cell must not touch a letter at its sides: that would make a
      // word nobody asked for.
      if (this.cells.has(key(r + dCol, c + dRow)) || this.cells.has(key(r - dCol, c - dRow))) return -1;
    }
    return crossings;
  }

  put(index: number, letters: string[], row: number, col: number, direction: CrosswordDirection): void {
    const dRow = direction === "down" ? 1 : 0;
    const dCol = direction === "across" ? 1 : 0;
    letters.forEach((letter, at) => {
      const r = row + dRow * at;
      const c = col + dCol * at;
      const cell = this.cells.get(key(r, c)) ?? { letter, across: false, down: false };
      cell[direction] = true;
      this.cells.set(key(r, c), cell);
      if (!this.placed.length && at === 0) {
        this.minRow = this.maxRow = r;
        this.minCol = this.maxCol = c;
      }
      this.minRow = Math.min(this.minRow, r);
      this.maxRow = Math.max(this.maxRow, r);
      this.minCol = Math.min(this.minCol, c);
      this.maxCol = Math.max(this.maxCol, c);
    });
    this.placed.push({ index, letters, row, col, direction });
  }

  /** The best place for a word: most crossings, then the smallest, squarest grid. */
  best(letters: string[], maxSize: number): { row: number; col: number; direction: CrosswordDirection } | null {
    let found: { row: number; col: number; direction: CrosswordDirection; score: number } | null = null;
    for (const [where, cell] of this.cells) {
      const [cellRow, cellCol] = where.split(",").map(Number) as [number, number];
      letters.forEach((letter, at) => {
        if (letter !== cell.letter) return;
        for (const direction of ["across", "down"] as const) {
          if (cell[direction]) continue;
          const row = direction === "down" ? cellRow - at : cellRow;
          const col = direction === "across" ? cellCol - at : cellCol;
          const crossings = this.fit(letters, row, col, direction, maxSize);
          if (crossings < 1) continue;
          const endRow = row + (direction === "down" ? letters.length - 1 : 0);
          const endCol = col + (direction === "across" ? letters.length - 1 : 0);
          const height = Math.max(this.maxRow, endRow) - Math.min(this.minRow, row) + 1;
          const width = Math.max(this.maxCol, endCol) - Math.min(this.minCol, col) + 1;
          const score = crossings * 1000 - width * height - Math.abs(width - height) * 4;
          if (!found || score > found.score) found = { row, col, direction, score };
        }
      });
    }
    return found;
  }
}

export type LayoutOptions = {
  /** The most words to place. */
  target?: number;
  /** The widest and tallest the grid may be. */
  maxSize?: number;
  /** How many orders to try. */
  attempts?: number;
};

/**
 * Lays words into a crossword. `answer` must already be a grid word
 * (`crosswordAnswer`). Answers that repeat are kept once. Null when fewer than
 * two words can be made to cross.
 */
export function layoutCrossword(
  entries: readonly { answer: string; clue: string }[],
  options: LayoutOptions = {},
): Crossword | null {
  const target = Math.max(2, options.target ?? 15);
  const maxSize = Math.max(5, options.maxSize ?? 15);
  const attempts = Math.max(1, options.attempts ?? 40);

  const seen = new Set<string>();
  const words = entries
    .map((entry) => ({ answer: entry.answer, clue: entry.clue.trim(), letters: Array.from(entry.answer) }))
    .filter((entry) => {
      if (entry.letters.length < CROSSWORD_MIN_LETTERS || entry.letters.length > maxSize || !entry.clue || seen.has(entry.answer)) return false;
      seen.add(entry.answer);
      return true;
    });
  if (words.length < 2) return null;

  const random = seeded(words.reduce((sum, word) => sum + word.answer.length * 131 + (word.answer.codePointAt(0) ?? 0), 7));
  let bestBoard: Board | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // Longest first, which leaves the most letters to cross; later attempts
    // stir the order a little to find a fuller grid.
    const order = words.map((_, index) => index).sort((a, b) => words[b]!.letters.length - words[a]!.letters.length);
    if (attempt > 0) {
      for (let swap = 0; swap < Math.min(order.length, 2 + attempt); swap += 1) {
        const a = Math.floor(random() * order.length);
        const b = Math.min(order.length - 1, a + 1 + Math.floor(random() * 3));
        [order[a], order[b]] = [order[b]!, order[a]!];
      }
    }

    const board = new Board();
    const first = order[0]!;
    board.put(first, words[first]!.letters, 0, 0, attempt % 2 === 0 ? "across" : "down");
    let waiting = order.slice(1);
    // Two passes: a word that found nothing to cross at first may once others are in.
    for (let pass = 0; pass < 2 && board.placed.length < target; pass += 1) {
      const left: number[] = [];
      for (const index of waiting) {
        if (board.placed.length >= target) break;
        const spot = board.best(words[index]!.letters, maxSize);
        if (spot) board.put(index, words[index]!.letters, spot.row, spot.col, spot.direction);
        else left.push(index);
      }
      waiting = left;
    }

    if (
      !bestBoard
      || board.placed.length > bestBoard.placed.length
      || (board.placed.length === bestBoard.placed.length && board.crossings > bestBoard.crossings)
      || (board.placed.length === bestBoard.placed.length && board.crossings === bestBoard.crossings
        && area(board) < area(bestBoard))
    ) {
      bestBoard = board;
    }
  }

  if (!bestBoard || bestBoard.placed.length < 2) return null;
  return numbered(bestBoard, words.map((word) => word.clue));
}

function area(board: Board): number {
  return (board.maxRow - board.minRow + 1) * (board.maxCol - board.minCol + 1);
}

/** Numbers in reading order, the way printed crosswords number them. */
function numbered(board: Board, clues: string[]): Crossword {
  const placed = board.placed.map((word) => ({
    ...word,
    row: word.row - board.minRow,
    col: word.col - board.minCol,
  }));
  const starts = [...new Set(placed.map((word) => key(word.row, word.col)))]
    .map((where) => where.split(",").map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const numbers = new Map(starts.map(([row, col], at) => [key(row, col), at + 1]));

  const words: CrosswordWord[] = placed.map((word) => {
    const number = numbers.get(key(word.row, word.col))!;
    return {
      id: `${number}${word.direction === "across" ? "a" : "d"}`,
      number,
      direction: word.direction,
      row: word.row,
      col: word.col,
      length: word.letters.length,
      clue: clues[word.index]!,
      answer: word.letters.join(""),
    };
  }).sort((a, b) => (a.direction === b.direction ? a.number - b.number : a.direction === "across" ? -1 : 1));

  return { width: board.maxCol - board.minCol + 1, height: board.maxRow - board.minRow + 1, words };
}

// ----------------------------------------------------------------- solving --

/** The cells of a word, first to last. */
export function wordCells(word: Pick<CrosswordWord, "row" | "col" | "length" | "direction">): [number, number][] {
  return Array.from({ length: word.length }, (_, at) => (
    word.direction === "across" ? [word.row, word.col + at] : [word.row + at, word.col]
  ) as [number, number]);
}

export type CrosswordCell = {
  row: number;
  col: number;
  /** Printed in the corner when a word starts here. */
  number: number | null;
  /** The answer's letter, when the crossword carries answers. */
  letter: string | null;
  across: string | null;
  down: string | null;
};

/** Every letter cell, keyed "row,col". */
export function crosswordCells(crossword: Crossword): Map<string, CrosswordCell> {
  const cells = new Map<string, CrosswordCell>();
  for (const word of crossword.words) {
    const letters = word.answer ? Array.from(word.answer) : [];
    wordCells(word).forEach(([row, col], at) => {
      const where = key(row, col);
      const cell = cells.get(where) ?? { row, col, number: null, letter: null, across: null, down: null };
      if (at === 0) cell.number = word.number;
      cell.letter = letters[at] ?? cell.letter;
      cell[word.direction] = word.id;
      cells.set(where, cell);
    });
  }
  return cells;
}

/**
 * The words a player has filled in completely, as the grader reads them:
 * `{ "3a": "KITOB" }`. A word with an empty cell is not sent.
 */
export function filledWords(crossword: Crossword, letters: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const word of crossword.words) {
    const typed = wordCells(word).map(([row, col]) => letters[key(row, col)] ?? "");
    if (typed.every((letter) => letter.length > 0)) out[word.id] = typed.join("");
  }
  return out;
}

/** The letters a player had, back from the words they sent. */
export function lettersFromWords(crossword: Crossword, words: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const word of crossword.words) {
    const typed = words[word.id];
    if (!typed) continue;
    const letters = Array.from(typed);
    wordCells(word).forEach(([row, col], at) => {
      if (letters[at]) out[key(row, col)] = letters[at]!;
    });
  }
  return out;
}

/** How many words are right. Only for a crossword that carries its answers. */
export function solvedCount(crossword: Crossword, words: Readonly<Record<string, string>>): number {
  return crossword.words.filter((word) => word.answer && words[word.id] === word.answer).length;
}

/** The crossword as a player may see it: everything but the answers. */
export function withoutAnswers(crossword: Crossword): Crossword {
  return {
    width: crossword.width,
    height: crossword.height,
    words: crossword.words.map(({ answer: _answer, ...word }) => word),
  };
}

/** A crossword read back from stored JSON, or null when it is not one. */
export function readCrossword(value: unknown): Crossword | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const width = Number(row.width);
  const height = Number(row.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !Array.isArray(row.words)) return null;
  const words: CrosswordWord[] = [];
  for (const raw of row.words) {
    if (!raw || typeof raw !== "object") return null;
    const word = raw as Record<string, unknown>;
    const direction = word.direction === "down" ? "down" : word.direction === "across" ? "across" : null;
    const entry: CrosswordWord = {
      id: String(word.id ?? ""),
      number: Number(word.number),
      direction: direction ?? "across",
      row: Number(word.row),
      col: Number(word.col),
      length: Number(word.length),
      clue: typeof word.clue === "string" ? word.clue : "",
      ...(typeof word.answer === "string" ? { answer: word.answer } : {}),
    };
    if (!direction || !entry.id || ![entry.number, entry.row, entry.col, entry.length].every(Number.isInteger)) return null;
    words.push(entry);
  }
  return { width, height, words };
}
