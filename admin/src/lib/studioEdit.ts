import {
  CANVAS_HEIGHT, CANVAS_WIDTH,
  type Archetype, type Border, type ColorValue, type Corners, type Gradient, type GradientStop,
  type JslaydDocument, type JslaydElement, type Shadow,
} from "@jaxongirman/jslayd";

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

/* -------------------------------------------------------------------- fill */

/**
 * A fill is a colour or a gradient, and the language is strict about both.
 *
 * Stops are sorted by offset and there are never fewer than two — a "gradient"
 * with one stop is a colour that will surprise whoever reads the document, and
 * an unsorted one renders differently in different engines. Both rules are kept
 * here rather than trusted to the editor's UI, because the UI is not the only
 * thing that will ever write a fill.
 */
export type Fill = ColorValue | Gradient | null;

const ordered = (stops: readonly GradientStop[]): GradientStop[] =>
  stops.slice().sort((a, b) => a.offset - b.offset);

export function setFill(
  document: JslaydDocument, archetypeId: string, elementId: string, fill: Fill,
): JslaydDocument {
  const value = fill && typeof fill === "object" && "stops" in fill
    ? { ...fill, stops: ordered(fill.stops) }
    : fill;
  return withElement(document, archetypeId, elementId, (element) => ({
    ...element, background: value,
  } as typeof element));
}

export const gradientOf = (element: JslaydElement | null): Gradient | null => {
  const background = (element as { background?: unknown } | null)?.background;
  return background && typeof background === "object" && "stops" in background
    ? background as Gradient
    : null;
};

/**
 * A gradient built from a preset, in this design's own colours.
 *
 * The preset names roles, not hex, so the same preset is a different gradient
 * under a different palette — which is what makes changing theme move a slide's
 * gradients with it instead of leaving them behind.
 */
export function gradientFromPreset(
  preset: { type: "linear" | "radial"; angle: number; stops: readonly { role: string; position: number; opacity?: number }[] },
): Gradient {
  return {
    type: preset.type,
    angle: preset.angle,
    stops: ordered(preset.stops.map((stop) => ({
      offset: stop.position,
      // Kept as a role rather than resolved to hex: resolving here would
      // freeze the gradient to whichever palette happened to be selected.
      color: { role: stop.role } as ColorValue,
    }))),
  };
}

export function setStop(
  document: JslaydDocument, archetypeId: string, elementId: string,
  index: number, patch: Partial<GradientStop>,
): JslaydDocument {
  const archetype = archetypeOf(document, archetypeId);
  const gradient = gradientOf(elementOf(archetype, elementId));
  if (!gradient || !gradient.stops[index]) return document;
  const stops = gradient.stops.map((stop, at) => (at === index ? { ...stop, ...patch } : stop));
  return setFill(document, archetypeId, elementId, { ...gradient, stops });
}

/** A new stop halfway to the next one, so it lands somewhere visible. */
export function addStop(
  document: JslaydDocument, archetypeId: string, elementId: string,
): JslaydDocument {
  const archetype = archetypeOf(document, archetypeId);
  const gradient = gradientOf(elementOf(archetype, elementId));
  if (!gradient) return document;

  const stops = ordered(gradient.stops);
  let widest = { at: 0, gap: -1 };
  for (let at = 0; at < stops.length - 1; at += 1) {
    const gap = stops[at + 1]!.offset - stops[at]!.offset;
    if (gap > widest.gap) widest = { at, gap };
  }
  const before = stops[widest.at]!;
  const after = stops[widest.at + 1] ?? before;
  const inserted: GradientStop = {
    offset: Math.round((before.offset + after.offset) / 2),
    color: after.color,
  };
  return setFill(document, archetypeId, elementId, { ...gradient, stops: [...stops, inserted] });
}

/** Removing a stop is refused when it would leave fewer than two. */
export function removeStop(
  document: JslaydDocument, archetypeId: string, elementId: string, index: number,
): JslaydDocument {
  const archetype = archetypeOf(document, archetypeId);
  const gradient = gradientOf(elementOf(archetype, elementId));
  if (!gradient || gradient.stops.length <= 2) return document;
  return setFill(document, archetypeId, elementId, {
    ...gradient,
    stops: gradient.stops.filter((_, at) => at !== index),
  });
}

