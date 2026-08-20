/**
 * A PowerPoint template, read as a JSLAYD design.
 *
 * The premise of the whole feature is that a slide somebody designed and an
 * archetype somebody authored are the same object described twice: a canvas,
 * text at coordinates, pictures and shapes. So a template does not get its own
 * renderer, its own exporter or its own selection logic — it becomes a
 * `JslaydDocument` here, once, and everything downstream carries on unable to
 * tell where a design came from.
 *
 * Two rules shape every decision below.
 *
 * The first is that **the template's own words never survive**. Not into the
 * document, not into a preview, not into an export. A page's text boxes become
 * bindings — `{{title}}`, `{{bullets}}` — and the copy that fills them is
 * written for the deck being made. This is not a nicety: shipping a customer a
 * slide reading "Lorem ipsum" or, worse, the sales figures of whoever the
 * template was originally built for, is the one failure that cannot be excused.
 *
 * The second is that **colours become roles wherever they can**. A literal hex
 * is a colour the design is stuck with; a role is a colour the palette decides.
 * Since the generator is expected to recolour a design to suit its subject, a
 * template imported as hexes would be a template that cannot be recoloured, and
 * the feature would be half of what was asked for on the day it shipped.
 *
 * Free of Deno and of the database, so every rule here is testable on a machine
 * with neither.
 */

import { deriveColorFamily } from "./jslayd/colors.ts";
import type {
  Archetype,
  ColorFamily,
  ColorValue,
  FontDeclaration,
  Geometry,
  JslaydDocument,
  JslaydElement,
  SelectionRules,
  TextStyle,
  VisualDNA,
} from "./jslayd/document.ts";
import {
  COLOR_ROLES,
  JSLAYD_VERSION,
  type ArchetypePurpose,
  type Binding,
  type ColorRole,
  type Condition,
  type FontRole,
  type Tier,
} from "./jslayd/spec.ts";
import { CANVAS_HEIGHT, CANVAS_WIDTH, type ImportedDeck, type ImportedElement, type ImportedSlide, type Typography } from "./pptx.ts";

/* ------------------------------------------------------------------ output */

/**
 * A picture the template draws itself.
 *
 * A logo, a texture, the photograph a cover was built around: part of the
 * composition rather than a place to put something. The document references it
 * by `name`, and the importer uploads the bytes at `part` under that name, so
 * the two agree without either having to ask the other.
 */
