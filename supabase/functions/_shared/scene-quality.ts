/**
 * What a slide scores, computed rather than asked.
 *
 * A model can be asked whether a slide looks good and will say yes. So the
 * things that can be measured are measured here — overlap, overflow, how much
 * of the page is used, where its weight sits, whether one element is clearly
 * the loudest — and the score is arithmetic over those. A critic model may
 * still be asked for judgement the arithmetic cannot reach; it is scored
 * separately and cannot overrule a collision.
 *
 * The numbers are penalties from 100 rather than points toward it, because
 * every criterion here describes a way a slide is wrong. A page with nothing
 * wrong with it scores 100 and needs no repair.
 */

import {
  CANVAS, GRID, TYPE_SCALE,
  type Scene, type SceneElement,
} from "./scene-spec.ts";
import { measureText, placeScene } from "./scene-geometry.ts";
import type { Collision, PlacedElement, TextFit } from "./scene-geometry.ts";

export type QualityInput = {
  scene: Scene;
  /**
   * What the slide before this one looked like.
   *
   * Repetition was detected across the finished deck and reported, which is
   * useful for an audit and too late for the deck. Scored here instead, a
   * repeated composition is a fault like any other and the repair pass — which
   * already works — fixes it while the slide is still being made.
   */
  previousSignature?: string | null;
  placed: readonly PlacedElement[];
  fits: readonly TextFit[];
  collisions: readonly Collision[];
  outOfBounds: readonly string[];
};

export type QualityReport = {
  score: number;
  /** Named so a repair pass can act on the worst one rather than guessing. */
  faults: Array<{ code: string; detail: string; cost: number }>;
  density: number;
  balance: number;
  signature: string;
};

const SAFE_AREA = (CANVAS.width - GRID.margin * 2) * (CANVAS.height - GRID.margin * 2);

/** Elements that carry meaning, as opposed to ground and ornament. */
const isContent = (element: SceneElement): boolean =>
  element.type === "text" || element.type === "chart" || element.type === "card"
  || (element.type === "image" && !element.place.bleed);

export function compositionSignature(scene: Scene): string {
  /**
   * What this composition *is*, in a form two slides can be compared by.
   *
   * Element kinds and the cells they occupy, not their words: two slides
   * saying different things in the identical arrangement are the repetition a
   * reader notices, and two slides saying similar things in different
   * arrangements are not.
   */
  const parts = scene.elements.map((element) => {
    const role = element.type === "text" ? element.role : element.type === "shape" ? element.kind : element.type;
    const { column, span, row, rows, bleed } = element.place;
    return `${role}@${bleed ? "bleed" : `${column},${row},${span}x${rows}`}`;
  });
  return `${scene.background.kind}|${parts.sort().join("|")}`;
}

