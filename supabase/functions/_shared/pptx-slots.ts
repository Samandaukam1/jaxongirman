/**
 * The text boxes of a template slide, measured.
 *
 * This is the file that decides what a writer is asked for when a design came
 * from PowerPoint, and it exists because the previous answer was wrong in a way
 * that could not be patched.
 *
 * That answer read the slide as a JSLAYD archetype and let the archetype's
 * bindings decide which boxes existed. Two things followed. A binding
 * vocabulary is closed — a title, a body, six bullets — so a cover with eleven
 * text boxes arrived with three of them unaddressable, and those three kept the
 * template's own English on every deck ever exported from it. And the elements
 * a slide inherits from its layout are real for drawing and imaginary for
 * editing: a master's "Click to edit Master title style" is composited onto
 * every page, so it was bound as the title of every page, while the actual
 * headline — `JOURNALISM`, set at 183 points — was one of the boxes that fell
 * off the end.
 *
 * So the source slide is the authority. `readTextObjects` on the slide part
 * returns exactly the boxes that part can edit: not the layout's, not the
 * master's, no more and no fewer. Everything here measures those.
 *
 * What the measurements are for is the other half. A template box is a fixed
 * space somebody designed around a photograph, and copy is written *to* it —
 * §13's rule, that the text is fitted to the box rather than the box to the
 * text. So each slot carries the room it has, the length the designer put in
 * it, and what kind of thing it is, and the writer is given all three.
 *
 * Pure: markup and geometry in, slots out.
 */

import { readTextObjects, type TextObject } from "./pptx-text.ts";

/**
 * What a box is for, as far as anything can tell without being told.
 *
 * Deliberately coarser than the JSLAYD binding vocabulary and not the same
 * list: this describes a box, not a field a design offers. A template has
 * things no binding names — a letter of a spaced-out word, a page number, a
 * strapline under a rule — and calling them all `body` is how they ended up
 * being written as though they were.
 */
export type SlotRole =
  | "display" | "title" | "subtitle" | "heading"
  | "body" | "bullet" | "caption" | "label" | "number" | "letter";

export type SlotGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

export type TemplateSlot = {
  /** `<p:cNvPr id="…">` in the source part. The only handle the cloner needs. */
  shapeId: string;
  /** What PowerPoint's selection pane calls it, so a warning can name a box. */
  shapeName: string;
  role: SlotRole;
  /**
   * The template's own words.
   *
   * Never drawn, never exported, never shown to a reader: kept because the
   * length a designer chose is the best available statement of what fits, and
   * because a writer told "this box says «Photojournalist»" writes a job title
   * rather than a sentence. §15 still holds — anything that reaches the file
   * is written fresh, and the export refuses if one of these survives.
   */
  originalText: string;
  /** Reading order within the slide: top band first, then left to right. */
  order: number;

  /* --------------------------------------------- what the designer put in */
  paragraphs: number;
  bullets: number;
  characters: number;
  words: number;

  /* ------------------------------------------------------ what it can hold */
  width: number;
  height: number;
  fontSize: number;
  charactersPerLine: number;
  lines: number;
  characterCapacity: number;
  wordCapacity: number;

  /**
   * Which spaced-out word this box is one letter of, if it is.
   *
   * `C` `A` `M` `P` `U` `S` across six boxes is one word to a reader and six
   * text objects to a file. Written independently they become six unrelated
   * Uzbek letters; measured independently every one of them is a box with
   * capacity for one character. Grouped, they are a single word of six
   * letters, which is a thing a writer can be asked for.
   */
  letterGroup: number | null;
};

/** Roughly how wide a character is, as a fraction of its point size. */
const CHARACTER_WIDTH = 0.53;
/** Line box as a multiple of point size — PowerPoint's single spacing. */
const LINE_HEIGHT = 1.25;
/** An Uzbek word, plus the space after it. */
const WORD_LENGTH = 7;

const BULLET = /<a:(buChar|buAutoNum)\b/g;

function countBullets(markup: string, object: TextObject): number {
  const body = markup.slice(object.bodyStart, object.bodyEnd);
  BULLET.lastIndex = 0;
  const marked = [...body.matchAll(BULLET)].length;
  // A `<a:buNone/>` on every paragraph is the common case and counts as none.
  return Math.min(marked, object.paragraphs.length);
}

