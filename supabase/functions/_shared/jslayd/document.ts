// GENERATED FILE — do not edit by hand.
// Source: packages/jslayd/src/document.ts
// Regenerate with: node supabase/scripts/build-jslayd-runtime.mjs
//
// The JSLAYD runtime, projected into the Edge tree. Edit the package, not this.

import type {
  Anchor,
  ArchetypePurpose,
  Binding,
  ChartKind,
  ColorRole,
  Condition,
  ElementType,
  FontFormat,
  FontRole,
  ImageSourceStrategy,
  ShapeKind,
  TextEffect,
  Tier,
} from "./spec.ts";

/**
 * The compiled `.jslayd` document — JSLAYD's single source of truth (§103).
 *
 * It is **data**. Nothing in here is ever evaluated, interpolated as code or
 * fetched: colours are literals or role names, bindings are a closed enum, and
 * image sources name a *strategy* rather than a URL (§25, §39, §82).
 *
 * V1 serialises as versioned JSON (§52). The extension stays `.jslayd` and the
 * MIME type is declared in spec.ts, so moving to a zip container later is a
 * container change the readers can sniff, not a format break.
 */
export type JslaydDocument = {
  format: "JSLAYD";
  version: string;
  kind: "design";
  design: DesignMeta;
  /**
   * The design's default colours — the first family, flattened.
   *
   * Every reader can use this and ignore `colorFamilies` entirely, which is
   * what keeps a document written before families existed readable, and what
   * lets a renderer that never offers a choice stay a two-line function.
   */
  colors: ColorFamily;
  /**
   * The families a user may choose between (§29).
   *
   * A built-in blueprint was palette-independent: one design, eight families.
   * A JSLAYD design says the same thing by carrying them, so migrating one does
   * not cost it seven-eighths of its range. The first entry is always the one
   * `colors` mirrors.
   */
  colorFamilies: readonly NamedColorFamily[];
  chartPalette: readonly string[];
  fonts: readonly FontDeclaration[];
  visualDNA: VisualDNA;
  archetypes: readonly Archetype[];
};

export type DesignMeta = {
  name: string;
  slug: string;
  tier: Tier;
  description: string;
  premium: boolean;
  /** Always the canonical canvas; carried so a future 4:3 variant is detectable. */
  canvas: { width: number; height: number };
};

/**
 * Every role resolved to a concrete value. The compiler fills the roles the
 * author omitted (§16) so a renderer never has to decide what `border` means.
 */
export type ColorFamily = Record<ColorRole, string>;

export type NamedColorFamily = {
  /** Stable identifier, matched against `presentations.palette_code`. */
  code: string;
  name: string;
  colors: ColorFamily;
  /** Chart series for this family; falls back to the document palette. */
  chartPalette: readonly string[];
};

/**
 * One file of a typeface.
 *
 * Regular, Medium, SemiBold, Bold and their italics are separate files of the
 * same family. A design that sets 700 somewhere and ships only the 400 file
 * does not get bold — it gets the 400 smeared sideways by the renderer, which
 * is what faux bold is and what it looks like.
 */
export type FontFace = {
  /** File name inside the design's font bucket. Never a path. */
  asset: string;
  format: FontFormat;
  weight: number;
  italic: boolean;
};

export type FontDeclaration = {
  /** `font_1` … `font_4`. Elements reference a font by this id. */
  id: string;
  /** Display name, used in the admin UI and as the PPTX face name. */
  name: string;
  roles: readonly FontRole[];
  /**
   * The family name the renderers register every face under. Derived from the
   * design slug and the font id so two designs can ship different files under
   * the same human name without colliding at runtime.
   */
  family: string;
  /** A bundled face to draw with until the files resolve, and in PPTX (§78). */
  fallback: string;
  /**
   * The files this font ships, up to ten. Empty while a design is still being
   * drafted, in which case the fallback carries the whole design.
   */
  faces: readonly FontFace[];
};

/**
 * The face to draw a given weight and slope with.
 *
 * Nearest weight wins, and a slope that was asked for beats one that was not —
 * so a deck asking for bold italic with only an upright bold present gets the
 * bold, not the regular italic. Returns nothing when the font ships no files,
 * which is the signal to fall back to a bundled face.
 */
export function faceFor(
  font: FontDeclaration | undefined,
  weight: number,
  italic: boolean,
): FontFace | undefined {
  if (!font || font.faces.length === 0) return undefined;
  let best: FontFace | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const face of font.faces) {
    // A wrong slope costs more than any weight difference can, so the two never
    // trade off against each other.
    const score = Math.abs(face.weight - weight) + (face.italic === italic ? 0 : 10000);
    if (score < bestScore) { best = face; bestScore = score; }
  }
  return best;
}