export function scoreScene(input: QualityInput): QualityReport {
  const faults: QualityReport["faults"] = [];

  /**
   * Overlap and overflow are not style opinions.
   *
   * They are the two faults a reader sees before they read anything, and no
   * amount of good typography compensates for either — so each one alone puts
   * a slide below any threshold worth having.
   */
  for (const collision of input.collisions) {
    faults.push({ code: "collision", detail: `${collision.a} over ${collision.b}`, cost: 30 });
  }
  for (const path of input.outOfBounds) {
    faults.push({ code: "out_of_bounds", detail: path, cost: 30 });
  }
  for (const fit of input.fits) {
    if (fit.fits) continue;
    faults.push({
      code: "overflow",
      detail: `${fit.path}: ${fit.lines} lines in room for ${fit.maximumLines}`,
      cost: 25,
    });
  }

  /**
   * How much of the page is doing work.
   *
   * Both ends are faults. A page at a tenth is the "half-empty slide with one
   * paragraph" nobody wants; a page past three quarters has no air left, and
   * air is what separates a designed page from a filled one.
   */
  const contentArea = input.placed
    .filter((entry) => isContent(entry.element) && !entry.path.includes(".children"))
    .reduce((total, entry) => total + entry.box.width * entry.box.height, 0);
  const density = Math.min(2, contentArea / SAFE_AREA);
  if (density < 0.3) {
    faults.push({ code: "sparse", detail: `${(density * 100).toFixed(0)}% of the page is used`, cost: 18 });
  } else if (density > 0.88) {
    faults.push({ code: "crowded", detail: `${(density * 100).toFixed(0)}% of the page is used`, cost: 12 });
  }

  /**
   * Where the weight sits.
   *
   * Measured as the centre of mass of the content against the centre of the
   * page. Editorial layouts are deliberately off-centre, so this is generous —
   * it catches everything piled into one corner, not asymmetry.
   */
  const weighted = input.placed.filter((entry) => isContent(entry.element) && !entry.path.includes(".children"));
  let balance = 0;
  if (weighted.length > 0) {
    const total = weighted.reduce((sum, entry) => sum + entry.box.width * entry.box.height, 0) || 1;
    const centreX = weighted.reduce((sum, entry) => sum + (entry.box.x + entry.box.width / 2) * entry.box.width * entry.box.height, 0) / total;
    const centreY = weighted.reduce((sum, entry) => sum + (entry.box.y + entry.box.height / 2) * entry.box.width * entry.box.height, 0) / total;
    const offX = Math.abs(centreX - CANVAS.width / 2) / (CANVAS.width / 2);
    const offY = Math.abs(centreY - CANVAS.height / 2) / (CANVAS.height / 2);
    balance = Math.hypot(offX, offY);
    if (balance > 0.55) {
      faults.push({ code: "unbalanced", detail: `weight sits ${(balance * 100).toFixed(0)}% off centre`, cost: 14 });
    }
  }

  /**
   * One loudest thing.
   *
   * A page where two elements are set at the same largest size has no
   * hierarchy: the reader's eye has nowhere to land first. Two titles is the
   * usual way this happens.
   */
  const texts = input.scene.elements.filter((element): element is Extract<SceneElement, { type: "text" }> => element.type === "text");
  if (texts.length > 0) {
    const biggest = Math.max(...texts.map((element) => TYPE_SCALE[element.typography.step]));
    const dominant = texts.filter((element) => TYPE_SCALE[element.typography.step] === biggest);
    if (dominant.length > 1 && biggest >= TYPE_SCALE.heading) {
      faults.push({ code: "no_hierarchy", detail: `${dominant.length} elements share the largest size`, cost: 12 });
    }
  }

  /**
   * A page with no heading is a paragraph somebody left on a screen.
   *
   * The first deck through the real pipeline came back with pages of one
   * element: a body, scoring full marks, with nothing saying what it was
   * about. Density and balance were both happy, because a single large block
   * is well balanced and uses the page — which is how a measure can be right
   * and still miss the point.
   */
  const headed = texts.some((element) => ["title", "subtitle", "eyebrow"].includes(element.role));
  if (texts.length > 0 && !headed) {
    faults.push({ code: "no_heading", detail: "nothing on this page says what it is about", cost: 16 });
  }

  // A page that says nothing is not a page, whatever it scores elsewhere.
  const speaks = input.scene.elements.some((element) =>
    (element.type === "text" && ["body", "bullets", "lead", "quote", "statistic"].includes(element.role))
    || element.type === "chart" || element.type === "card");
  if (!speaks) {
    faults.push({ code: "no_content", detail: "nothing on this page carries the slide's message", cost: 20 });
  }

  const signature = compositionSignature(input.scene);
  if (input.previousSignature) {
    const alike = similarity(input.previousSignature, signature);
    if (alike >= 0.8) {
      faults.push({
        code: "repeats",
        detail: `${Math.round(alike * 100)}% the same arrangement as the slide before it`,
        cost: 15,
      });
    }
  }

  const score = Math.max(0, 100 - faults.reduce((total, fault) => total + fault.cost, 0));
  return {
    score,
    faults,
    density: Number(density.toFixed(3)),
    balance: Number(balance.toFixed(3)),
    signature,
  };
}

/**
 * How alike two compositions are, 0–1.
 *
 * Jaccard over the signature's parts: the share of arrangement the two slides
 * have in common. A deck where every page scores well on its own but every
 * page is the same page is the failure this catches.
 */