export type TemplateArtwork = {
  /** The package part, so the importer can upload the bytes it already has. */
  part: string;
  /** The file name the document refers to it by, inside the design's folder. */
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesignPage = {
  archetype: Archetype;
  /**
   * Where the page sat in the uploaded file.
   *
   * Not the same as its position in `pages`: a page with nothing drawable is
   * dropped, so the fourth usable page can be the fifth slide. Anything that
   * goes back to the original — reading its words, showing an admin which slide
   * a warning is about — needs the number the file used.
   */
  sourceIndexInFile: number;
  /** The page's heading as the file wrote it — for the admin's list, never drawn. */
  sourceTitle: string | null;
  purpose: ArchetypePurpose;
  /** How many pieces of writing this page asks for. Drives page selection. */
  textSlots: number;
  imageSlots: number;
  artwork: TemplateArtwork[];
};

export type DesignDraft = {
  document: JslaydDocument;
  pages: DesignPage[];
  /** Typefaces the template asked for, most used first. */
  fonts: string[];
  warnings: string[];
};

export type DesignOptions = {
  name: string;
  slug: string;
  tier: Tier;
  premium?: boolean;
  description?: string;
};

/* ------------------------------------------------------------------ colour */

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** 0 for the same colour, 1 for black against white. */
function distance(first: string, second: string): number {
  const a = parseHex(first);
  const b = parseHex(second);
  if (!a || !b) return 1;
  const sum = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  return Math.sqrt(sum) / Math.sqrt(3 * 255 * 255);
}

function saturation(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [red, green, blue] = rgb;
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  return high === 0 ? 0 : (high - low) / high;
}

/**
 * Close enough to be the same colour said twice.
 *
 * PowerPoint writes a theme colour into a slide as a literal hex and then
 * writes it again a shade off after a tint, so exact matching would find the
 * palette in almost nothing. Six per cent of the diagonal of the colour cube is
 * about the point where two swatches stop being distinguishable on a projector,
 * which is the display that matters.
 */
const SAME_COLOUR = 0.06;

/**
 * A colour as a role where one fits, and as itself where none does.
 *
 * The role is what makes a template recolourable: swap the family and every
 * element that named a role follows. A colour that matches nothing — a brand
 * red in an otherwise blue template — stays literal, because forcing it to the
 * nearest role would silently repaint the one thing the designer was specific
 * about.
 */
export function colourValue(hex: string, family: ColorFamily): ColorValue {
  let bestRole: ColorRole | null = null;
  let best = SAME_COLOUR;
  for (const role of COLOR_ROLES) {
    const gap = distance(hex, family[role]);
    if (gap < best) { best = gap; bestRole = role; }
  }
  return bestRole ? { role: bestRole } : { hex: hex.toLowerCase() };
}

type Tally = Map<string, number>;

function add(tally: Tally, hex: string | undefined | null, weight: number): void {
  if (!hex || !parseHex(hex)) return;
  const key = hex.toLowerCase();
  tally.set(key, (tally.get(key) ?? 0) + weight);
}

function ranked(tally: Tally): string[] {
  return [...tally.entries()].sort((first, second) => second[1] - first[1]).map(([hex]) => hex);
}

/**
 * The palette a template is actually built from.
 *
 * Weighted by area rather than by count, because a design's background is one
 * rectangle and its bullet markers are forty: counting would elect the markers.
 */
export function readPalette(slides: readonly ImportedSlide[]): ColorFamily {
  const backgrounds: Tally = new Map();
  const fills: Tally = new Map();
  const inks: Tally = new Map();

  for (const slide of slides) {
    const background = typeof slide.background.color === "string" ? slide.background.color : null;
    add(backgrounds, background, CANVAS_WIDTH * CANVAS_HEIGHT);

    for (const element of slide.elements) {
      const area = Math.max(1, element.width * element.height);
      if (element.type === "shape") {
        const fill = element.style.fill;
        if (typeof fill === "string" && fill !== "transparent") add(fills, fill, area);
      } else if (element.type === "text") {
        // Weighted by how loud the type is, not how much of it there is: a
        // heading is the design's text colour in a way a footnote is not.
        const size = element.typography?.fontSize ?? 18;
        add(inks, element.typography?.color, size * element.width);
      }
    }
  }

  const background = ranked(backgrounds)[0] ?? ranked(fills)[0] ?? "#ffffff";
  const inkOrder = ranked(inks);
  const text = inkOrder[0] ?? "#151a18";

  // A fill that is the background is the background, however it was drawn.
  const candidates = ranked(fills).filter((hex) => distance(hex, background) > SAME_COLOUR);
  const distinct: string[] = [];
  for (const hex of candidates) {
    if (distinct.every((kept) => distance(kept, hex) > SAME_COLOUR)) distinct.push(hex);
  }

  const primary = distinct.find((hex) => distance(hex, text) > SAME_COLOUR) ?? distinct[0] ?? text;
  // The accent is the loudest colour, not the largest one — it is the small
  // bright rule under a heading far more often than it is a panel.
  const accent = [...distinct]
    .filter((hex) => distance(hex, primary) > SAME_COLOUR)
    .sort((first, second) => saturation(second) - saturation(first))[0];
  const secondary = distinct.find((hex) =>
    distance(hex, primary) > SAME_COLOUR && (!accent || distance(hex, accent) > SAME_COLOUR));
  // A surface is a panel that sits close to the background without being it.
  const surface = candidates.find((hex) => {
    const gap = distance(hex, background);
    return gap > SAME_COLOUR && gap < 0.22;
  });
  const muted = inkOrder.find((hex) => distance(hex, text) > SAME_COLOUR);

  return deriveColorFamily({
    background,
    text,
    primary,
    ...(accent ? { accent } : {}),
    ...(secondary ? { secondary } : {}),
    ...(surface ? { surface } : {}),
    ...(muted ? { muted } : {}),
  });
}

/* ------------------------------------------------------------------- fonts */

/** Faces this app already carries, so a match draws correctly before any download. */
const BUNDLED = ["Manrope", "League Spartan", "Arimo", "Pinyon Script", "Inter", "Caveat Brush"];

/**
 * Which font holds which duty, by size rank.
 *
 * A template's largest face is its display face; its most-used one is its body.
 * Where a template ships fewer fonts than duties, the extra duties fall to the
 * last font it does ship, so every role is always answered.
 *
 * The duties are spread so that every declared font owns at least one. A font
 * with no role is not merely idle — the compiler refuses it, and then refuses
 * every element that referenced it, so a template using four faces produced a
 * design that could not be published at all. It was invisible until a real
 * eleven-page template with four fonts went through; the fixtures had two.
 */
const ROLE_OWNER: Record<FontRole, number> = {
  display: 0, heading: 0, subheading: 1, body: 1, caption: 1, number: 2, quote: 3,
};

export function readFonts(slides: readonly ImportedSlide[], slug: string): FontDeclaration[] {
  const usage = new Map<string, { biggest: number; area: number }>();
  for (const slide of slides) {
    for (const element of slide.elements) {
      const typography = element.typography;
      if (!typography || !typography.fontFamily) continue;
      const seen = usage.get(typography.fontFamily) ?? { biggest: 0, area: 0 };
      seen.biggest = Math.max(seen.biggest, typography.fontSize);
      seen.area += Math.max(1, element.width * element.height);
      usage.set(typography.fontFamily, seen);
    }
  }

  const order = [...usage.entries()]
    .sort((first, second) => second[1].biggest - first[1].biggest || second[1].area - first[1].area)
    .map(([family]) => family)
    .slice(0, 4);
  // A template with no readable typography still needs a font declared, or the
  // document is invalid and nothing can be drawn at all.
  const families = order.length > 0 ? order : ["Manrope"];

  const roles: FontRole[][] = families.map(() => []);
  for (const [role, owner] of Object.entries(ROLE_OWNER) as [FontRole, number][]) {
    roles[Math.min(owner, families.length - 1)]!.push(role);
  }

  return families.map((name, index) => ({
    id: `font_${index + 1}`,
    name,
    roles: roles[index]!,
    family: `${slug}-font_${index + 1}`,
    // Until the real file resolves, the design draws in something. A template
    // that asked for a face the app already ships gets it immediately.
    fallback: BUNDLED.find((face) => face.toLowerCase() === name.toLowerCase()) ?? "Manrope",
    faces: [],
  }));
}

/* --------------------------------------------------------------- bindings */

/** What a placeholder is for, where the file says. */
const BY_PLACEHOLDER: Record<string, Binding | null> = {
  title: "title",
  ctrTitle: "title",
  subTitle: "subtitle",
  body: "body",
  obj: "body",
  sldNum: "page_number",
  dt: "date",
  // A template's footer is its own chrome — the studio's name, usually. Nothing
  // in a customer's deck should inherit it.
  ftr: null,
};

/** Text boxes worth binding, loudest first. */
function textBoxes(slide: ImportedSlide): ImportedElement[] {
  return slide.elements
    .filter((element) => element.type === "text")
    .sort((first, second) => {
      const size = (second.typography?.fontSize ?? 0) - (first.typography?.fontSize ?? 0);
      return size !== 0 ? size : first.y - second.y;
    });
}

function looksBulleted(element: ImportedElement): boolean {
  const text = typeof element.content.text === "string" ? element.content.text : "";
  return text.includes("•") || text.split("\n").filter(Boolean).length >= 3;
}

/**
 * Which binding each text box gets.
 *
 * Placeholders answer this outright where a template uses them, which good ones
 * do. Where it does not, the fallback is the order the eye reads a slide in:
 * the largest type is the title, a smaller line under it is the subtitle, and
 * the box carrying the most lines is the bulleted one.
 *
 * The vocabulary is closed and holds one body and one list, so a page with more
 * parallel columns than that cannot be filled without either repeating content
 * or keeping the template's own. Both are worse than the page carrying fewer
 * slots than it was drawn with, so the surplus boxes are dropped and counted.
 */
export function assignBindings(slide: ImportedSlide): Map<ImportedElement, Binding> {
  const assigned = new Map<ImportedElement, Binding>();
  const taken = new Set<Binding>();
  const boxes = textBoxes(slide);
  const unplaced: ImportedElement[] = [];

  for (const box of boxes) {
    const kind = box.placeholder?.kind;
    if (kind && kind in BY_PLACEHOLDER) {
      const binding = BY_PLACEHOLDER[kind]!;
      if (binding === null) continue;
      if (!taken.has(binding) || binding === "body") {
        if (!taken.has(binding)) { assigned.set(box, binding); taken.add(binding); continue; }
      }
    }
    unplaced.push(box);
  }

  for (const box of unplaced) {
    if (!taken.has("title")) { assigned.set(box, "title"); taken.add("title"); continue; }
    if (!taken.has("bullets") && looksBulleted(box)) { assigned.set(box, "bullets"); taken.add("bullets"); continue; }
    if (!taken.has("subtitle")) { assigned.set(box, "subtitle"); taken.add("subtitle"); continue; }
    if (!taken.has("body")) { assigned.set(box, "body"); taken.add("body"); continue; }
    if (!taken.has("bullets")) { assigned.set(box, "bullets"); taken.add("bullets"); continue; }
    // Out of slots. The box is dropped by the caller, which counts it.
  }

  return assigned;
}

/** A binding's guard, so a page drops the boxes this deck has nothing for. */
const GUARD: Partial<Record<Binding, Condition>> = {
  subtitle: "hasSubtitle",
  body: "hasBody",
  bullets: "hasBullets",
  quote_text: "hasQuote",
  quote_attribution: "hasQuote",
  sources: "hasSources",
};

/* ------------------------------------------------------------- conversion */

function geometryOf(element: ImportedElement, zIndex: number): Geometry {
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    x: round(element.x),
    y: round(element.y),
    width: round(Math.max(1, element.width)),
    height: round(Math.max(1, element.height)),
    rotation: round(element.rotation),
    zIndex,
    anchor: "top-left",
  };
}

