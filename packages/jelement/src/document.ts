import type {
  Anchor, ColorToken, Facing, ObjectClass, ShapePrimitive, SlideRole,
  RenderingMode,
} from "./spec.ts";

/**
 * A compiled JElement family — the only shape anything downstream reads.
 *
 * Split three ways on purpose, because the brief's §38 is right about what a
 * text specification can and cannot promise:
 *
 *   `semantic`  — what the object is. Searchable, translatable, stable.
 *   `render`    — how to draw it. Geometry, or a reference to an asset.
 *   `source`    — where it came from. The reference sheet, for review.
 *
 * Prose cannot reproduce a complex object pixel for pixel, and pretending
 * otherwise is how a library ends up full of descriptions nobody can render.
 * So the spec carries structure, an admin reviews it, and what ships is either
 * deterministic geometry or a real asset — never a hope that a second model
 * redraws the same thing.
 */

export type JElementFamily = {
  format: "JELEMENT";
  version: string;
  family: FamilyMeta;
  visualDNA: VisualDNA;
  /** Every token the elements bind to, resolved to a concrete colour. */
  colorTokens: Partial<Record<ColorToken, string>>;
  search: FamilySearch;
  elements: readonly JElement[];
};

export type FamilyMeta = {
  name: string;
  slug: string;
  category: string;
  subcategory: string;
  style: string;
  description: string;
};

/**
 * The shared visual language. Every sibling obeys it; none of it is searchable.
 *
 * This is the "how it looks" half, kept away from the elements so that adding a
 * second family in a different style does not change what any element *is*.
 */
export type VisualDNA = {
  material: string;
  lighting: string;
  edgeStyle: string;
  depthStyle: string;
  perspective: string;
  camera: string;
  shadowStyle: string;
  highlightStyle: string;
  /** 1–10. How much fine detail the family carries. */
  detailDensity: number;
  realism: string;
  geometryLanguage: string;
};

export type FamilySearch = {
  keywords: readonly string[];
  industries: readonly string[];
  concepts: readonly string[];
};

/* --------------------------------------------------------------- element */

export type JElement = {
  index: number;
  canonicalName: string;
  /** Whether this element is drawn from components or from a picture. */
  rendering: RenderingMode;
  /**
   * The rendered picture, when this element is one.
   *
   * Geometry is right for a chart and wrong for a studio render of a bust: a
   * lit, shadowed, physically-plausible object described as boxes and paths
   * comes out unrecognisable, and that is a limit of the format rather than of
   * the analyzer. An element with an asset draws the asset; its components, if
   * any, are then a placement aid rather than the drawing.
   */
  assetPath?: string | null;
  /** The accent hue measured in that file, 0-360. What a recolour moves away from. */
  assetAccentHue?: number | null;
  /** Pre-rendered recolours by target hue, because a phone cannot process a PNG. */
  assetVariants?: Record<string, string>;
  displayName: string;
  objectClass: ObjectClass;
  category: string;
  subcategory: string;
  semantic: ElementSemantics;
  geometry: ElementGeometry;
  appearance: ElementAppearance;
  usage: ElementUsage;
  transform: TransformRules;
};

/**
 * Everything a search reads. No colours, no style words.
 *
 * Terms are stored per language rather than in one bag: a Russian query should
 * be able to prefer Russian terms, and a mixed bag makes that impossible to
 * rank. `concepts` and `contexts` are what let "mining automation" find an
 * inspection drone that nobody ever called an automation device.
 */
export type ElementSemantics = {
  aliases: readonly string[];
  uzbekTerms: readonly string[];
  englishTerms: readonly string[];
  russianTerms: readonly string[];
  industries: readonly string[];
  concepts: readonly string[];
  actions: readonly string[];
  contexts: readonly string[];
};

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Geometry in normalised space, 0–1 within the element's own bounds.
 *
 * Three different bounds, because they answer three different questions and
 * conflating them is what puts a rotated pickaxe visibly off-centre:
 *
 *   `bounds`       what the maths says
 *   `visualBounds` where the mass actually reads
 *   `safeBounds`   what must not be cropped
 */
export type ElementGeometry = {
  aspectRatio: number;
  bounds: Box;
  visualBounds: Box;
  safeBounds: Box;
  visualCenter: { x: number; y: number };
  dominantAxis: "horizontal" | "vertical" | "balanced";
  originalRotation: number;
  naturalFacing: Facing;
  anchors: Partial<Record<Anchor, { x: number; y: number }>>;
  components: readonly Component[];
};

export type Component = {
  id: string;
  label: string;
  parent: string | null;
  shape: ShapePrimitive;
  box: Box;
  rotation: number;
  zIndex: number;
  /** Which family colour fills it. Never a hex — that is the whole point. */
  fill: ColorToken | null;
  stroke: ColorToken | null;
  strokeWidth: number;
  opacity: number;
  /** False for a screen with content, or a safety colour that must not move. */
  recolorable: boolean;
  /** Present only for `shape: "path"`. */
  path: string | null;
};

export type ElementAppearance = {
  materials: readonly string[];
  roughness: number;
  metalness: number;
  edgeSoftness: number;
  shadowDirection: string;
  shadowSoftness: number;
  highlightDirection: string;
  emissiveAreas: readonly string[];
};

export type ElementUsage = {
  slideRoles: readonly SlideRole[];
  bestFor: readonly string[];
  avoidFor: readonly string[];
  /** 1–10. How loudly the element competes with the copy beside it. */
  visualWeight: number;
  detailDensity: number;
  /** 0–1. Beyond this the element stops being an illustration. */
  recommendedMaxSlideCoverage: number;
};

export type TransformRules = {
  scalable: boolean;
  rotatable: boolean;
  recolorable: boolean;
  opacityEditable: boolean;
  flipHorizontal: boolean;
  flipVertical: boolean;
  /** False keeps the aspect ratio locked; the default, and usually right. */
  freeTransform: boolean;
};

/* ------------------------------------------------------------- placement */

/**
 * An element placed on a slide.
 *
 * What a deck stores. The version is pinned for the same reason a JSLAYD design
 * is: republishing an element must not silently redraw a presentation somebody
 * already exported.
 */
export type ElementPlacement = {
  elementId: string;
  elementVersion: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  /** Per-placement overrides. Absent keys inherit the family's colour. */
  colorOverrides: Partial<Record<ColorToken, string>>;
};
