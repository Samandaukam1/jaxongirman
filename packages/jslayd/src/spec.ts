/**
 * JSLAYD 1.0 — the closed vocabulary.
 *
 * Everything the language accepts is named here and nowhere else. A property the
 * parser meets that is not in one of these sets is an ERROR, never a silent
 * ignore: a design that renders differently from what its author wrote is worse
 * than a design that refuses to compile.
 *
 * Extending the language means adding to this file, then to the document model,
 * the compiler, the renderer and the exporters — in that order. Never a
 * one-off workaround in the parser.
 */

export const JSLAYD_FORMAT = "JSLAYD" as const;
export const JSLAYD_VERSION = "1.0" as const;
export const JSLAYD_KIND = "design" as const;
export const JSLAYD_HEADER = "JSLAYD-DESIGN 1.0" as const;
export const JSLAYD_EXTENSION = ".jslayd" as const;
export const JSLAYD_MIME = "application/vnd.jaxongirman.jslayd+json" as const;

/**
 * Versions this build can open. A document stamped with anything else is
 * refused by name rather than parsed hopefully — §54 requires old documents keep
 * opening, which means the list only ever grows.
 */
export const SUPPORTED_VERSIONS: readonly string[] = ["1.0"];

/**
 * The canonical authoring canvas: 1920 × 1080, origin at top-left.
 *
 * The apps' stored geometry is a 1000 × 562.5 model that predates JSLAYD and is
 * baked into every existing presentation, the DB geometry constraint and all
 * four renderers. Rather than migrate that (which would rewrite live rows), the
 * compiler emits both: authors work in 1920 × 1080 and `RENDER_SCALE` projects
 * the result onto the model the renderers already speak. The projection is
 * exact — 1920/1000 and 1080/562.5 are the same ratio — so nothing is lost.
 */
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;
export const CANVAS_LABEL = "1920x1080" as const;
export const RENDER_WIDTH = 1000;
export const RENDER_HEIGHT = 562.5;
export const RENDER_SCALE = RENDER_WIDTH / CANVAS_WIDTH;

/** Decoration is allowed to bleed off-canvas; nonsense coordinates are not. */
export const COORDINATE_MIN = -3840;
export const COORDINATE_MAX = 7680;

/**
 * Untrusted-input ceilings (§82). A `.jslayd` may arrive from an admin's
 * download folder, so every unbounded dimension of the format gets a bound.
 */
export const LIMITS = {
  sourceBytes: 512 * 1024,
  documentBytes: 4 * 1024 * 1024,
  archetypes: 120,
  elementsPerArchetype: 80,
  elementsPerDocument: 3000,
  fonts: 4,
  /** Files in one font package: a full family is nine weights plus its italics. */
  fontFaces: 10,
  colorFamilies: 12,
  gradientStops: 12,
  shadows: 6,
  chartPaletteColors: 24,
  tableColumns: 12,
  tableRows: 40,
  textLength: 4000,
  identifierLength: 64,
} as const;