function textStyleOf(typography: Typography, height: number, fonts: readonly FontDeclaration[], family: ColorFamily): TextStyle {
  const size = Math.max(6, typography.fontSize);
  const ratio = Math.min(4, Math.max(0.6, typography.lineHeightRatio));
  // Which font this is depends on how big it is, matching how the roles were
  // handed out: the display face is the one the largest type was measured at.
  const font = fonts.find((declared) => declared.name === typography.fontFamily) ?? fonts[0]!;
  return {
    font: font.id,
    fontSize: Math.round(size * 10) / 10,
    fontWeight: typography.fontWeight,
    fontStyle: typography.italic ? "italic" : "normal",
    letterSpacing: typography.letterSpacing,
    lineHeight: ratio,
    align: typography.align,
    verticalAlign: typography.verticalAlign,
    transform: typography.transform,
    color: colourValue(typography.color, family),
    maxLines: Math.max(1, Math.floor(height / Math.max(1, size * ratio))),
    overflow: "shrink",
    minFontSize: Math.round(Math.max(10, size * 0.6) * 10) / 10,
    effect: "none",
    shadows: [],
    strokeWidth: 0,
    strokeColor: null,
    highlight: null,
    gradient: null,
    blur: 0,
  };
}

const FALLBACK_TYPOGRAPHY: Typography = {
  fontFamily: "Manrope", fontSize: 18, fontWeight: 400, italic: false,
  align: "left", verticalAlign: "top", lineHeightRatio: 1.2, letterSpacing: 0,
  transform: "none", color: "#151a18", mixed: false,
};

