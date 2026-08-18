/**
 * Turning a library element into slide rows.
 *
 * An element is several shapes that have to behave as one thing: dragging a
 * truck must not leave a wheel behind. The editor works one row at a time, so
 * the *placement* is the truth and the rows are derived from it — every member
 * carries the same placement, and any transform redraws all of them.
 *
 * That avoids delta arithmetic entirely. Moving, scaling and rotating are all
 * "change the placement, redraw", so the shapes cannot drift apart over a long
 * editing session the way accumulated offsets would.
 *
 * Kept apart from `jelement.ts` because that file reaches for the Supabase
 * client and this half is the half worth testing on its own.
 */

/** One shape of an element, as the drawing code reads it. */
export type Row = {
  slide_id: string;
  presentation_id: string;
  owner_id: string;
  type: "shape";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  opacity: number;
  locked: boolean;
  style: Record<string, unknown>;
  content: Record<string, unknown>;
};

/** The placement every member row carries, so any of them can rebuild the set. */
export type Placement = {
  groupId: string;
  elementId: string;
  version: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipHorizontal: boolean;
};

export type Component = {
  id: string;
  shape: string;
  box: { x: number; y: number; width: number; height: number };
  rotation: number;
  zIndex: number;
  fill: string | null;
  opacity: number;
  recolorable: boolean;
  /** The outline, for `shape: "path"`. Authored in a 0-100 square of its box. */
  path?: string | null;
};

export type ResolvedElement = {
  elementId: string;
  version: number;
  name: string;
  components: Component[];
  colorTokens: Record<string, string>;
};

/* -------------------------------------------------------------- drawing */

/** Reads the placement off a row, if it is part of an element. */
export function placementOf(row: { content: unknown }): Placement | null {
  const content = (row.content ?? {}) as { jelement?: Placement };
  return content.jelement ?? null;
}

export function isElementRow(row: { content: unknown }): boolean {
  return placementOf(row) !== null;
}

/**
 * The rows for one placement.
 *
 * Regenerated wholesale on every change rather than patched, which is what
 * makes a long editing session safe: there is no accumulated offset to drift.
 */
export function rowsFor(
  element: ResolvedElement,
  placement: Placement,
  base: { slideId: string; presentationId: string; ownerId: string; zIndex: number },
  overrides: Record<string, string> = {},
): Row[] {
  const colours = { ...element.colorTokens, ...overrides };

  return [...element.components]
    .sort((first, second) => first.zIndex - second.zIndex)
    .map((component, order) => {
      // Flipping mirrors inside the placement rather than negating it, so the
      // object turns around instead of being drawn off the far edge.
      const localX = placement.flipHorizontal
        ? 1 - component.box.x - component.box.width
        : component.box.x;

      const fill = component.fill
        ? (component.recolorable ? colours[component.fill] : element.colorTokens[component.fill])
        : undefined;

      const width = component.box.width * placement.width;
      const height = component.box.height * placement.height;

      return {
        slide_id: base.slideId,
        presentation_id: base.presentationId,
        owner_id: base.ownerId,
        type: "shape" as const,
        x: placement.x + localX * placement.width,
        y: placement.y + component.box.y * placement.height,
        width,
        height,
        rotation: placement.rotation + component.rotation,
        z_index: base.zIndex + order,
        opacity: component.opacity,
        locked: false,
        style: {
          // `fill` is what the slide renderers read. This said
          // `backgroundColor` and so drew every placed element in the phone's
          // default grey.
          fill,
          shape: component.shape === "roundedRect" ? "rect" : component.shape,
          ...(component.shape === "circle" || component.shape === "ellipse"
            ? { borderRadius: Math.min(width, height) / 2 }
            : component.shape === "roundedRect"
              ? { borderRadius: Math.min(width, height) * 0.14 }
              : {}),
          // The silhouette, when the component has one. A renderer that does
          // not understand it still draws a correctly placed, correctly
          // coloured box.
          ...(component.shape === "path" && component.path
            ? { path: component.path, viewBox: "0 0 100 100" }
            : {}),
        },
        // Every member carries the placement, so any one of them can rebuild
        // the whole set — including after the app is closed and reopened.
        content: { jelement: placement, component: component.id },
      };
    });
}

/** The box a placement occupies, for a selection frame drawn around all of it. */
export function boundsOf(placement: Placement): { x: number; y: number; width: number; height: number } {
  return { x: placement.x, y: placement.y, width: placement.width, height: placement.height };
}

/**
 * A sensible first placement: centred, and sized to leave the slide breathing.
 *
 * Not the whole slide. An element inserted at full width is one the person has
 * to shrink before they can do anything else, and the first thing they see
 * should already look deliberate.
 */
export function initialPlacement(
  elementId: string,
  version: number,
  canvas: { width: number; height: number },
  groupId: string,
): Placement {
  const size = Math.min(canvas.width, canvas.height) * 0.42;
  return {
    groupId,
    elementId,
    version,
    x: (canvas.width - size) / 2,
    y: (canvas.height - size) / 2,
    width: size,
    height: size,
    rotation: 0,
    flipHorizontal: false,
  };
}
