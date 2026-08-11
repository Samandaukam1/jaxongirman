import type { LayoutName, PresentationStyle } from "./presentation-types.ts";

/**
 * Colour roles. Templates only ever name a role — never a hex value — so swapping
 * the palette family recolours an entire deck coherently.
 */
export type ColorRole =
  | "background"
  | "surface"
  | "surfaceAlt"
  | "contrast"
  | "primary"
  | "secondary"
  | "accent"
  | "textPrimary"
  | "textSecondary"
  | "textOnPrimary"
  | "textOnAccent"
  | "textOnContrast"
  | "border";

export type PaletteFamily = {
  code: string;
  name: string;
  sortOrder: number;
  tokens: Record<ColorRole, string> & { chartSeries: readonly string[] };
};

/** Named steps of the type scale; concrete pixel sizes live per template. */
export type FontStep = "mega" | "display" | "title" | "heading" | "body" | "caption" | "micro";

/**
 * Typographic voices. A template maps each to a concrete family, so a slide can
 * set an eyebrow in script, a headline in a display face and copy in a text face
 * — three distinct fonts on one slide, as the classic style requires.
 */
export type FontFamilyRole = "script" | "display" | "body";

/** Content a slot can be bound to. Decor slots carry no role. */
export type SlotRole =
  | "title"
  | "subtitle"
  | "body"
  | "bullets"
  | "statValue"
  | "statLabel"
  | "quoteText"
  | "quoteAttribution"
  | "image"
  | "chart"
  | "sources"
  | "brand"
  | "sectionLabel"
  | "pageNumber";

/** Guards that decide whether a slot renders for the slide's actual content. */
export type SlotCondition =
  | "always"
  | "hasImage"
  | "noImage"
  | "hasStat"
  | "hasChart"
  | "hasQuote"
  | "hasBullets"
  | "hasBody"
  | "hasSubtitle"
  | "hasSources";

/** x, y, width, height in the 1000 × 562.5 model canvas. May bleed off-canvas for decor. */
export type Frame = readonly [x: number, y: number, width: number, height: number];

export type FitRule = {
  /** Smallest font size the auto-shrink may fall to before truncating. */
  minFont?: number;
  maxLines?: number;
  /** Bullet lists only. */
  maxItems?: number;
  maxChars?: number;
};

export type TextSlot = {
  kind: "text";
  role: SlotRole;
  frame: Frame;
  font: FontStep;
  color: ColorRole;
  /** Defaults to `body`; `display` for headlines, `script` for eyebrows. */
  family?: FontFamilyRole;
  weight?: 400 | 500 | 600 | 700;
  align?: "left" | "center" | "right";
  letterSpacing?: number;
  transform?: "none" | "upper";
  when?: SlotCondition;
  fit?: FitRule;
  /** Absorbs the vertical space of any sibling slot whose condition failed. */
  grow?: boolean;
  z?: number;
  /** Literal text for slots that are not filled from slide content (e.g. brand). */
  literal?: string;
};

export type ImageSlot = {
  kind: "image";
  role: "image";
  frame: Frame;
  mask?: "rounded" | "circle";
  radius?: number;
  when?: SlotCondition;
  z?: number;
};

export type ChartSlot = {
  kind: "chart";
  role: "chart";
  frame: Frame;
  chart: "bar" | "line" | "donut";
  color: ColorRole;
  trackColor?: ColorRole;
  labelColor?: ColorRole;
  when?: SlotCondition;
  z?: number;
};

export type ShapeSlot = {
  kind: "shape";
  frame: Frame;
  color: ColorRole;
  /** `full` renders a circle/pill; a number is a corner radius. */
  round?: "full" | number;
  opacity?: number;
  gradientTo?: ColorRole;
  gradientAngle?: number;
  outline?: ColorRole;
  outlineWidth?: number;
  shadow?: boolean;
  when?: SlotCondition;
  z?: number;
};

export type IconSlot = {
  kind: "icon";
  frame: Frame;
  icon: string;
  color: ColorRole;
  when?: SlotCondition;
  z?: number;
};

export type Slot = TextSlot | ImageSlot | ChartSlot | ShapeSlot | IconSlot;

export type LayoutRecipe = {
  /** Slide background; defaults to the template's `background` role. */
  background?: ColorRole;
  slots: readonly Slot[];
};

/**
 * A layout may offer several compositions. The engine picks by slide position,
 * which is how the classic template rotates its text block through nine
 * placements instead of repeating one composition down the deck.
 */
export type LayoutVariants = LayoutRecipe | readonly LayoutRecipe[];

export type Blueprint = {
  type: Record<FontStep, number>;
  radius: { card: number; image: number };
  /** Concrete font families for each typographic voice. */
  fonts?: Record<FontFamilyRole, string>;
  /** Fallback recipe for any layout the template does not define explicitly. */
  fallback: LayoutVariants;
  layouts: Partial<Record<LayoutName, LayoutVariants>>;
};

/**
 * Which slides get a generated background image.
 *  - `none`       no slide does; the design is typographic and pays for nothing
 *  - `cover`      only the opening slide
 *  - `contextual` the opening slide plus any slide the writer asked for one
 *  - `all`        every slide that carries a visual prompt
 */
export type ImagePolicy = "none" | "cover" | "contextual" | "all";

export type ArtDirection = {
  /** Fed verbatim into the image-generation prompt. */
  imageStyle: string;
  illustrationStyle: string;
  mood: string;
  decorativeElements: readonly string[];
  chartStyle: string;
  spacingStyle: string;
  typography: { display: string; body: string };
  imagePolicy?: ImagePolicy;
};

export type SlideTemplate = {
  code: string;
  name: string;
  style: PresentationStyle;
  tagline: string;
  sortOrder: number;
  artDirection: ArtDirection;
  blueprint: Blueprint;
  /** Which layout the picker thumbnail renders. */
  previewLayout: LayoutName;
};