/* --------------------------------------------------------------- purposes */

/** Roughly what a page is for, from how it is built. */
export function inferPurpose(slide: ImportedSlide, position: number, total: number): ArchetypePurpose {
  const texts = slide.elements.filter((element) => element.type === "text");
  const images = slide.elements.filter((element) => element.type === "image");
  const words = texts.reduce((sum, element) =>
    sum + (typeof element.content.text === "string" ? element.content.text.length : 0), 0);

  if (position === 0) return "cover";

  const biggest = images
    .map((image) => (image.width * image.height) / (CANVAS_WIDTH * CANVAS_HEIGHT))
    .sort((first, second) => second - first)[0] ?? 0;
  if (biggest > 0.7) return "full_image";

  // A page of almost nothing at the end is a sign-off; one in the middle is a
  // divider between parts. A page carrying a picture is neither, however few
  // words it has — the picture is the content.
  if (words < 60 && texts.length <= 2 && images.length === 0) {
    return position >= total - 1 ? "thank_you" : "section";
  }
  if (position >= total - 1) return "conclusion";

  if (images.length > 0) {
    const image = images[0]!;
    const centre = image.x + image.width / 2;
    return centre > CANVAS_WIDTH / 2 ? "text_image" : "image_text";
  }

  // Columns are peers: boxes of one size sharing a horizontal band.
  const bodies = texts.filter((element) => (element.typography?.fontSize ?? 0) < 28);
  const bands = new Map<number, number>();
  for (const body of bodies) {
    const band = Math.round(body.y / 40);
    bands.set(band, (bands.get(band) ?? 0) + 1);
  }
  const widest = Math.max(0, ...bands.values());
  if (widest >= 3) return "three_column";
  if (widest === 2) return "two_column";

  return "title_content";
}

