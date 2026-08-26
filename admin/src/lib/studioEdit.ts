import { CANVAS_HEIGHT, CANVAS_WIDTH, type Archetype, type JslaydDocument, type JslaydElement } from "@jaxongirman/jslayd";

/**
 * Editing a compiled design, without a second model of it.
 *
 * The canvas draws `JslaydDocument` and writes `JslaydDocument` back. There is
 * deliberately no editor-shaped copy of a slide in between: the moment a drag
 * updates one structure and the code pane reads another, the two drift, and the
 * drift is invisible until somebody saves.
 *
 * So every operation here is the same shape — document in, document out, one
 * element changed — and the code pane is `decompile` of whatever comes back.
 * That round trip is asserted in `round-trip.test.mjs`; these are the mutations
 * it was asserted against.
 */

export const CANVAS = { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };

/**
 * The spacing ladder, used as the snap.
 *
 * Not a preference: an element left at x = 617 because that is where the
 * pointer went up is how a design system stops being one. Four units is the
 * finest step the ladder has, so snapping to it never fights an author who
 * meant 24 and never records where the mouse happened to be.
 */
export const SNAP = 4;

export const snap = (value: number, step = SNAP): number => Math.round(value / step) * step;

export type Box = { x: number; y: number; width: number; height: number };

/** Keep a box on the canvas, and keep it big enough to grab. */
export function clampBox(box: Box): Box {
  const width = Math.max(16, Math.min(box.width, CANVAS.width));
  const height = Math.max(16, Math.min(box.height, CANVAS.height));
  return {
    width,
    height,
    x: Math.max(0, Math.min(box.x, CANVAS.width - width)),
    y: Math.max(0, Math.min(box.y, CANVAS.height - height)),
  };
}

export const archetypeOf = (document: JslaydDocument, id: string): Archetype | null =>
  document.archetypes.find((entry) => entry.id === id) ?? null;

export const elementOf = (archetype: Archetype | null, id: string | null): JslaydElement | null =>
  (archetype && id ? archetype.elements.find((entry) => entry.id === id) ?? null : null);

/** One element replaced, everything else identical — including array order. */
export function withElement(
  document: JslaydDocument,
  archetypeId: string,
  elementId: string,
  change: (element: JslaydElement) => JslaydElement,
): JslaydDocument {
  return {
    ...document,
    archetypes: document.archetypes.map((archetype) => (archetype.id !== archetypeId ? archetype : {
      ...archetype,
      elements: archetype.elements.map((element) => (element.id !== elementId ? element : change(element))),
    })),
  };
}

export function moveElement(
  document: JslaydDocument, archetypeId: string, elementId: string, box: Box,
): JslaydDocument {
  const next = clampBox({
    x: snap(box.x), y: snap(box.y), width: snap(box.width), height: snap(box.height),
  });
  return withElement(document, archetypeId, elementId, (element) => ({
    ...element,
    geometry: { ...element.geometry, ...next },
  }));
}

export function setGeometry(
  document: JslaydDocument, archetypeId: string, elementId: string,
  patch: Partial<{ x: number; y: number; width: number; height: number; rotation: number; zIndex: number }>,
): JslaydDocument {
  return withElement(document, archetypeId, elementId, (element) => {
    const merged = { ...element.geometry, ...patch };
    const box = clampBox({ x: merged.x, y: merged.y, width: merged.width, height: merged.height });
    return { ...element, geometry: { ...merged, ...box } };
  });
}

/* ------------------------------------------------------------------ resize */

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/**
 * Where a handle drag puts the box.
 *
 * Written as arithmetic on the original box rather than as eight cases: a
 * north-west drag is the same as a south-east drag with both signs flipped, and
 * spelling that out eight times is eight chances to get one of them subtly
 * wrong.
 */
export function resizeBox(box: Box, handle: Handle, dx: number, dy: number): Box {
  const left = handle.includes("w");
  const right = handle.includes("e");
  const top = handle.includes("n");
  const bottom = handle.includes("s");

  return clampBox({
    x: box.x + (left ? dx : 0),
    y: box.y + (top ? dy : 0),
    width: box.width + (right ? dx : 0) - (left ? dx : 0),
    height: box.height + (bottom ? dy : 0) - (top ? dy : 0),
  });
}

/* ----------------------------------------------------------------- history */

/**
 * Undo that matches what a person did, not what the pointer did.
 *
 * A drag is one action. Recording a frame per pixel means twenty presses of
 * undo to put an element back where it started, which is the same as having no
 * undo. Entries are pushed when a gesture *ends*.
 */