/* ------------------------------------------------------------------ layers */

/**
 * The stacking order, as a list rather than as a pile of numbers.
 *
 * A layers panel that edits `zIndex` directly makes the author do the
 * arithmetic — move this above that, discover they now share a number, pick a
 * gap. The panel reorders a list; this turns the list back into indices, spaced
 * one apart from the bottom, so the numbers stay small and no two elements
 * collide.
 */
export function reorder(
  document: JslaydDocument, archetypeId: string, orderedIds: readonly string[],
): JslaydDocument {
  const archetype = archetypeOf(document, archetypeId);
  if (!archetype) return document;

  const rank = new Map(orderedIds.map((id, index) => [id, index + 1]));
  return {
    ...document,
    archetypes: document.archetypes.map((entry) => (entry.id !== archetypeId ? entry : {
      ...entry,
      elements: entry.elements.map((element) => {
        const zIndex = rank.get(element.id);
        return zIndex === undefined || zIndex === element.geometry.zIndex
          ? element
          : { ...element, geometry: { ...element.geometry, zIndex } };
      }),
    })),
  };
}

/** Bottom-first, which is the order a layers panel reads from the bottom up. */
export function stackingOrder(archetype: Archetype | null): JslaydElement[] {
  if (!archetype) return [];
  return archetype.elements.slice().sort((a, b) => (
    a.geometry.zIndex - b.geometry.zIndex
    // A stable tie-break, so two elements sharing a z do not swap on every render.
    || archetype.elements.indexOf(a) - archetype.elements.indexOf(b)
  ));
}