function selectionFor(purpose: ArchetypePurpose, slots: number, images: number, capacity: number): SelectionRules {
  return {
    minText: purpose === "cover" || purpose === "section" || purpose === "thank_you" ? 0 : 60,
    maxText: Math.max(120, Math.round(capacity)),
    supportsImage: images > 0,
    supportsChart: false,
    supportsTable: false,
    supportsStats: purpose === "statistics",
    supportsQuote: purpose === "quote",
    // A page with more to fill is a better answer when several fit, because a
    // fuller composition is what the deck was asked for.
    priority: 50 + slots * 5 + images * 5,
  };
}

/* ------------------------------------------------------------------- pages */

function convertSlide(
  slide: ImportedSlide,
  position: number,
  total: number,
  fonts: readonly FontDeclaration[],
  family: ColorFamily,
  warnings: string[],
): DesignPage {
  const bindings = assignBindings(slide);
  const elements: JslaydElement[] = [];
  const artwork: TemplateArtwork[] = [];
  const id = `page_${String(position + 1).padStart(2, "0")}`;
  let images = 0;
  let dropped = 0;
  let capacity = 0;

  for (const element of slide.elements) {
    const geometry = geometryOf(element, elements.length);

    if (element.type === "text") {
      const binding = bindings.get(element);
      if (!binding) { dropped += 1; continue; }
      const typography = element.typography ?? FALLBACK_TYPOGRAPHY;
      const style = textStyleOf(typography, geometry.height, fonts, family);
      capacity += (style.maxLines ?? 1) * Math.max(1, geometry.width / Math.max(1, style.fontSize * 0.53));
      elements.push({
        type: "text",
        id: `${id}_${binding}`,
        geometry,
        when: GUARD[binding] ?? "always",
        opacity: element.opacity,
        grow: false,
        source: { bind: binding },
        text: style,
        background: null,
        corners: null,
        border: null,
        padding: 0,
      });
      continue;
    }

    if (element.type === "image") {
      // A picture placeholder is a hole the deck fills. Every other picture is
      // the template drawing itself — a logo, a texture, a cover photograph —
      // and no element type can hold one yet, so it is kept beside the document
      // rather than thrown away or turned into an empty frame.
      const isSlot = element.placeholder?.kind === "pic" || element.placeholder?.kind === "obj";
      if (!isSlot || images >= 3) {
        if (!element.media) continue;
        // The design's own picture. It draws itself, always, and waits for
        // nothing: a template that loses its logo is not that template.
        const extension = element.media.part.slice(element.media.part.lastIndexOf(".") + 1).toLowerCase();
        const name = `${id.replace(/[^a-z0-9]/g, "")}-art${artwork.length + 1}.${extension}`;
        artwork.push({
          part: element.media.part, name,
          x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height,
        });
        elements.push({
          type: "image",
          id: `${id}_art_${artwork.length}`,
          geometry,
          when: "always",
          opacity: element.opacity,
          grow: false,
          slot: `art_${artwork.length}`,
          source: { asset: name },
          strategy: "none",
          required: false,
          queryFrom: [],
          orientation: "any",
          stylePreference: null,
          fit: "cover",
          focus: { x: 0.5, y: 0.5 },
          corners: null,
          border: null,
          shadows: [],
          overlay: null,
          overlayOpacity: 0,
        });
        continue;
      }
      images += 1;
      const slot = `image_${images}` as Binding;
      elements.push({
        type: "image",
        id: `${id}_${slot}`,
        geometry,
        when: "hasImage",
        opacity: element.opacity,
        grow: false,
        slot,
        source: { bind: slot },
        strategy: "internet_search",
        required: images === 1,
        queryFrom: ["slide_title", "topic"],
        orientation: geometry.width > geometry.height * 1.2
          ? "landscape"
          : geometry.height > geometry.width * 1.2 ? "portrait" : "square",
        stylePreference: null,
        fit: "cover",
        focus: { x: 0.5, y: 0.5 },
        corners: null,
        border: null,
        shadows: [],
        overlay: null,
        overlayOpacity: 0,
      });
      continue;
    }

    const fill = typeof element.style.fill === "string" && element.style.fill !== "transparent"
      ? element.style.fill
      : null;
    const stroke = typeof element.style.stroke === "string" ? element.style.stroke : null;
    if (!fill && !stroke) continue;
    elements.push({
      type: "decorative",
      id: `${id}_shape_${elements.length}`,
      geometry,
      when: "always",
      opacity: element.opacity,
      grow: false,
      shape: "rectangle",
      fill: fill ? colourValue(fill, family) : null,
      corners: null,
      border: stroke ? { width: 1, color: colourValue(stroke, family), style: "solid", opacity: 1 } : null,
      shadows: [],
      sides: null,
      thickness: 0,
    });
  }

  if (dropped > 0) {
    warnings.push(`${position + 1}-sahifa: ${dropped} ta matn qutisi uchun o‘rin qolmadi va olib tashlandi.`);
  }

  const purpose = inferPurpose(slide, position, total);
  const textSlots = elements.filter((element) => element.type === "text").length;

  return {
    archetype: {
      id,
      purpose,
      background: typeof slide.background.color === "string"
        ? colourValue(slide.background.color, family)
        : { role: "background" },
      selection: selectionFor(purpose, textSlots, images, capacity),
      elements,
    },
    sourceIndexInFile: position,
    sourceTitle: slide.title,
    purpose,
    textSlots,
    imageSlots: images,
    artwork,
  };
}

