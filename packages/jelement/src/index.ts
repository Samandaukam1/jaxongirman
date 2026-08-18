/**
 * JElement 1.0 — reusable visual objects.
 *
 * JSLAYD decides where a picture goes on a slide; JElement decides what the
 * picture is. Two systems, one seam: a design declares a visual slot, an
 * element fills it.
 */
export * from "./spec.ts";
export * from "./document.ts";
export { compile, type CompileResult } from "./compile.ts";
export { ANALYZER_PROMPT, expansionPrompt } from "./standard.ts";
export {
  crop, dominantHue, gridCells, hexToHsl, hslToRgb, recolour, rgbToHsl, sliceSheet, trim,
  type Pixels, type Rect, type RecolourOptions,
} from "./raster.ts";
export {
  fitToBox, placementFor, renderElement, shouldFlip,
  type RenderedShape, type RenderTarget,
} from "./render.ts";
export {
  elementHealth, familyHealth, previewMatrix,
  type HealthDeduction, type HealthReport,
} from "./health.ts";
export {
  findDuplicates, findInternalDuplicates, type DuplicateMatch,
} from "./duplicates.ts";