export type History = {
  past: JslaydDocument[];
  present: JslaydDocument;
  future: JslaydDocument[];
  /**
   * Where the gesture in progress started, or null between gestures.
   *
   * This exists because the obvious version does not work: if a drag moves
   * `present` frame by frame and the end of the drag then commits `present`,
   * there is nothing left to compare against and the whole gesture records
   * nothing. The document to push is the one from *before* the drag, so it is
   * kept aside for the length of it.
   */
  anchor: JslaydDocument | null;
};

export const startHistory = (document: JslaydDocument): History =>
  ({ past: [], present: document, future: [], anchor: null });

const LIMIT = 60;

/** A change that is its own action — a nudge, an align, a field in the inspector. */
export function commit(history: History, next: JslaydDocument): History {
  if (next === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-LIMIT),
    present: next,
    future: [],
    anchor: null,
  };
}

/** Pointer down: remember where this gesture started. */
export const beginGesture = (history: History): History =>
  (history.anchor ? history : { ...history, anchor: history.present });

/** A frame of a gesture: the present moves, the past does not grow. */
export const preview = (history: History, next: JslaydDocument): History =>
  ({ ...history, present: next });

/** Pointer up: the whole gesture becomes one entry, or none if nothing moved. */
export function endGesture(history: History): History {
  const { anchor } = history;
  if (!anchor) return history;
  if (anchor === history.present) return { ...history, anchor: null };
  return {
    past: [...history.past, anchor].slice(-LIMIT),
    present: history.present,
    future: [],
    anchor: null,
  };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, LIMIT),
    anchor: null,
  };
}

export function redo(history: History): History {
  const [next, ...rest] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present].slice(-LIMIT), present: next, future: rest, anchor: null };
}

export const canUndo = (history: History): boolean => history.past.length > 0;
export const canRedo = (history: History): boolean => history.future.length > 0;

/* ------------------------------------------------------------------- align */

export type Alignment = "left" | "centerX" | "right" | "top" | "middle" | "bottom";

/** Align a set of elements against the outermost edges of the set itself. */
export function alignElements(
  document: JslaydDocument, archetypeId: string, ids: readonly string[], how: Alignment,
): JslaydDocument {
  const archetype = archetypeOf(document, archetypeId);
  if (!archetype || ids.length < 2) return document;
  const boxes = archetype.elements.filter((element) => ids.includes(element.id)).map((element) => element.geometry);
  if (boxes.length < 2) return document;

  const left = Math.min(...boxes.map((box) => box.x));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const top = Math.min(...boxes.map((box) => box.y));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));

  let next = document;
  for (const id of ids) {
    const element = archetype.elements.find((entry) => entry.id === id);
    if (!element) continue;
    const { x, y, width, height } = element.geometry;
    const patch =
      how === "left" ? { x: left }
        : how === "right" ? { x: right - width }
          : how === "centerX" ? { x: snap(left + (right - left - width) / 2) }
            : how === "top" ? { y: top }
              : how === "bottom" ? { y: bottom - height }
                : { y: snap(top + (bottom - top - height) / 2) };
    next = setGeometry(next, archetypeId, id, patch);
    void x; void y;
  }
  return next;
}

/** Even gaps between the outermost two, which stay where they are. */
export function distribute(
  document: JslaydDocument, archetypeId: string, ids: readonly string[], axis: "x" | "y",
): JslaydDocument {
  const archetype = archetypeOf(document, archetypeId);
  if (!archetype || ids.length < 3) return document;

  const ordered = archetype.elements
    .filter((element) => ids.includes(element.id))
    .slice()
    .sort((a, b) => a.geometry[axis] - b.geometry[axis]);
  if (ordered.length < 3) return document;

  const size = axis === "x" ? "width" : "height";
  const first = ordered[0]!.geometry;
  const last = ordered.at(-1)!.geometry;
  const span = (last[axis] + last[size]) - first[axis];
  const used = ordered.reduce((sum, element) => sum + element.geometry[size], 0);
  const gap = (span - used) / (ordered.length - 1);

  let next = document;
  let cursor = first[axis] + first[size] + gap;
  for (const element of ordered.slice(1, -1)) {
    next = setGeometry(next, archetypeId, element.id, { [axis]: snap(cursor) } as never);
    cursor += element.geometry[size] + gap;
  }
  return next;
}
