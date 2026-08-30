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
import type { Collision, PlacedElement, TextFit } from "./scene-geometry.ts";

export type QualityInput = {
  scene: Scene;
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

  // A page that says nothing is not a page, whatever it scores elsewhere.
  const speaks = input.scene.elements.some((element) =>
    (element.type === "text" && ["body", "bullets", "lead", "quote", "statistic"].includes(element.role))
    || element.type === "chart" || element.type === "card");
  if (!speaks) {
    faults.push({ code: "no_content", detail: "nothing on this page carries the slide's message", cost: 20 });
  }

  const score = Math.max(0, 100 - faults.reduce((total, fault) => total + fault.cost, 0));
  return {
    score,
    faults,
    density: Number(density.toFixed(3)),
    balance: Number(balance.toFixed(3)),
    signature: compositionSignature(input.scene),
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
    place: { column: 0, span: 8, row: 1, rows: 2 },
    typography: { font: "display", step: "title", color: "ink" },
    text: input.title.trim() || "Xulosa",
  }];
  const body = [input.message, input.supporting].filter((one) => one && one.trim()).join(" ").trim();
  if (body) {
    elements.push({
      type: "text",
      role: "body",
      place: { column: 0, span: 7, row: 3, rows: 4 },
      typography: { font: "body", step: "body", color: "ink" },
      text: body,
    });
  }
  return { purpose: input.title, background: { kind: "solid", color: "background" }, elements };
}