/* -------------------------------------------------------------- visual DNA */

function visualDnaOf(slides: readonly ImportedSlide[]): VisualDNA {
  const sizes: number[] = [];
  const rotations: number[] = [];
  let shapes = 0;
  let images = 0;

  for (const slide of slides) {
    for (const element of slide.elements) {
      rotations.push(element.rotation);
      if (element.type === "text" && element.typography) sizes.push(element.typography.fontSize);
      if (element.type === "shape") shapes += 1;
      if (element.type === "image") images += 1;
    }
  }

  const sorted = [...sizes].sort((first, second) => first - second);
  const smallest = sorted[0] ?? 14;
  const largest = sorted[sorted.length - 1] ?? 48;
  const perSlide = shapes / Math.max(1, slides.length);

  return {
    rotationRange: {
      min: Math.min(0, ...rotations),
      max: Math.max(0, ...rotations),
    },
    cornerRadiusFamily: [0, 4, 8, 16, 24],
    shadowFamily: [],
    spacingScale: [4, 8, 12, 16, 24, 32, 48],
    // The largest face a template sets is its display size and the smallest is
    // its caption; the scales are those two, kept as they were drawn.
    titleScale: { min: Math.round(largest * 0.6), max: Math.round(largest) },
    bodyScale: { min: Math.round(smallest), max: Math.round(Math.max(smallest, largest * 0.45)) },
    imageTreatment: images > 0 ? "photo" : "abstract",
    decorationDensity: perSlide >= 6 ? "high" : perSlide >= 3 ? "medium" : perSlide >= 1 ? "low" : "none",
  };
}