/** An id nothing in the slide is using, derived from the one being copied. */
export function freeId(archetype: Archetype, base: string): string {
  const taken = new Set(archetype.elements.map((element) => element.id));
  const root = base.replace(/_copy\d*$/, "");
  // `title_copy`, then `title_copy2`, `title_copy3` — counting from the first
  // suffixed name rather than from the number, so nothing is skipped.
  for (let n = 1; n < 500; n += 1) {
    const candidate = n === 1 ? `${root}_copy` : `${root}_copy${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}_${Date.now()}`;
}

/** A copy, offset so it is visibly a copy rather than hidden under the original. */
export function duplicateElement(
  document: JslaydDocument, archetypeId: string, elementId: string,
): { document: JslaydDocument; id: string | null } {
  const archetype = archetypeOf(document, archetypeId);
  const element = elementOf(archetype, elementId);
  if (!archetype || !element) return { document, id: null };

  const id = freeId(archetype, element.id);
  const copy: JslaydElement = {
    ...element,
    id,
    geometry: {
      ...element.geometry,
      ...clampBox({
        x: element.geometry.x + 24, y: element.geometry.y + 24,
        width: element.geometry.width, height: element.geometry.height,
      }),
      zIndex: element.geometry.zIndex + 1,
    },
  };

  return {
    id,
    document: {
      ...document,
      archetypes: document.archetypes.map((entry) => (entry.id !== archetypeId ? entry : {
        ...entry,
        elements: [...entry.elements, copy],
      })),
    },
  };
}

export function removeElement(
  document: JslaydDocument, archetypeId: string, elementId: string,
): JslaydDocument {
  return {
    ...document,
    archetypes: document.archetypes.map((entry) => (entry.id !== archetypeId ? entry : {
      ...entry,
      elements: entry.elements.filter((element) => element.id !== elementId),
    })),
  };
}

/**
 * Renaming an element is renaming its id, which is what the language calls it.
 *
 * Refused when the name is taken: two elements with one id is a design that
 * compiles to something other than what is on screen.
 */
export function renameElement(
  document: JslaydDocument, archetypeId: string, elementId: string, next: string,
): { document: JslaydDocument; error: string | null } {
  const archetype = archetypeOf(document, archetypeId);
  if (!archetype) return { document, error: null };

  const clean = next.trim();
  if (!/^[a-z][a-z0-9_]*$/i.test(clean)) {
    return { document, error: "Nom harf bilan boshlanib, faqat harf, raqam va _ dan iborat bo‘lsin." };
  }
  if (clean !== elementId && archetype.elements.some((element) => element.id === clean)) {
    return { document, error: "Bu nom band." };
  }
  return {
    error: null,
    document: withElement(document, archetypeId, elementId, (element) => ({ ...element, id: clean })),
  };
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

/* ------------------------------------------------------ border and corners */

/**
 * A border is all four of its parts or none of them.
 *
 * The language has no partial border — `{width: 2}` with no colour is not a
 * thin border, it is a document a renderer has to guess at, and §16 is explicit
 * that a renderer never guesses. So switching one on writes a complete border
 * and switching it off writes null, rather than leaving a husk behind with a
 * zero width that every exporter then has to decide about.
 */
export const DEFAULT_BORDER: Border = { width: 2, color: { role: "border" }, style: "solid", opacity: 1 };

/**
 * Which elements carry which box properties, taken from the language.
 *
 * Not `"border" in element`. That reads true only because the compiler happens
 * to emit an explicit null for every field, so the guard silently depends on an
 * emit detail — and it answers "no" for a hand-built element and for anything a
 * future compiler leaves out. An icon has no border because `IconElement` does
 * not define one, and that is a fact about the language, so it is written as
 * one. Adding a property an element's type does not define produces a document
 * that appears to save and loses the change on the next read.
 */
const TAKES_BORDER = new Set([
  "text", "quote", "number", "badge", "image", "frame",
  "shape", "divider", "decorative", "line", "stat",
]);
const TAKES_CORNERS = new Set([...TAKES_BORDER, "table"]);
const TAKES_SHADOW = new Set(["image", "frame", "shape", "divider", "decorative", "line", "stat"]);

export const takesBorder = (element: JslaydElement | null): boolean => Boolean(element && TAKES_BORDER.has(element.type));
export const takesCorners = (element: JslaydElement | null): boolean => Boolean(element && TAKES_CORNERS.has(element.type));
export const takesShadow = (element: JslaydElement | null): boolean => Boolean(element && TAKES_SHADOW.has(element.type));

export function setBorder(
  document: JslaydDocument, archetypeId: string, elementId: string, border: Border | null,
): JslaydDocument {
  return withElement(document, archetypeId, elementId, (element) => (
    takesBorder(element) ? { ...element, border } : element));
}

export function patchBorder(
  document: JslaydDocument, archetypeId: string, elementId: string, patch: Partial<Border>,
): JslaydDocument {
  const element = elementOf(archetypeOf(document, archetypeId), elementId);
  const current = (element as { border?: Border | null } | null)?.border ?? DEFAULT_BORDER;
  return setBorder(document, archetypeId, elementId, { ...current, ...patch });
}

/** One radius for all four, or four separate ones — the DSL stores four. */
export function setCorners(
  document: JslaydDocument, archetypeId: string, elementId: string, corners: Corners | null,
): JslaydDocument {
  return withElement(document, archetypeId, elementId, (element) => (
    takesCorners(element) ? { ...element, corners } : element));
}

export const evenCorners = (radius: number): Corners =>
  ({ topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius });

/** True when all four corners agree, which is what the single-field UI shows. */
export const cornersAreEven = (corners: Corners | null): boolean =>
  !corners || (corners.topLeft === corners.topRight
    && corners.topRight === corners.bottomRight
    && corners.bottomRight === corners.bottomLeft);

/* ----------------------------------------------------------------- shadows */

/**
 * A shadow with no blur and no offset is invisible, and the design still has to
 * carry it. So the default is one that can be seen — an author who wants it
 * subtler can say so, and an author who wants none removes it.
 */
export const DEFAULT_SHADOW: Shadow = {
  offsetX: 0, offsetY: 12, blur: 32, spread: 0, opacity: 0.18, color: { hex: "#000000" },
};

export function setShadows(
  document: JslaydDocument, archetypeId: string, elementId: string, shadows: readonly Shadow[],
): JslaydDocument {
  return withElement(document, archetypeId, elementId, (element) => (
    takesShadow(element) ? { ...element, shadows } : element));
}

export function patchShadow(
  document: JslaydDocument, archetypeId: string, elementId: string, at: number, patch: Partial<Shadow>,
): JslaydDocument {
  const element = elementOf(archetypeOf(document, archetypeId), elementId);
  const shadows = (element as { shadows?: readonly Shadow[] } | null)?.shadows ?? [];
  if (!shadows[at]) return document;
  return setShadows(document, archetypeId, elementId,
    shadows.map((shadow, index) => (index === at ? { ...shadow, ...patch } : shadow)));
}

/**
 * Three, and no more.
 *
 * Every shadow is another blur the renderer, the PDF exporter and the PowerPoint
 * writer each pay for, and past three nobody can see the difference on a slide
 * viewed across a room. The cap is here rather than in the panel because the
 * panel is not the only thing that will ever add one.
 */
export const MAX_SHADOWS = 3;

export function addShadow(document: JslaydDocument, archetypeId: string, elementId: string): JslaydDocument {
  const element = elementOf(archetypeOf(document, archetypeId), elementId);
  if (!takesShadow(element)) return document;
  const shadows = (element as { shadows?: readonly Shadow[] } | null)?.shadows ?? [];
  if (shadows.length >= MAX_SHADOWS) return document;
  return setShadows(document, archetypeId, elementId, [...shadows, DEFAULT_SHADOW]);
}

export function removeShadow(
  document: JslaydDocument, archetypeId: string, elementId: string, at: number,
): JslaydDocument {
  const element = elementOf(archetypeOf(document, archetypeId), elementId);
  const shadows = (element as { shadows?: readonly Shadow[] } | null)?.shadows ?? [];
  if (!shadows[at]) return document;
  return setShadows(document, archetypeId, elementId, shadows.filter((_, index) => index !== at));
}

/* ------------------------------------------------------------------- image */

/** The picture rules an image slot carries, none of which are a picture. */
export type ImageRules = {
  slot: string;
  fit: "cover" | "contain" | "fill";
  focus: { x: number; y: number };
  orientation: "landscape" | "portrait" | "square" | "any";
  required: boolean;
  queryFrom: readonly string[];
  stylePreference: string | null;
  overlayOpacity: number;
};

/**
 * The tint over a picture, written whole.
 *
 * An opacity on its own does nothing and does not survive being saved: the
 * language writes the opacity only beside an overlay, because an opacity with
 * no colour is not a fainter tint, it is a number the renderer has nothing to
 * apply. So the colour and its strength are one operation, and clearing the
 * colour clears both.
 */
export function setOverlay(
  document: JslaydDocument, archetypeId: string, elementId: string,
  overlay: ColorValue | Gradient | null, opacity?: number,
): JslaydDocument {
  return withElement(document, archetypeId, elementId, (element) => {
    if (element.type !== "image" && element.type !== "frame") return element;
    return {
      ...element,
      overlay,
      overlayOpacity: overlay
        ? Math.min(1, Math.max(0, opacity ?? element.overlayOpacity ?? 0.35))
        : 0,
    };
  });
}

export function setImageRules(
  document: JslaydDocument, archetypeId: string, elementId: string, patch: Partial<ImageRules>,
): JslaydDocument {
  return withElement(document, archetypeId, elementId, (element) => {
    if (element.type !== "image" && element.type !== "frame") return element;
    const next = { ...element, ...patch };
    // The focal point is a fraction of the box, so a value outside 0–1 is not a
    // crop somebody chose — it is a number that will place the crop off the
    // picture entirely.
    if (patch.focus) {
      next.focus = {
        x: Math.min(1, Math.max(0, patch.focus.x)),
        y: Math.min(1, Math.max(0, patch.focus.y)),
      };
    }
    if (patch.overlayOpacity !== undefined) {
      next.overlayOpacity = Math.min(1, Math.max(0, patch.overlayOpacity));
    }
    return next;
  });
}
