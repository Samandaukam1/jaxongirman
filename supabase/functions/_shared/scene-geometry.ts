/**
 * Turning a placement into a rectangle, and then checking the rectangles.
 *
 * This is the deterministic half of the engine. A model decides that the title
 * belongs in the left five columns of the second band; this decides what that
 * means in pixels, and whether the result actually works — whether anything
 * overlaps, whether anything leaves the page, whether the type fits the box it
 * was given.
 *
 * Keeping the two apart is the point. A model asked to produce coordinates
 * produces plausible ones, and plausible coordinates overlap; a model asked to
 * produce intent, checked by arithmetic, produces layouts that hold.
 */

import { charactersPerLine, densityFor, linesThatFit } from "./jslayd/text-metrics.ts";
import {
  CANVAS, GRID, TYPE_SCALE,
  type Box, type Placement, type Scene, type SceneElement, type TypeStep,
} from "./scene-spec.ts";

/* --------------------------------------------------------------- geometry */

const inner = {
  x: GRID.margin,
  y: GRID.margin,
  width: CANVAS.width - GRID.margin * 2,
  height: CANVAS.height - GRID.margin * 2,
};

/** One column's width, gutters removed from the run rather than added to it. */
const columnWidth = (inner.width - GRID.gutter * (GRID.columns - 1)) / GRID.columns;
const rowHeight = (inner.height - GRID.gutter * (GRID.rows - 1)) / GRID.rows;

export function compilePlacement(place: Placement): Box {
  if (place.bleed) {
    // The one escape from the safe area, and it covers the page by definition:
    // a photograph that bleeds and stops short of an edge is a mistake nobody
    // meant, so the compiler does not offer that possibility.
    return { x: 0, y: 0, width: CANVAS.width, height: CANVAS.height };
  }
  const x = inner.x + place.column * (columnWidth + GRID.gutter);
  const y = inner.y + place.row * (rowHeight + GRID.gutter);
  const width = place.span * columnWidth + (place.span - 1) * GRID.gutter;
  const height = place.rows * rowHeight + (place.rows - 1) * GRID.gutter;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export type PlacedElement = {
  element: SceneElement;
  box: Box;
  /** Where it sits in a card, for messages that have to name it. */
  path: string;
};

/**
 * Every element with its rectangle, cards flattened.
 *
 * A card's children are placed *inside* the card rather than on the page grid:
 * a card that says "three columns wide" and a caption inside it that says "one
 * column wide" mean different things by "column", and treating them the same
 * is how a caption ends up outside the card it belongs to.
 */
export function placeScene(scene: Scene): PlacedElement[] {
  const placed: PlacedElement[] = [];

  const walk = (elements: readonly SceneElement[], path: string, within: Box | null) => {
    elements.forEach((element, index) => {
      const here = `${path}[${index}]`;
      const box = within ? insideCard(element.place, within) : compilePlacement(element.place);
      placed.push({ element, box, path: here });
      if (element.type === "card") walk(element.children, `${here}.children`, box);
    });
  };

  walk(scene.elements, "elements", null);
  return placed;
}

/** The padding a card keeps between its edge and whatever it holds. */
export const CARD_PADDING = 40;

function insideCard(place: Placement, card: Box): Box {
  const usable = {
    x: card.x + CARD_PADDING,
    y: card.y + CARD_PADDING,
    width: Math.max(1, card.width - CARD_PADDING * 2),
    height: Math.max(1, card.height - CARD_PADDING * 2),
  };
  // Children are placed on the card's own grid, which is as many columns and
  // rows as the child asked for out of the card's span.
  const columns = Math.max(1, place.column + place.span);
  const rows = Math.max(1, place.row + place.rows);
  const width = usable.width / columns;
  const height = usable.height / rows;
  return {
    x: Math.round(usable.x + place.column * width),
    y: Math.round(usable.y + place.row * height),
    width: Math.round(place.span * width),
    height: Math.round(place.rows * height),
  };
}

/* -------------------------------------------------------------- collisions */

export type Collision = { a: string; b: string; area: number };

const overlap = (a: Box, b: Box): number => {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
};

/**
 * What may sit on top of what.
 *
 * A full-bleed photograph is the page's ground, and text over it is the whole
 * point of a cover — so an image that bleeds is a background rather than a
 * neighbour. Everything else is a neighbour: two pieces of type, a caption and
 * a chart, a decorative rule crossing a paragraph. Decoration is included
 * deliberately, because a thin line through a sentence is exactly the kind of
 * thing that looks intentional in a mockup and wrong on a slide.
 */
const isGround = (entry: PlacedElement): boolean =>
  entry.element.type === "image" && Boolean(entry.element.place.bleed);

/** A card contains its children; that is not a collision. */
const contains = (outer: Box, box: Box): boolean =>
  box.x >= outer.x - 1 && box.y >= outer.y - 1
  && box.x + box.width <= outer.x + outer.width + 1
  && box.y + box.height <= outer.y + outer.height + 1;

export function findCollisions(placed: readonly PlacedElement[], tolerance = 4): Collision[] {
  const collisions: Collision[] = [];
  const cards = placed.filter((entry) => entry.element.type === "card");

  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i]!;
      const b = placed[j]!;
      if (isGround(a) || isGround(b)) continue;
      // A card and what it holds, or two children of one card measured against
      // their own card.
      if (a.element.type === "card" && b.path.startsWith(`${a.path}.children`)) continue;
      if (b.element.type === "card" && a.path.startsWith(`${b.path}.children`)) continue;
      if (cards.some((card) => contains(card.box, a.box) && card.path === b.path)) continue;

      const area = overlap(a.box, b.box);
      // A hairline of overlap is rounding, not a design fault.
      if (area <= tolerance * tolerance) continue;
      collisions.push({ a: a.path, b: b.path, area: Math.round(area) });
    }
  }
  return collisions;
}