/* -------------------------------------------------------------------- deck */

/**
 * A parsed template as a design.
 *
 * Never throws for a template it merely dislikes: a page it could not use
 * becomes a warning and the rest of the family still imports, because an admin
 * with twenty-four usable pages and a note about the twenty-fifth is better off
 * than one with a rejected upload and no idea which page caused it.
 */
export function toJslaydDocument(deck: ImportedDeck, options: DesignOptions): DesignDraft {
  const warnings = [...deck.warnings];
  const family = readPalette(deck.slides);
  const fonts = readFonts(deck.slides, options.slug);

  const pages = deck.slides.map((slide, position) =>
    convertSlide(slide, position, deck.slides.length, fonts, family, warnings));

  const usable = pages.filter((page) => page.archetype.elements.length > 0);
  if (usable.length !== pages.length) {
    warnings.push(`${pages.length - usable.length} ta sahifada chiziladigan element topilmadi.`);
  }

  const chartPalette = [family.primary, family.accent, family.secondary, family.muted];

  const document: JslaydDocument = {
    format: "JSLAYD",
    version: JSLAYD_VERSION,
    kind: "design",
    design: {
      name: options.name,
      slug: options.slug,
      tier: options.tier,
      description: options.description ?? `${options.name} — PowerPoint shablonidan olingan dizayn.`,
      premium: options.premium ?? false,
      canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    },
    colors: family,
    /**
     * The design's own palette, named.
     *
     * An empty array is not the same as an absent one: a document that omits
     * `colorFamilies` has the default filled in for it, and a document that
     * declares none is refused. This declared none — so every imported design
     * was stored in a shape `readDocument` rejects, which meant the generator
     * refused to load it and the fonts endpoint answered 422. Both looked like
     * unrelated faults.
     */
    colorFamilies: [{
      code: "asosiy",
      name: "Asosiy",
      colors: family,
      chartPalette,
    }],
    chartPalette,
    fonts,
    visualDNA: visualDnaOf(deck.slides),
    archetypes: usable.map((page) => page.archetype),
  };

  return {
    document,
    pages: usable,
    fonts: fonts.map((font) => font.name),
    warnings: [...new Set(warnings)],
  };
}
