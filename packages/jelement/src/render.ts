import type { Component, ElementPlacement, JElement, JElementFamily } from "./document.ts";
import type { ColorToken } from "./spec.ts";

/**
 * An element, drawn.
 *
 * Deliberately emits the same rows the slide renderers already read — a
 * rectangle with a corner radius, a colour and a rotation. No new element type,
 * no new primitive, nothing for the web view, the phone or the PPTX exporter to
 * learn. A circle is a rectangle whose radius is half its side, which is
 * already how the JSLAYD renderer draws one.
 *
 * That decision is the whole reason JElement can ship without touching three
 * renderers, and it is also the constraint: an element is built from filled,
 * rounded, rotatable boxes. Anything needing a true path ships as an asset
 * instead, which is what `asset_path` is for.
 */

/** The shape a slide renderer consumes. Ids and slide keys are the caller's. */
export type RenderedShape = {
  type: "shape" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  opacity: number;
  style: Record<string, unknown>;
  content: Record<string, unknown>;
};

export type RenderTarget = {
  /** Where the element sits on the slide, in the renderer's own units. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
};

/**
 * Resolves a component's colour.
 *
 * Three sources, in order: what this placement overrode, what the family says,
 * and — for a layer marked not recolourable — the family value regardless of
 * any override. Glass is glass; an accent change must not turn a cabin window
 * into a lime panel.
 */
function colorFor(
  token: ColorToken | null,
  family: JElementFamily,
  overrides: Partial<Record<ColorToken, string>>,
  recolorable: boolean,
): string | undefined {
  if (!token) return undefined;
  if (!recolorable) return family.colorTokens[token];
  return overrides[token] ?? family.colorTokens[token];
}

/**
 * Where a component lands, given where the element is.
 *
 * Component boxes are 0–1 inside the element's own bounds, so this is a
 * straight projection — and because it is, an element scales without any part
 * of it being recomputed by hand.
 */
function project(component: Component, target: RenderTarget): { x: number; y: number; width: number; height: number } {
  const box = component.box;

  // Flipping mirrors the component inside the element rather than negating the
  // whole thing, so a truck facing right becomes one facing left and does not
  // end up drawn off the far edge.
  const x = target.flipHorizontal ? 1 - box.x - box.width : box.x;
  const y = target.flipVertical ? 1 - box.y - box.height : box.y;

  return {
    x: target.x + x * target.width,
    y: target.y + y * target.height,
    width: box.width * target.width,
    height: box.height * target.height,
  };
}

/** `circle` and `ellipse` are rectangles the renderers already round. */
function radiusFor(component: Component, width: number, height: number): Record<string, unknown> {
  if (component.shape === "circle" || component.shape === "ellipse") {
    return { borderRadius: Math.min(width, height) / 2 };
  }
  if (component.shape === "roundedRect") {
    return { borderRadius: Math.min(width, height) * 0.14 };
  }
  return {};
}

export function renderElement(
  element: JElement,
  family: JElementFamily,
  target: RenderTarget,
  overrides: Partial<Record<ColorToken, string>> = {},
): RenderedShape[] {
  const rotation = target.rotation ?? 0;
  const opacity = target.opacity ?? 1;

  return [...element.geometry.components]
    .sort((first, second) => first.zIndex - second.zIndex)
    .map((component): RenderedShape => {
      const box = project(component, target);
      const fill = colorFor(component.fill, family, overrides, component.recolorable);
      const stroke = colorFor(component.stroke, family, overrides, component.recolorable);

      return {
        type: "shape",
        ...box,
        // A component's own angle and the placement's are added: a tilted
        // pickaxe placed at -12° is tilted by both, which is what somebody
        // rotating it on a slide expects to happen.
        rotation: rotation + component.rotation,
        zIndex: component.zIndex,
        opacity: opacity * component.opacity,
        style: {
          ...(fill ? { backgroundColor: fill } : {}),
          ...(stroke && component.strokeWidth > 0
            ? { borderColor: stroke, borderWidth: component.strokeWidth }
            : {}),
          ...radiusFor(component, box.width, box.height),
          shape: component.shape === "roundedRect" ? "rect" : component.shape,
          ...(component.shape === "polygon" || component.shape === "triangle"
            ? { sides: component.shape === "triangle" ? 3 : 6 }
            : {}),
        },
        content: {},
      };
    });
}

/**
 * The box an element should occupy to appear a given size.
 *
 * A caller asking for "a quarter of the slide" means a quarter of what the eye
 * sees, and `visualBounds` is where the mass reads — the rectangle can be much
 * larger. Placing by the rectangle is what makes a diagonal object look
 * off-centre and undersized on every slide it appears on.
 */
export function fitToBox(
  element: JElement,
  box: { x: number; y: number; width: number; height: number },
): RenderTarget {
  const visual = element.geometry.visualBounds;
  const safeWidth = visual.width > 0 ? visual.width : 1;
  const safeHeight = visual.height > 0 ? visual.height : 1;

  // How big the whole element has to be for its visible part to fill the box,
  // keeping the aspect ratio the object is recognisable at.
  const scale = Math.min(box.width / safeWidth, box.height / safeHeight);
  const width = scale;
  const height = scale;

  const visualLeft = box.x + (box.width - safeWidth * scale) / 2;
  const visualTop = box.y + (box.height - safeHeight * scale) / 2;

  return {
    x: visualLeft - visual.x * width,
    y: visualTop - visual.y * height,
    width,
    height,
  };
}

/**
 * Should this element be mirrored to face the slide's copy?
 *
 * A truck facing right, placed to the right of a paragraph, faces away from it
 * — the composition reads as the object leaving. Flipping is allowed only when
 * the element says it survives being flipped: text on a machine, a steering
 * wheel, a right-handed tool do not.
 */
export function shouldFlip(element: JElement, contentSide: "left" | "right"): boolean {
  if (!element.transform.flipHorizontal) return false;
  const facing = element.geometry.naturalFacing;
  if (facing === "front" || facing === "neutral") return false;
  // Content on the left wants the object facing left, and vice versa.
  return facing !== contentSide;
}

/** What the placement stores, so a deck can be redrawn exactly. */
export function placementFor(
  elementId: string,
  version: number,
  target: RenderTarget,
  overrides: Partial<Record<ColorToken, string>> = {},
): ElementPlacement {
  return {
    elementId,
    elementVersion: version,
    x: target.x,
    y: target.y,
    width: target.width,
    height: target.height,
    rotation: target.rotation ?? 0,
    opacity: target.opacity ?? 1,
    flipHorizontal: target.flipHorizontal ?? false,
    flipVertical: target.flipVertical ?? false,
    colorOverrides: overrides,
  };
}
