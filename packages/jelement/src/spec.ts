/**
 * JElement 1.0 — the vocabulary.
 *
 * A JElement is a reusable visual object: an excavator, a survey instrument, a
 * neural-network glyph. JSLAYD says where a picture goes on a slide; JElement
 * says what the picture is. They are deliberately separate systems — a design
 * is a composition and an element is a thing — and they meet at one seam, a
 * visual slot a design declares and an element fills.
 *
 * The two rules that shape everything here:
 *
 * WHAT IT IS is stored apart from HOW IT LOOKS. An element is a "hydraulic
 * mining excavator"; that it is graphite with lime accents belongs to its
 * family. Otherwise searching for "excavator" starts depending on the words
 * "green" and "3D", and the library stops being searchable the moment a second
 * visual style exists.
 *
 * COLOURS ARE TOKENS, never literals on a shape. Changing a family's accent has
 * to recolour every element that used it, which is only possible if no element
 * ever wrote the hex down.
 */

export const JELEMENT_HEADER = "JELEMENT-FAMILY 1.0";
export const JELEMENT_KEYWORD = "JELEMENT-FAMILY";
export const SUPPORTED_VERSIONS = ["1.0"] as const;

/** The batch an analyzer is asked for. Not a database constraint — see LIMITS. */
export const DEFAULT_BATCH = 12;

export const LIMITS = {
  sourceBytes: 512 * 1024,
  /**
   * A family may hold more than one batch: expansion adds siblings to an
   * existing family rather than making a second one, so the ceiling is about
   * what a page can draw and what a search can rank, not about the batch size.
   */
  elementsPerFamily: 96,
  componentsPerElement: 64,
  aliasesPerElement: 40,
  aliasLength: 80,
  nameLength: 120,
} as const;

/**
 * The colour roles an element may bind to.
 *
 * A closed set, for the same reason JSLAYD's is: an element that binds to
 * `{{lime}}` is an element that cannot be recoloured, because the next family
 * has no lime. These are roles, and a family fills them.
 */
export const COLOR_TOKENS = [
  "primary", "secondary", "accent", "accentGlow",
  "darkSurface", "lightSurface",
  "metal", "metalDark", "glass", "rubber", "screen", "emissive",
  "shadow", "outline",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

/** Shapes a deterministic renderer can draw without an image. */
export const SHAPE_PRIMITIVES = [
  "rect", "roundedRect", "circle", "ellipse", "polygon", "path",
  "line", "arc", "triangle", "group",
] as const;
export type ShapePrimitive = (typeof SHAPE_PRIMITIVES)[number];

export const OBJECT_CLASSES = [
  "vehicle", "machine", "tool", "device", "structure", "material",
  "person", "symbol", "diagram", "nature", "container", "other",
] as const;
export type ObjectClass = (typeof OBJECT_CLASSES)[number];

/** Where on a slide an element earns its place. Mirrors JSLAYD's purposes. */
export const SLIDE_ROLES = [
  "cover", "hero", "section", "comparison", "process", "statistic",
  "timeline", "explanation", "backgroundDecoration", "diagram", "closing",
] as const;
export type SlideRole = (typeof SLIDE_ROLES)[number];

export const FACINGS = ["left", "right", "front", "neutral"] as const;
export type Facing = (typeof FACINGS)[number];

/**
 * Anchors an element exposes for composition.
 *
 * `visualCenter` is the one that matters and the one a bounding box gets wrong:
 * a pickaxe on a diagonal has a large rectangle and a small perceived mass, and
 * centring the rectangle puts the pick visibly off-centre.
 */
export const ANCHORS = [
  "center", "visualCenter", "top", "bottom", "left", "right",
  "ground", "focusPoint",
] as const;
export type Anchor = (typeof ANCHORS)[number];

/**
 * The sizes and angles every element is previewed at.
 *
 * Small first, because that is where detail disappears: a hairline that reads
 * at 320px is gone at 64, and nobody notices looking at one large preview.
 * The angles include a right angle because an element rotated 90° is where a
 * wrong aspect ratio finally shows.
 */
export const MIN_PREVIEW_SIZES = [64, 160, 320] as const;
export const PREVIEW_ROTATIONS = [0, 15, -15, 45] as const;

export const LANGUAGES = ["uz", "en", "ru"] as const;
export type Language = (typeof LANGUAGES)[number];

export const STATUSES = ["draft", "published", "archived"] as const;
export type Status = (typeof STATUSES)[number];

/**
 * Normalises a term for search.
 *
 * Uzbek is written with two different apostrophes depending on the keyboard —
 * `o'` and `oʻ` are the same letter and a person searching for one must find
 * the other. Case, punctuation and repeated spaces go the same way.
 *
 * Deliberately conservative: no stemming, no fuzzy distance. "kon" must not
 * match "konus" because they share three letters — a search that returns a cone
 * for a mine is worse than one that returns nothing.
 */
export function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[‘’ʻʼ`´]/g, "'")
    .replace(/[‐-‒–—―]/g, "-")
    .replace(/[^\p{L}\p{N}'\- ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** `Mining Neon Industrial` → `mining-neon-industrial`. */
export function toSlug(value: string): string {
  const base = normalizeTerm(value)
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[0-9]+/, "")
    .replace(/^-+/, "");
  return base.slice(0, 64) || "element";
}