export function similarity(a: string, b: string): number {
  const left = new Set(a.split("|"));
  const right = new Set(b.split("|"));
  const shared = [...left].filter((part) => right.has(part)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : shared / union;
}

/** Which slides repeat the composition before them closely enough to redesign. */
export function findRepetition(signatures: readonly string[], threshold = 0.8): number[] {
  const repeats: number[] = [];
  for (let at = 1; at < signatures.length; at += 1) {
    if (similarity(signatures[at - 1]!, signatures[at]!) >= threshold) repeats.push(at);
  }
  return repeats;
}


/* --------------------------------------------------------- content rescue */

/** Whether anything on this page carries what the slide is trying to say. */
export function speaks(scene: Scene): boolean {
  return scene.elements.some((element) =>
    (element.type === "text" && ["body", "bullets", "lead", "quote", "statistic"].includes(element.role))
    || element.type === "chart"
    || element.type === "card");
}

/**
 * A band of the grid with nothing in it, wide enough to hold a paragraph.
 *
 * Searched from the bottom, because a page missing its content almost always
 * has a heading at the top and space under it — and text added below a title
 * reads as the page's body rather than as an afterthought floating above it.
 */
export function freeBand(scene: Scene, wantRows = 3): { column: number; span: number; row: number; rows: number } | null {
  const taken = new Set<string>();
  for (const element of scene.elements) {
    if (element.place.bleed) continue;
    for (let row = element.place.row; row < element.place.row + element.place.rows; row += 1) {
      for (let column = element.place.column; column < element.place.column + element.place.span; column += 1) {
        taken.add(`${column},${row}`);
      }
    }
  }

  for (let rows = wantRows; rows >= 2; rows -= 1) {
    for (let row = GRID.rows - rows; row >= 0; row -= 1) {
      for (const span of [7, 6, 5]) {
        for (let column = 0; column + span <= GRID.columns; column += 1) {
          let free = true;
          for (let r = row; r < row + rows && free; r += 1) {
            for (let c = column; c < column + span; c += 1) {
              if (taken.has(`${c},${r}`)) { free = false; break; }
            }
          }
          if (free) return { column, span, row, rows };
        }
      }
    }
  }
  return null;
}

/**
 * Give a silent page the sentence the brief already wrote for it.
 *
 * Not invention: the brief is the model's own statement of what this slide is
 * for, produced before any composition existed. A page that ends up with a
 * heading, a photograph and nothing else is a page whose own message was left
 * out, and putting it back is a repair the engine can make without asking
 * anybody.
 */
export function withRescuedContent(scene: Scene, message: string): Scene {
  if (speaks(scene) || !message.trim()) return scene;
  const place = freeBand(scene);
  if (!place) return scene;
  return {
    ...scene,
    elements: [...scene.elements, {
      type: "text",
      role: "body",
      place,
      typography: { font: "body", step: "body", color: "ink" },
      text: message.trim(),
    }],
  };
}


/**
 * A page built from the brief alone, when the model produced nothing usable.
 *
 * Three attempts at one slide came back with every element empty, and the run
 * before that lost the same page twice. A deck missing its conclusion is worse
 * than a plain conclusion, and the brief already contains the words: it is the
 * model's own statement of what the slide is for, written before any
 * composition existed. Nothing is invented here — only placed.
 *
 * Recorded as synthesised by the caller, so nothing pretends this page was
 * designed.
 */
export function sceneFromBrief(input: { title: string; message: string; supporting?: string | null }): Scene {
  const elements: Scene["elements"] = [{
    type: "text",
    role: "title",
    // Wide, because a page of two elements has to earn the space it is on:
    // the first fallback pages scored as sparse, which is a plain page and a
    // thin one rather than a plain page that reads.
    place: { column: 0, span: 10, row: 1, rows: 2 },
    typography: { font: "display", step: "title", color: "ink" },
    text: input.title.trim() || "Xulosa",
  }];
  const body = [input.message, input.supporting].filter((one) => one && one.trim()).join(" ").trim();
  if (body) {
    elements.push({
      type: "text",
      role: "body",
      place: { column: 0, span: 9, row: 3, rows: 4 },
      typography: { font: "body", step: "body", color: "ink" },
      text: body,
    });
  }

  const scene: Scene = { purpose: input.title, background: { kind: "solid", color: "background" }, elements };
  if (!body) return scene;

  /**
   * Cut to what the box holds.
   *
   * This page exists to replace one that scored badly, and a replacement that
   * overflows is not a replacement: the caller keeps whichever scores higher,
   * so a fallback overflowing by the same amount left a broken page in the
   * deck. Measured against the band it was just placed in, and cut at a word
   * boundary — the words are the brief's, so losing the tail of one costs
   * nothing a reader will miss.
   */
  // Whatever overflows, not only the body: a long title in a two-line band
  // overflows exactly as readily, and left alone it kept this page at 75 —
  // which is the score the page was built to replace.
  return withTrimmedText(scene);
}


/**
 * The same composition, the other way round.
 *
 * A model told its slide repeats the one before it returns something very
 * similar again — twice, in a real run. Mirroring is the answer arithmetic can
 * give: every element keeps its size, its treatment and its words, and the
 * page reads left-to-right instead of right-to-left. A picture that was beside
 * the text on the right is beside it on the left, which is a different
 * composition by any measure a reader applies and by the signature's.
 *
 * Full-bleed elements are left alone: a photograph covering the page has no
 * side to be on.
 */
export function mirrorScene(scene: Scene): Scene {
  return {
    ...scene,
    elements: scene.elements.map((element) => {
      if (element.place.bleed) return element;
      const column = GRID.columns - (element.place.column + element.place.span);
      return { ...element, place: { ...element.place, column: Math.max(0, column) } };
    }),
  };
}


/**
 * The line naming who made the deck, put on the cover when the model left it
 * out.
 *
 * Asked for in the prompt and omitted anyway — twice, with the names supplied
 * as finished text. It is not a design decision: an academic deck carries the
 * student's and the teacher's names, and a cover without them is one the
 * author has to fix by hand every time.
 *
 * Placed on the last band, which on a cover is under the title by
 * construction, and only where nothing is there already.
 */
export function withCoverCredit(scene: Scene, line: string): Scene {
  const wanted = line.trim();
  if (!wanted) return scene;

  const already = scene.elements.some((element) =>
    element.type === "text" && element.text.includes(wanted.split(" · ")[0]!));
  if (already) return scene;

  /**
   * Room on the last band, by column rather than by row.
   *
   * Looking for an empty row gave up whenever the model had put anything at
   * the foot of the cover — and then the deck went out with nobody's name on
   * it. A credit line is narrow; what it needs is a gap, not a whole band.
   */
  const occupied = (row: number): Set<number> => {
    const columns = new Set<number>();
    for (const element of scene.elements) {
      if (element.place.bleed) continue;
      if (row < element.place.row || row >= element.place.row + element.place.rows) continue;
      for (let column = element.place.column; column < element.place.column + element.place.span; column += 1) {
        columns.add(column);
      }
    }
    return columns;
  };

  let row = -1;
  let column = 0;
  let span = 0;
  for (const candidate of [GRID.rows - 1, GRID.rows - 2, GRID.rows - 3]) {
    const used = occupied(candidate);
    let start = 0;
    let run = 0;
    for (let at = 0; at <= GRID.columns; at += 1) {
      if (at < GRID.columns && !used.has(at)) {
        if (run === 0) start = at;
        run += 1;
        continue;
      }
      if (run > span) { span = run; column = start; row = candidate; }
      run = 0;
    }
    // Three columns is enough for a name at caption size and narrow enough to
    // fit beside whatever the model put at the foot of the page.
    if (span >= 3) break;
    span = 0;
  }
  if (row < 0 || span < 3) return scene;

  /**
   * White, because a cover is a photograph.
   *
   * `onImage` is the one colour that does not follow the palette: what is
   * underneath is a picture nobody has seen, and the scrim is what makes this
   * readable.
   */
  return {
    ...scene,
    elements: [...scene.elements, {
      type: "text",
      role: "caption",
      place: { column, span: Math.min(span, 8), row, rows: 1 },
      typography: { font: "body", step: "caption", color: "onImage" },
      text: wanted,
    }],
  };
}


/**
 * Copy cut to the boxes it was put in.
 *
 * The last resort before giving up on a page the model designed. Three repairs
 * asked it to shorten and it returned the same sentence each time, so the page
 * scored 75 and was replaced by a plain two-element fallback — a correct trade
 * and a poor one, because the composition it threw away had five elements and
 * a picture.
 *
 * Cutting is arithmetic: the box's capacity is known, the words are the
 * model's own, and a sentence one clause shorter is not a page anybody
 * notices. The type size is never touched — that is the fix this whole engine
 * exists to avoid.
 */
export function withTrimmedText(scene: Scene): Scene {
  const placed = placeScene(scene);
  const overflowing = measureText(placed).filter((fit) => !fit.fits);
  if (overflowing.length === 0) return scene;

  const byPath = new Map(overflowing.map((fit) => [fit.path, fit]));
  const elements = scene.elements.map((element, index) => {
    const fit = byPath.get(`elements[${index}]`);
    if (!fit || element.type !== "text") return element;
    const room = Math.max(24, fit.capacity - 1);
    if (element.text.length <= room) return element;
    const cut = element.text.slice(0, room);
    const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    const boundary = sentence > room * 0.5 ? sentence + 1 : cut.lastIndexOf(" ");
    return { ...element, text: (boundary > room * 0.4 ? cut.slice(0, boundary) : cut).trimEnd() };
  });
  return { ...scene, elements };
}


/**
 * A cover without a photograph on it.
 *
 * Asked for in the prompt with the JSON spelled out, and produced two runs in
 * three. The third came back as type on a plain ground — correct, and not what
 * anybody means by a cover. So the engine adds the picture when the model does
 * not, with the deck's own subject as the intent: the image service decides
 * what that means and refuses if it cannot prove one, exactly as everywhere
 * else.
 *
 * Added first so it sits underneath, with a scrim, because the type already on
 * the page was written to be read against something.
 */
export function withCoverImage(scene: Scene, topic: string): Scene {
  const already = scene.elements.some((element) => element.type === "image" && element.place.bleed)
    || scene.background.kind === "image";
  if (already || !topic.trim()) return scene;

  return {
    ...scene,
    elements: [
      {
        type: "image",
        place: { column: 0, span: 12, row: 0, rows: 8, bleed: true },
        treatment: "full_bleed",
        overlay: "scrim_bottom",
        intent: { query: topic.trim(), orientation: "landscape" },
      },
      ...scene.elements.map((element) =>
        // Type over a photograph is white; the palette's ink was chosen for a
        // ground this page no longer has.
        element.type === "text"
          ? { ...element, typography: { ...element.typography, color: "onImage" as const } }
          : element),
    ],
  };
}