function wordsIn(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * What kind of box this is.
 *
 * Read from size relative to the rest of the slide, from the shape of the text
 * it holds, and from the placeholder type where the file states one. Nothing is
 * asked of a model: a heading is bigger than a body on every slide anybody has
 * ever designed, and paying an LLM to notice that would be paying it to read a
 * ruler.
 */
function roleOf(
  object: TextObject,
  geometry: SlotGeometry,
  median: number,
  paragraphs: number,
  bullets: number,
): SlotRole {
  const text = object.text.trim();
  const placeholder = (object.placeholder ?? "").toLowerCase();
  if (placeholder === "title" || placeholder === "ctrtitle") return "title";
  if (placeholder === "subtitle") return "subtitle";
  if (placeholder === "sldnum" || placeholder === "dt") return "number";

  // One visible character is never a sentence. It is a letter of a display
  // word, or a numeral in a step marker.
  if (text.length === 1) return /\d/.test(text) ? "number" : "letter";
  if (/^[\d\s.,:/–—-]+$/.test(text) && text.length <= 12) return "number";

  const size = geometry.fontSize;
  if (size >= median * 2.2) return "display";
  if (bullets > 0 || paragraphs > 2) return "bullet";
  if (size >= median * 1.45) return "heading";
  if (size >= median * 1.15) return "subtitle";
  if (paragraphs > 1 || text.length > 90) return "body";
  if (size <= median * 0.8) return "caption";
  return "label";
}

/**
 * Boxes holding one letter each, gathered into the words they spell.
 *
 * Adjacency is in reading order and by type size, not by spelling: nothing here
 * knows English, and a rule that recognised `CAMPUS` would not recognise the
 * next template's display word. Three is the shortest run worth treating this
 * way — two single-character boxes side by side are as likely to be a pair of
 * icons' labels.
 */
function groupLetters(slots: TemplateSlot[]): void {
  let group = 0;
  let run: TemplateSlot[] = [];

  const close = () => {
    if (run.length >= 3) {
      group += 1;
      for (const slot of run) slot.letterGroup = group;
    }
    run = [];
  };

  for (const slot of slots) {
    const previous = run[run.length - 1];
    const sameSize = !previous || Math.abs(previous.fontSize - slot.fontSize) <= previous.fontSize * 0.1;
    if (slot.role === "letter" && sameSize) run.push(slot);
    else { close(); if (slot.role === "letter") run.push(slot); }
  }
  close();
}

/**
 * Every editable box of one slide, in reading order, measured.
 *
 * `geometry` is what the parser worked out for each shape — the same numbers
 * the preview is drawn from — keyed by shape id. A box the parser did not
 * reach still becomes a slot: it exists in the file, so it will keep its
 * English unless something writes to it, and an unmeasured slot with a
 * conservative capacity is far better than a silent omission.
 */
export function readTemplateSlots(
  markup: string,
  geometry: ReadonlyMap<string, SlotGeometry>,
  options: { canvasWidth: number; canvasHeight: number },
): TemplateSlot[] {
  const objects = readTextObjects(markup).filter((object) => object.shapeId);

  const sizes = objects
    .map((object) => geometry.get(object.shapeId)?.fontSize ?? 0)
    .filter((size) => size > 0)
    .sort((first, second) => first - second);
  const median = sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)]! : 18;

  const measured = objects.map((object) => {
    const known = geometry.get(object.shapeId);
    // Unmeasured: assume a modest box in the middle of the canvas, which sorts
    // late and asks for little. Guessing generously would invite copy that
    // overflows a box nobody has measured.
    const box: SlotGeometry = known ?? {
      x: options.canvasWidth / 2,
      y: options.canvasHeight / 2,
      width: options.canvasWidth / 3,
      height: 40,
      fontSize: median,
    };
    const fontSize = box.fontSize > 0 ? box.fontSize : median;
    const paragraphs = object.paragraphs.length;
    const bullets = countBullets(markup, object);
    const text = object.text;

    const charactersPerLine = Math.max(1, Math.round(box.width / Math.max(1, fontSize * CHARACTER_WIDTH)));
    const lines = Math.max(1, Math.floor(box.height / Math.max(1, fontSize * LINE_HEIGHT)));

    const slot: TemplateSlot = {
      shapeId: object.shapeId,
      shapeName: object.shapeName,
      role: roleOf(object, { ...box, fontSize }, median, paragraphs, bullets),
      originalText: text,
      order: 0,
      paragraphs,
      bullets,
      characters: text.trim().length,
      words: wordsIn(text),
      width: Math.round(box.width),
      height: Math.round(box.height),
      fontSize: Math.round(fontSize * 10) / 10,
      charactersPerLine,
      lines,
      characterCapacity: charactersPerLine * lines,
      wordCapacity: Math.max(1, Math.round((charactersPerLine * lines) / WORD_LENGTH)),
      letterGroup: null,
    };
    return { slot, box };
  });

  // Reading order, banded so a row of columns reads left to right rather than
  // by whichever box happens to sit two pixels higher.
  measured.sort((first, second) => {
    const band = Math.round(first.box.y / 40) - Math.round(second.box.y / 40);
    return band !== 0 ? band : first.box.x - second.box.x;
  });

  const slots = measured.map((entry, index) => ({ ...entry.slot, order: index }));
  groupLetters(slots);
  return slots;
}

/**
 * One word, dealt letter by letter across the boxes that spell it.
 *
 * Even distribution rather than one character each: an Uzbek word is rarely the
 * length of the English one it replaces, and `JURNALISTIKA` across six boxes
 * reads as a letter-spaced word set two characters to a box, which is what the
 * composition was doing in the first place. A word shorter than the run leaves
 * the trailing boxes empty — they keep their size, their fill and their place,
 * and the spacing simply ends where the word does.
 */
export function dealAcrossBoxes(word: string, boxes: number): string[] {
  const letters = [...word.replace(/\s+/g, "")];
  if (boxes <= 0) return [];
  if (letters.length === 0) return Array<string>(boxes).fill("");

  const out: string[] = [];
  for (let index = 0; index < boxes; index += 1) {
    const from = Math.round((letters.length * index) / boxes);
    const to = Math.round((letters.length * (index + 1)) / boxes);
    out.push(letters.slice(from, to).join(""));
  }
  return out;
}
