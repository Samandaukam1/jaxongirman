/**
 * Replacing the words in a slide without touching anything else.
 *
 * The whole PPTX-template mode rests on one decision: the original OOXML is the
 * design, so it is edited rather than rebuilt. A parse-and-serialise round trip
 * would silently drop whatever the parser did not know to keep — namespaces,
 * extension lists, shape ids, the attributes PowerPoint writes for its own
 * reasons — and those are exactly the things that make a file open looking the
 * same. So this works on the raw markup and changes only what sits between
 * `<a:t>` and `</a:t>`.
 *
 * Two ideas make that safe.
 *
 * A text object is a whole box, not a run. PowerPoint splits `CAMPUS
 * JOURNALISM` into two runs whenever a word was typed at a different moment or
 * in a different colour, and replacing each run independently gives you a
 * heading cut into pieces that no longer mean anything. So runs are gathered
 * into one string for the writer, and the replacement is dealt back across the
 * same runs — which keeps a two-colour heading two-coloured.
 *
 * And nothing is inserted or deleted. Every edit is a span replacement at a
 * known offset, applied from the end backwards so earlier offsets stay valid.
 *
 * Pure: it takes markup and returns markup.
 */

export type TextRun = {
  /** Where the run's own characters sit in the part, between the `<a:t>` tags. */
  start: number;
  end: number;
  text: string;
};

export type TextParagraph = {
  runs: TextRun[];
  text: string;
};

export type TextObject = {
  /** `<p:cNvPr id="…">` — the shape's own id, stable within the slide. */
  shapeId: string;
  /** The name PowerPoint shows in the selection pane, useful to an admin. */
  shapeName: string;
  /** `title`, `body`, `subTitle`, … where the shape is a placeholder. */
  placeholder: string | null;
  paragraphs: TextParagraph[];
  /** Everything the box says, paragraphs joined by newlines. */
  text: string;
};

const BODY = /<(p:txBody|a:txBody)\b[^>]*>([\s\S]*?)<\/\1>/g;
const PARAGRAPH = /<a:p\b[^>]*(?:\/>|>([\s\S]*?)<\/a:p>)/g;
/** The characters of one run: `<a:t>` may be empty or self-closing. */
const RUN_TEXT = /<a:t\b[^>]*(?:\/>|>([\s\S]*?)<\/a:t>)/g;

/** XML's five, which are the only escapes OOXML text uses. */
export function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function encodeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The chunk of markup enclosing a body, back to the shape that owns it. */
function ownerOf(markup: string, bodyAt: number): { id: string; name: string; placeholder: string | null } {
  // The shape's non-visual properties come before its body, so the nearest
  // `<p:cNvPr>` above the body belongs to it.
  const before = markup.slice(0, bodyAt);
  const idAt = before.lastIndexOf("<p:cNvPr");
  const header = idAt === -1 ? "" : before.slice(idAt, idAt + 400);
  const id = /\bid="(\d+)"/.exec(header)?.[1] ?? "";
  const name = /\bname="([^"]*)"/.exec(header)?.[1] ?? "";

  // The placeholder marker sits between that and the body when there is one.
  const tail = idAt === -1 ? before : before.slice(idAt);
  const placeholder = /<p:ph\b[^>]*\btype="([a-zA-Z]+)"/.exec(tail)?.[1]
    ?? (/<p:ph\b/.test(tail) ? "body" : null);

  return { id, name, placeholder };
}

/**
 * Every text box in a slide part, with the offsets of its words.
 *
 * Offsets are into the string given, so a caller may edit and re-read without
 * having to track what moved — provided it edits from the end, which
 * `replaceText` does.
 */
