/**
 * The answer sheet of a printed test: where everything on it is.
 *
 * One fixed panel, the same on the landscape sheet (beside the questions) and
 * on the separate answer page, so the scanner never has to guess which one it
 * is looking at. Everything is in PDF points, from the panel's top-left
 * corner, y going down. The PDF draws from this and the scanner reads with it;
 * neither keeps a number of its own. The app reads sheets live with a
 * byte-for-byte copy in `user/src/lib/omr/` (`user/tests/omr-live.test.mjs`
 * holds the two together).
 *
 * What the scanner relies on:
 * - four solid squares in the corners, which give the perspective;
 * - one small square right of the top-left one, which says which way is up;
 * - two squares halfway down the left and right edges, which take out a fold
 *   or a curl across the middle of the sheet;
 * - a strip of 24 squares along the bottom: the number of questions, the
 *   number of options and a fingerprint of the test, with a checksum — so a
 *   sheet of another test, or of this test before its questions changed, is
 *   refused instead of being graded wrong.
 */

export type SheetPoint = { x: number; y: number };

export type SheetBubble = { question: number; option: number; x: number; y: number; r: number };

export type SheetLayout = {
  questions: number;
  options: number;
  width: number;
  height: number;
  /** Centres of the corner squares: top-left, top-right, bottom-right, bottom-left. */
  markers: [SheetPoint, SheetPoint, SheetPoint, SheetPoint];
  markerSize: number;
  /** Centres of the edge squares: middle-left, middle-right. */
  middles: [SheetPoint, SheetPoint];
  middleSize: number;
  orientation: SheetPoint;
  orientationSize: number;
  /** Centres of the code squares, first bit first. */
  code: SheetPoint[];
  codeSize: number;
  /** Every bubble, question by question, option by option. */
  bubbles: SheetBubble[];
  /** Where each question's number is printed: right-aligned to `x`, centred on `y`. */
  labels: { question: number; x: number; y: number }[];
  /** The band above the grid for the title and the student's name. */
  header: { left: number; right: number; top: number; bottom: number };
};

export const SHEET_WIDTH = 350;
export const SHEET_HEIGHT = 515;
export const MARKER_SIZE = 22;
export const MIDDLE_SIZE = 14;
export const ORIENTATION_SIZE = 9;
export const CODE_BITS = 24;
export const CODE_SIZE = 7;

export const MIN_TEST_QUESTIONS = 1;
export const MAX_TEST_QUESTIONS = 60;
export const MIN_TEST_OPTIONS = 3;
export const MAX_TEST_OPTIONS = 5;
export const OPTION_LETTERS = ["A", "B", "C", "D", "E"] as const;

const GRID_TOP = 96;
const GRID_SIDE = MARKER_SIZE + 10;
const GRID_BOTTOM_GAP = MARKER_SIZE + 14;
const LABEL_WIDTH = 20;

export function sheetLayout(questions: number, options: number): SheetLayout {
  const n = Math.min(Math.max(Math.round(questions), MIN_TEST_QUESTIONS), MAX_TEST_QUESTIONS);
  const k = Math.min(Math.max(Math.round(options), MIN_TEST_OPTIONS), MAX_TEST_OPTIONS);
  const W = SHEET_WIDTH;
  const H = SHEET_HEIGHT;
  const m = MARKER_SIZE / 2;

  const columns = n <= 15 ? 1 : n <= 40 ? 2 : 3;
  const rows = Math.ceil(n / columns);
  const left = GRID_SIDE;
  const right = W - GRID_SIDE;
  const top = GRID_TOP;
  const bottom = H - GRID_BOTTOM_GAP;
  const rowPitch = Math.min(24, (bottom - top) / rows);
  const columnWidth = (right - left) / columns;
  const pitch = Math.min(24, (columnWidth - LABEL_WIDTH) / k);
  const r = Math.min(7.5, pitch * 0.38, rowPitch * 0.38);
  const content = LABEL_WIDTH + pitch * k;

  const bubbles: SheetBubble[] = [];
  const labels: SheetLayout["labels"] = [];
  for (let question = 0; question < n; question += 1) {
    const column = Math.floor(question / rows);
    const row = question % rows;
    const x0 = left + column * columnWidth + (columnWidth - content) / 2;
    const y = top + rowPitch * (row + 0.5);
    labels.push({ question, x: x0 + LABEL_WIDTH - 5, y });
    for (let option = 0; option < k; option += 1) {
      bubbles.push({ question, option, x: x0 + LABEL_WIDTH + pitch * (option + 0.5), y, r });
    }
  }

  const codeLeft = MARKER_SIZE + 12;
  const codePitch = (W - codeLeft * 2) / CODE_BITS;
  const code = Array.from({ length: CODE_BITS }, (_, at) => ({ x: codeLeft + codePitch * (at + 0.5), y: H - m }));

  return {
    questions: n,
    options: k,
    width: W,
    height: H,
    markers: [{ x: m, y: m }, { x: W - m, y: m }, { x: W - m, y: H - m }, { x: m, y: H - m }],
    markerSize: MARKER_SIZE,
    middles: [{ x: m, y: H / 2 }, { x: W - m, y: H / 2 }],
    middleSize: MIDDLE_SIZE,
    orientation: { x: MARKER_SIZE + 5 + ORIENTATION_SIZE / 2, y: m },
    orientationSize: ORIENTATION_SIZE,
    code,
    codeSize: CODE_SIZE,
    bubbles,
    labels,
    header: { left: MARKER_SIZE + 6, right: W - MARKER_SIZE - 6, top: MARKER_SIZE + 4, bottom: GRID_TOP - 10 },
  };
}

// -------------------------------------------------------------------- code --

/** Twelve bits that tell one test from another: an FNV-1a hash of its id. */
export function testFingerprint(testId: string): number {
  let hash = 0x811c9dc5;
  for (const char of testId.toLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash ^ (hash >>> 12) ^ (hash >>> 24)) & 0xfff;
}

export type SheetCode = { questions: number; options: number; fingerprint: number };

/** The strip's bits: 7 for the questions, 3 for the options, 12 for the test, 2 to check them. */
export function encodeSheetCode(code: SheetCode): boolean[] {
  const value = (code.questions & 0x7f) | ((code.options & 0x7) << 7) | ((code.fingerprint & 0xfff) << 10);
  const bits = Array.from({ length: 22 }, (_, at) => ((value >>> at) & 1) === 1);
  const check = bits.filter(Boolean).length % 4;
  return [...bits, (check & 1) === 1, (check & 2) === 2];
}

/** The code back from its bits, or null when the checksum does not hold. */
export function decodeSheetCode(bits: readonly boolean[]): SheetCode | null {
  if (bits.length !== CODE_BITS) return null;
  const data = bits.slice(0, 22);
  const check = data.filter(Boolean).length % 4;
  if ((check & 1) !== Number(bits[22]) || ((check >> 1) & 1) !== Number(bits[23])) return null;
  let value = 0;
  data.forEach((bit, at) => { if (bit) value |= 1 << at; });
  const questions = value & 0x7f;
  const options = (value >>> 7) & 0x7;
  if (questions < MIN_TEST_QUESTIONS || questions > MAX_TEST_QUESTIONS || options < MIN_TEST_OPTIONS || options > MAX_TEST_OPTIONS) return null;
  return { questions, options, fingerprint: (value >>> 10) & 0xfff };
}