/**
 * The bounds a generator's safe adjustments may not leave (§44, §46). They are
 * the design's identity expressed as numbers: shrink the type, crop the image,
 * thin the labels — but stay inside these, or the design stops being itself.
 */
export type VisualDNA = {
  rotationRange: { min: number; max: number };
  cornerRadiusFamily: readonly number[];
  shadowFamily: readonly Shadow[];
  spacingScale: readonly number[];
  titleScale: { min: number; max: number };
  bodyScale: { min: number; max: number };
  imageTreatment: "photo" | "illustration" | "render3d" | "abstract" | "mixed";
  decorationDensity: "none" | "low" | "medium" | "high";
};

export type Archetype = {
  id: string;
  purpose: ArchetypePurpose;
  /** Slide background; a role name or a gradient. */
  background: ColorValue | Gradient;
  selection: SelectionRules;
  elements: readonly JslaydElement[];
};

/** What the generator consults when choosing a slide for a piece of content (§42). */
export type SelectionRules = {
  minText: number;
  maxText: number;
  supportsImage: boolean;
  supportsChart: boolean;
  supportsTable: boolean;
  supportsStats: boolean;
  supportsQuote: boolean;
  /** Higher wins when several archetypes fit. */
  priority: number;
};

/* ------------------------------------------------------------------ values */

/** A colour is a role name (preferred) or a literal `#RRGGBB[AA]`. */
export type ColorValue = { role: ColorRole } | { hex: string };

export type GradientStop = { offset: number; color: ColorValue };

export type Gradient = {
  type: "linear" | "radial";
  /** Degrees, clockwise from twelve o'clock. Ignored by radial. */
  angle: number;
  /** Two or more stops, sorted by offset, offsets in 0–100 (§17). */
  stops: readonly GradientStop[];
};

export type Shadow = {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  opacity: number;
  color: ColorValue;
};

export type Border = {
  width: number;
  color: ColorValue;
  style: "solid" | "dashed" | "dotted";
  opacity: number;
};

export type Corners = {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
};

/**
 * Canonical geometry: absolute, top-left origin, canvas units. `anchor` is an
 * authoring convenience the compiler has already resolved away (§20) — it
 * survives only so the admin editor can show what the author wrote.
 */
export type Geometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  anchor: Anchor;
};

/** Literal text, or a binding the generator fills at render time. */
export type TextSource = { literal: string } | { bind: Binding };

/* ---------------------------------------------------------------- elements */

type ElementBase = {
  id: string;
  geometry: Geometry;
  when: Condition;
  opacity: number;
  /**
   * Absorbs the vertical space of any sibling whose condition failed.
   *
   * A slide without an image or a chart leaves a hole where that element was
   * drawn. An element that grows stretches down into it, so the composition
   * still reads as deliberate instead of as a layout missing a quarter of
   * itself — which is what the built-in designs have always done.
   */
  grow: boolean;
};

export type TextStyle = {
  font: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  letterSpacing: number;
  lineHeight: number;
  align: "left" | "center" | "right" | "justify";
  verticalAlign: "top" | "middle" | "bottom";
  transform: "none" | "uppercase" | "lowercase" | "capitalize";
  color: ColorValue;
  maxLines: number | null;
  overflow: "shrink" | "clip" | "wrap";
  /** Floor for `overflow: shrink`; never below MIN_FONT_SIZE. */
  minFontSize: number;
  effect: TextEffect;
  shadows: readonly Shadow[];
  strokeWidth: number;
  strokeColor: ColorValue | null;
  highlight: ColorValue | null;
  gradient: Gradient | null;
  blur: number;
};

/** `text`, `quote`, `number`, `stat` label/value and `badge` copy all use this. */
export type TextElement = ElementBase & {
  type: "text" | "quote" | "number" | "badge";
  source: TextSource;
  text: TextStyle;
  /** Plate drawn behind the copy — how a badge gets its pill. */
  background: ColorValue | Gradient | null;
  corners: Corners | null;
  border: Border | null;
  padding: number;
};

/**
 * Where a picture comes from.
 *
 * `bind` is a hole the deck fills — a slot the generator resolves a photograph
 * into. `asset` is the design's own artwork: a logo, a texture, a cover
 * photograph that came with the template and is part of the composition rather
 * than a place to put something.
 *
 * The two are genuinely different things and were not distinguishable before
 * this existed, so an imported template's own pictures had nowhere to live and
 * were dropped. A design that loses its logo is not that design.
 */