export function readTextObjects(markup: string): TextObject[] {
  const objects: TextObject[] = [];
  BODY.lastIndex = 0;

  for (let body = BODY.exec(markup); body !== null; body = BODY.exec(markup)) {
    const inner = body[2] ?? "";
    const innerAt = body.index + body[0].indexOf(inner);
    const owner = ownerOf(markup, body.index);
    const paragraphs: TextParagraph[] = [];

    PARAGRAPH.lastIndex = 0;
    for (let paragraph = PARAGRAPH.exec(inner); paragraph !== null; paragraph = PARAGRAPH.exec(inner)) {
      const content = paragraph[1] ?? "";
      const contentAt = innerAt + paragraph.index + paragraph[0].indexOf(content);
      const runs: TextRun[] = [];

      RUN_TEXT.lastIndex = 0;
      for (let run = RUN_TEXT.exec(content); run !== null; run = RUN_TEXT.exec(content)) {
        const value = run[1];
        // A self-closing `<a:t/>` holds nothing and has nowhere to put anything.
        if (value === undefined) continue;
        const at = contentAt + run.index + run[0].indexOf(">" + value) + 1;
        runs.push({ start: at, end: at + value.length, text: decodeXml(value) });
      }

      if (runs.length > 0) paragraphs.push({ runs, text: runs.map((run) => run.text).join("") });
    }

    if (paragraphs.length > 0) {
      objects.push({
        shapeId: owner.id,
        shapeName: owner.name,
        placeholder: owner.placeholder,
        paragraphs,
        text: paragraphs.map((paragraph) => paragraph.text).join("\n"),
      });
    }
  }

  return objects;
}

/**
 * Deals one paragraph's replacement back across the runs it came from.
 *
 * The split follows the original proportions and lands on a word boundary
 * wherever one is near, because a two-colour heading is two-coloured at a
 * word, not mid-syllable. A replacement shorter than the run structure leaves
 * the later runs empty rather than dropping them: an empty run keeps its
 * formatting, and a deleted one would take the colour of the next word with it.
 */
export function dealAcrossRuns(runs: readonly TextRun[], replacement: string): string[] {
  if (runs.length === 1) return [replacement];

  const original = runs.map((run) => run.text.length);
  const total = original.reduce((sum, length) => sum + length, 0);
  if (total === 0) return runs.map((_, index) => (index === 0 ? replacement : ""));

  const out: string[] = [];
  let taken = 0;
  for (let index = 0; index < runs.length; index += 1) {
    if (index === runs.length - 1) { out.push(replacement.slice(taken)); break; }
    const share = Math.round((original[index]! / total) * replacement.length);
    let cut = Math.min(replacement.length, taken + Math.max(0, share));
    // Nudge to the nearest space within a few characters, so words stay whole.
    const window = replacement.slice(Math.max(taken, cut - 6), Math.min(replacement.length, cut + 6));
    const space = window.lastIndexOf(" ");
    if (space >= 0) cut = Math.max(taken, cut - 6) + space + 1;
    out.push(replacement.slice(taken, cut));
    taken = cut;
  }
  return out;
}

export type TextEdit = {
  /** Which box, by the shape id `readTextObjects` reported. */
  shapeId: string;
  /** One string per paragraph. Fewer empties the tail; more are ignored. */
  paragraphs: readonly string[];
};

/**
 * Applies edits to the markup, changing nothing but the words.
 *
 * Every edit is a span replacement at a known offset, applied from the end
 * backwards so the offsets read earlier stay valid. Nothing is inserted,
 * nothing is removed, and no tag is rewritten — which is what lets a slide keep
 * every attribute PowerPoint wrote and open looking exactly as it did.
 */
export function replaceText(markup: string, edits: readonly TextEdit[]): string {
  const objects = readTextObjects(markup);
  const byShape = new Map(objects.map((object) => [object.shapeId, object]));
  const spans: { start: number; end: number; text: string }[] = [];

  for (const edit of edits) {
    const object = byShape.get(edit.shapeId);
    if (!object) continue;

    object.paragraphs.forEach((paragraph, index) => {
      // A paragraph the caller said nothing about is emptied rather than left:
      // leaving it would ship the template's own words, which is the one
      // outcome this mode exists to prevent.
      const replacement = edit.paragraphs[index] ?? "";
      const pieces = dealAcrossRuns(paragraph.runs, replacement);
      paragraph.runs.forEach((run, position) => {
        spans.push({ start: run.start, end: run.end, text: encodeXml(pieces[position] ?? "") });
      });
    });
  }

  spans.sort((first, second) => second.start - first.start);
  let out = markup;
  for (const span of spans) {
    out = out.slice(0, span.start) + span.text + out.slice(span.end);
  }
  return out;
}

/** Whether any of the original words survived — the check before an export ships. */
export function remainingTemplateText(
  before: readonly TextObject[],
  after: readonly TextObject[],
): string[] {
  const written = new Set(after.map((object) => object.text.trim()).filter(Boolean));
  const left: string[] = [];
  for (const object of before) {
    const original = object.text.trim();
    // Short strings are as often a number or a mark as a sentence, and a
    // replacement may legitimately land on one.
    if (original.length < 8) continue;
    if (written.has(original)) left.push(original);
  }
  return left;
}