/** Anything that leaves the page. Bleed is allowed to; nothing else is. */
export function findOutOfBounds(placed: readonly PlacedElement[]): string[] {
  return placed
    .filter((entry) => !entry.element.place.bleed)
    .filter((entry) =>
      entry.box.x < -1 || entry.box.y < -1
      || entry.box.x + entry.box.width > CANVAS.width + 1
      || entry.box.y + entry.box.height > CANVAS.height + 1)
    .map((entry) => entry.path);
}

/* ------------------------------------------------------------------- text */

/** The line height a step is set at when the scene does not say. */
const LINE_HEIGHT: Record<TypeStep, number> = {
  display: 1.02,
  title: 1.06,
  heading: 1.12,
  lead: 1.35,
  body: 1.5,
  caption: 1.45,
  micro: 1.4,
  statistic: 0.96,
};

export type TextFit = {
  path: string;
  fits: boolean;
  characters: number;
  capacity: number;
  lines: number;
  maximumLines: number;
};

/**
 * Whether the words fit the rectangle they were placed in.
 *
 * Measured, not guessed, and never answered by making the type smaller: a
 * scene whose copy does not fit is a scene to repair — shorter copy, a taller
 * box, a different composition — because type that shrinks to fit is how one
 * slide ends up set four points below its neighbours for a reason no reader
 * can see.
 */
export function measureText(placed: readonly PlacedElement[], language = "uz"): TextFit[] {
  const density = densityFor(language);
  return placed
    .filter((entry): entry is PlacedElement & { element: Extract<SceneElement, { type: "text" }> } =>
      entry.element.type === "text")
    .map((entry) => {
      const { typography, text } = entry.element;
      const fontSize = TYPE_SCALE[typography.step];
      const lineHeight = typography.lineHeight ?? LINE_HEIGHT[typography.step];
      const style = { fontSize, lineHeight, maxLines: null };
      const perLine = Math.max(1, Math.floor(charactersPerLine(entry.box.width, style) * density));
      const maximumLines = Math.max(1, linesThatFit(entry.box.height, style));

      const written = text.trim().split("\n");
      const lines = written.reduce((total, line) => total + Math.max(1, Math.ceil(line.length / perLine)), 0);
      return {
        path: entry.path,
        fits: lines <= maximumLines,
        characters: text.trim().length,
        capacity: perLine * maximumLines,
        lines,
        maximumLines,
      };
    });
}