/** Presentation tiers. These are the four the apps already ship (§3). */
export const TIERS = ["simple", "good", "great", "super_professional"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABELS: Record<Tier, string> = {
  simple: "Oddiy",
  good: "Yaxshi",
  great: "Ajoyib",
  super_professional: "Super Professional",
};

/**
 * Colour roles. A design names a role, never a hex, everywhere except the
 * `[COLOR_FAMILY]` block itself — which is what lets one design carry several
 * colour families without touching a single element.
 */
export const COLOR_ROLES = [
  "background",
  "surface",
  "surfaceAlt",
  "contrast",
  "primary",
  "secondary",
  "accent",
  "text",
  "textSecondary",
  "textOnPrimary",
  "textOnAccent",
  "textOnContrast",
  "muted",
  "border",
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

/** Roles an author must supply; the rest are derived in `deriveColorFamily`. */
export const REQUIRED_COLOR_ROLES: readonly ColorRole[] = [
  "background",
  "surface",
  "primary",
  "secondary",
  "accent",
  "text",
  "muted",
];

/** Typographic duties a font can be assigned. One font may hold several (§9). */
export const FONT_ROLES = [
  "display",
  "heading",
  "subheading",
  "body",
  "caption",
  "number",
  "quote",
] as const;
export type FontRole = (typeof FONT_ROLES)[number];

/**
 * Font container formats. Limited to what every consumer handles: the RN app
 * loads them through expo-font, the web through @font-face, and pdf-lib embeds
 * them through fontkit. WOFF2 is deliberately absent — fontkit cannot embed it,
 * so accepting it would produce decks whose PDF export silently lost the face.
 */
export const FONT_FORMATS = ["ttf", "otf", "woff"] as const;
export type FontFormat = (typeof FONT_FORMATS)[number];

export const FONT_MIME_TYPES: Record<FontFormat, readonly string[]> = {
  ttf: ["font/ttf", "application/x-font-ttf", "application/font-sfnt", "font/sfnt"],
  otf: ["font/otf", "application/x-font-otf", "application/font-sfnt"],
  woff: ["font/woff", "application/font-woff"],
};

/** Element vocabulary (§22). */
export const ELEMENT_TYPES = [
  "text",
  "image",
  "shape",
  "line",
  "icon",
  "badge",
  "frame",
  "group",
  "table",
  "chart",
  "stat",
  "quote",
  "list",
  "number",
  "divider",
  "decorative",
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const SHAPE_KINDS = [
  "rectangle",
  "roundedRectangle",
  "circle",
  "ellipse",
  "triangle",
  "polygon",
  "line",
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const CHART_KINDS = [
  "bar",
  "horizontalBar",
  "line",
  "area",
  "pie",
  "doughnut",
] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

/**
 * Charts the current renderers draw natively. Everything else in `CHART_KINDS`
 * compiles, but degrades to its nearest drawable relative and earns a WARNING —
 * the author is told, which is the whole point of §11.
 */
export const CHART_FALLBACKS: Partial<Record<ChartKind, "bar" | "line" | "donut">> = {
  bar: "bar",
  horizontalBar: "bar",
  line: "line",
  area: "line",
  pie: "donut",
  doughnut: "donut",
};

export const TEXT_ALIGNMENTS = ["left", "center", "right", "justify"] as const;
export const VERTICAL_ALIGNMENTS = ["top", "middle", "bottom"] as const;
export const TEXT_TRANSFORMS = ["none", "uppercase", "lowercase", "capitalize"] as const;
export const FONT_STYLES = ["normal", "italic"] as const;
export const OVERFLOW_MODES = ["shrink", "clip", "wrap"] as const;
export const IMAGE_FITS = ["cover", "contain", "fill"] as const;
export const BORDER_STYLES = ["solid", "dashed", "dotted"] as const;
export const GRADIENT_TYPES = ["linear", "radial"] as const;

/** Where an element's box is measured from before it becomes canonical (§20). */
export const ANCHORS = [
  "top-left", "top-center", "top-right",
  "center-left", "center", "center-right",
  "bottom-left", "bottom-center", "bottom-right",
] as const;
export type Anchor = (typeof ANCHORS)[number];

/** Text effects the renderers and both exporters can actually carry (§11). */
export const TEXT_EFFECTS = ["none", "shadow", "stroke", "outline", "highlight", "gradientText", "blur"] as const;
export type TextEffect = (typeof TEXT_EFFECTS)[number];

/** Where a slot's picture comes from at generation time (§25). */
/**
 * Where the picture in a slot comes from.
 *
 * `jelement` is the seam with the element library: the design says this slot
 * wants a reusable object rather than a photograph, and something upstream
 * finds one. JSLAYD still owns the geometry — the slot's box, its rounding, its
 * z-order — and the element only fills it.
 *
 * `ai_generated` is kept because published designs declare it and dropping it
 * would stop them compiling — but nothing generates any more. A slot asking for
 * it is served by the same licensed photo search as `internet_search`, and the
 * compiler says so. New designs should say what they mean.
 */
export const IMAGE_SOURCE_STRATEGIES = ["internet_search", "ai_generated", "user_upload", "jelement", "none"] as const;
export type ImageSourceStrategy = (typeof IMAGE_SOURCE_STRATEGIES)[number];

export const IMAGE_QUERY_SOURCES = ["slide_title", "slide_body", "keywords", "topic", "presentation_title"] as const;
export const IMAGE_ORIENTATIONS = ["landscape", "portrait", "square", "any"] as const;

/** Guards deciding whether an element survives for a given slide's content. */
export const CONDITIONS = [
  "always",
  "hasImage", "noImage",
  "hasStat", "hasChart", "hasTable", "hasQuote",
  "hasBullets", "hasBody", "hasSubtitle", "hasSources",
] as const;
export type Condition = (typeof CONDITIONS)[number];

/**
 * Slide archetypes (§40). `purpose` is drawn from this set; an archetype's own
 * id is free-form, so `text_image_01`, `text_image_02` and `text_image_03` all
 * declare `purpose: text_image` and the generator treats them as variants (§41).
 */
export const ARCHETYPE_PURPOSES = [
  "cover",
  "section",
  "title_content",
  "text_image",
  "image_text",
  "full_image",
  "quote",
  "statistics",
  "chart",
  "table",
  "comparison",
  "timeline",
  "process",
  "two_column",
  "three_column",
  "agenda",
  "conclusion",
  "thank_you",
  "references",
  "custom",
] as const;
export type ArchetypePurpose = (typeof ARCHETYPE_PURPOSES)[number];

/**
 * How an archetype maps onto the layout names the existing pipeline emits.
 * Migration and generation both need this: the AI writer still produces the old
 * `LayoutName` vocabulary, and JSLAYD has to be reachable from it without the
 * writer learning a new one (§43).
 */
export const LEGACY_LAYOUT_TO_PURPOSE: Record<string, ArchetypePurpose> = {
  cover: "cover",
  agenda: "agenda",
  title_body: "title_content",
  two_columns: "two_column",
  statistic: "statistics",
  quote: "quote",
  comparison: "comparison",
  timeline: "timeline",
  chart: "chart",
  conclusion: "conclusion",
  references: "references",
  thanks: "thank_you",
};

/**
 * Binding names a design may read (§38). The list is closed and the values are
 * supplied by the generator — there is no expression language, no property
 * access and no call syntax, so a binding can never become executable (§39).
 */
export const BINDINGS = [
  "title", "subtitle", "body", "bullets", "purpose", "section_label",
  "author", "teacher", "date", "brand", "page_number", "slide_count",
  "quote_text", "quote_attribution",
  "stat_value", "stat_label", "stat_1", "stat_2", "stat_3",
  "chart_data", "chart_title",
  "table_data", "table_title",
  "image_1", "image_2", "image_3",
  "sources",
] as const;
export type Binding = (typeof BINDINGS)[number];

export const BINDING_PATTERN = /^\{\{\s*([a-z][a-z0-9_]*)\s*\}\}$/;

/** Identifiers: design slugs, archetype ids, element ids, font asset names. */
export const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * The nearest legal slug to something a person typed.
 *
 * A slug is a file path prefix and a URL segment, so the database refuses
 * anything else — and it refuses it in its own words, which name a constraint
 * rather than say what to write. Offering the corrected form is the difference
 * between an error and an instruction.
 *
 * Returns nothing when there is no legal slug left to suggest, which is the
 * honest answer for a name written entirely in an alphabet this rule excludes.
 */
export function toSlug(value: string): string | null {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    // A slug opens with a letter, so leading digits go rather than the whole
    // suggestion: "2026 Yillik" is far more usefully "yillik" than nothing.
    .replace(/^[-0-9]+/, "")
    .replace(/-+$/, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64)
    .replace(/-+$/, "");
  return SLUG_PATTERN.test(slug) && slug.length >= 3 ? slug : null;
}
/**
 * Where a design's own pictures live.
 *
 * Public, like the font bucket, because every renderer has to fetch them —
 * the phone, the web preview, both exporters — and a signed URL that expires
 * is a design that stops drawing after an hour.
 */
export const DESIGN_ASSET_BUCKET = "design-assets";

/** A design asset is a file name inside the design's own folder, never a path. */
export const ASSET_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*\.(png|jpg|jpeg|webp|svg)$/i;

export const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

export const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * The smallest type the apps will keep, in *model* units.
 *
 * Every renderer and the stored-geometry repair pass clamp text below this, so
 * a design that shrinks past it does not get small type — it gets type the app
 * silently resizes, which is a layout nobody drew. The render engine therefore
 * stops here rather than at the authoring floor.
 */
export const MIN_RENDER_FONT_SIZE = 12;

/**
 * The same limit expressed on the canvas an author writes in. Below this the
 * analyzer warns, because the apps will alter anything smaller (§31).
 */
export const MIN_READABLE_FONT_SIZE = MIN_RENDER_FONT_SIZE / RENDER_SCALE;

/** The smallest size a design may *declare*. Smaller is refused at compile. */
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 480;

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

export function isSupportedVersion(value: unknown): value is string {
  return typeof value === "string" && SUPPORTED_VERSIONS.includes(value);
}