export type ImageSource = { bind: Binding } | { asset: string };

export type ImageElement = ElementBase & {
  type: "image" | "frame";
  /** Semantic slot id the generator fills, e.g. `hero_image` (§27). */
  slot: string;
  source: ImageSource | null;
  strategy: ImageSourceStrategy;
  required: boolean;
  queryFrom: readonly string[];
  orientation: "landscape" | "portrait" | "square" | "any";
  stylePreference: string | null;
  fit: "cover" | "contain" | "fill";
  /** Focal point for the crop, 0–1 in each axis. */
  focus: { x: number; y: number };
  corners: Corners | null;
  border: Border | null;
  shadows: readonly Shadow[];
  /** Tint laid over the picture, for designs that unify photography. */
  overlay: ColorValue | Gradient | null;
  overlayOpacity: number;
};

export type ShapeElement = ElementBase & {
  type: "shape" | "divider" | "decorative" | "line";
  shape: ShapeKind;
  fill: ColorValue | Gradient | null;
  corners: Corners | null;
  border: Border | null;
  shadows: readonly Shadow[];
  /** `polygon` only; 3–24 vertices. */
  sides: number | null;
  /** `line` and `divider`; the drawn thickness. */
  thickness: number;
};

export type IconElement = ElementBase & {
  type: "icon";
  icon: string;
  color: ColorValue;
  strokeWidth: number;
};

export type ChartStyle = {
  showLegend: boolean;
  showLabels: boolean;
  showValues: boolean;
  showGrid: boolean;
  showAxis: boolean;
  cornerRadius: number;
  gap: number;
  strokeWidth: number;
};

export type ChartElement = ElementBase & {
  type: "chart";
  chart: ChartKind;
  source: { bind: Binding };
  /** Overrides the document palette for this one chart. */
  palette: readonly ColorValue[] | null;
  /** The single-series colour, and what a renderer falls back to per slice. */
  color: ColorValue;
  /** The unfilled remainder of a doughnut, and the plot ground of a bar chart. */
  trackColor: ColorValue;
  labelColor: ColorValue;
  axisColor: ColorValue;
  style: ChartStyle;
  font: string;
  labelSize: number;
};

export type TableStyle = {
  headerBackground: ColorValue | null;
  headerColor: ColorValue;
  headerFont: string;
  headerSize: number;
  cellBackground: ColorValue | null;
  cellAltBackground: ColorValue | null;
  cellColor: ColorValue;
  cellFont: string;
  cellSize: number;
  border: Border | null;
  padding: number;
  align: "left" | "center" | "right";
  /** Fractions summing to 1, or empty for equal columns. */
  columnWidths: readonly number[];
};

export type TableElement = ElementBase & {
  type: "table";
  source: { bind: Binding };
  columns: number;
  rows: number;
  header: boolean;
  table: TableStyle;
  corners: Corners | null;
};

/** A stat card: a value, an optional affix pair and a label, laid out as one. */
export type StatElement = ElementBase & {
  type: "stat";
  value: TextSource;
  label: TextSource | null;
  prefix: string;
  suffix: string;
  valueStyle: TextStyle;
  labelStyle: TextStyle;
  /** Gap between value and label, in canvas units. */
  spacing: number;
  background: ColorValue | Gradient | null;
  corners: Corners | null;
  border: Border | null;
  shadows: readonly Shadow[];
  padding: number;
};

/** A bulleted or numbered run, drawn from the slide's bullet array. */
export type ListElement = ElementBase & {
  type: "list";
  source: { bind: Binding };
  marker: "bullet" | "number" | "dash" | "none";
  markerColor: ColorValue;
  maxItems: number;
  itemSpacing: number;
  text: TextStyle;
};

/** Children carry geometry relative to the group's box (§20). */
export type GroupElement = ElementBase & {
  type: "group";
  children: readonly JslaydElement[];
};

export type JslaydElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | IconElement
  | ChartElement
  | TableElement
  | StatElement
  | ListElement
  | GroupElement;

/** Narrowing helper used by the renderers and the analyzer. */
export function elementsOfType<T extends ElementType>(
  elements: readonly JslaydElement[],
  type: T,
): Extract<JslaydElement, { type: T }>[] {
  return elements.filter((element): element is Extract<JslaydElement, { type: T }> => element.type === type);
}

/** Depth-first walk including group children, in declaration order. */
export function walkElements(elements: readonly JslaydElement[]): JslaydElement[] {
  const flat: JslaydElement[] = [];
  for (const element of elements) {
    flat.push(element);
    if (element.type === "group") flat.push(...walkElements(element.children));
  }
  return flat;
}
