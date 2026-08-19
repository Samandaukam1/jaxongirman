/**
 * Reading a .pptx into the shape the editor already stores.
 *
 * PowerPoint measures everything in EMU on a slide whose size the file itself
 * declares; the editor measures everything in a fixed 1000 × 562.5 canvas. So
 * the whole of this module is one conversion applied consistently — geometry,
 * font sizes, and the handful of style facts worth carrying over — plus the
 * bookkeeping to walk an OOXML package to the shapes in the first place.
 *
 * A placeholder that states no position of its own is looked up in the layout
 * it came from, and then in that layout's master. This was once left undone on
 * the grounds that a box in the wrong place is worse than a missing one — true,
 * but it was never a guess: the layout holds the exact rectangle, and not
 * reading it dropped the title of every deck built the way designers build
 * them. The same lookup supplies a run's size, weight and face when the slide
 * states none, which is why titles used to arrive at eighteen points.
 *
 * What is deliberately partial:
 *   * Charts and tables come in as their frame and a label. Rebuilding them as
 *     editable charts is a second feature, and silently losing them is worse
 *     than saying where they were.
 *   * Theme colours are resolved from the one theme part; a deck with several
 *     masters may pick the wrong accent, which is a colour being off rather
 *     than a slide being wrong.
 */

import type { ZipEntries } from "./unzip.ts";
import { attribute, child, childrenNamed, descendants, integerAttribute, parseXml, path, textOf, type XmlNode } from "./xml.ts";

/** The editor's canvas. Everything below is expressed in it. */
export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 562.5;

const EMU_PER_INCH = 914400;
const POINTS_PER_INCH = 72;
/** The editor caps a deck at thirty slides, so the importer does too. */
export const MAX_SLIDES = 30;

export type ImportedMedia = { part: string; bytes: Uint8Array; mime: string };

/**
 * A text box's real typography.
 *
 * Kept apart from `style` because the two answer different questions. `style`
 * is what this app can draw — it ships Manrope and nothing else, so a user's
 * imported deck is restyled to it on the way in, deliberately. `typography` is
 * what the file actually asked for, which is meaningless for a user's deck and
 * the entire point of a design template: a template imported in Manrope is not
 * the template.
 */
export type Typography = {
  /** Spelled as the package spells it — matching a font library needs the original. */
  fontFamily: string;
  /** Canvas units, on the same scale as every other measurement here. */
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  align: "left" | "center" | "right" | "justify";
  verticalAlign: "top" | "middle" | "bottom";
  /** Multiple of the font size; PowerPoint's own default is 1.2. */
  lineHeightRatio: number;
  letterSpacing: number;
  transform: "none" | "uppercase" | "lowercase";
  color: string;
  /**
   * Whether the box sets more than one face, size or weight across its runs.
   *
   * A single style is read from the first run, which is right almost always and
   * silently wrong for the one box a designer emphasised a word in. Saying so
   * lets an importer decide rather than discover.
   */
  mixed: boolean;
};

/** What a shape stands in for, when it stands in for something. */
export type PlaceholderRef = {
  /** `title`, `ctrTitle`, `subTitle`, `body`, `sldNum`, `ftr`, `dt`, `pic`, … */
  kind: string;
  /** Distinguishes the several body placeholders of one layout. */
  index: number | null;
};

export type ImportedElement = {
  type: "text" | "image" | "shape";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  opacity: number;
  style: Record<string, unknown>;
  content: Record<string, unknown>;
  /** Set on images: the part that still has to be uploaded. */
  media?: ImportedMedia;
  /** Set on text: what the file asked for, as opposed to what this app draws. */
  typography?: Typography;
  /** Set where the shape was a placeholder, which is what names its purpose. */
  placeholder?: PlaceholderRef;
};

export type ImportedSlide = {
  title: string | null;
  speakerNotes: string | null;
  background: Record<string, unknown>;
  elements: ImportedElement[];
};

export type ImportedDeck = {
  title: string | null;
  slides: ImportedSlide[];
  /** What was recognised but could not be carried over faithfully. */
  warnings: string[];
};

export class PptxError extends Error {}

/* ------------------------------------------------------------------ package */

function part(entries: ZipEntries, name: string): XmlNode | null {
  const bytes = entries.get(name);
  if (!bytes) return null;
  return parseXml(new TextDecoder().decode(bytes));
}

/** Resolves a relationship target against the directory of the part holding it. */
function resolveTarget(ownerPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = ownerPart.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === ".") continue;
    if (piece === "..") segments.pop();
    else segments.push(piece);
  }
  return segments.join("/");
}

/** rId → the part it points at, for one part's `.rels` sidecar. */
function relationships(entries: ZipEntries, ownerPart: string): Map<string, string> {
  const slash = ownerPart.lastIndexOf("/");
  const relsName = `${ownerPart.slice(0, slash)}/_rels/${ownerPart.slice(slash + 1)}.rels`;
  const document = part(entries, relsName);
  const map = new Map<string, string>();
  for (const relationship of childrenNamed(document, "Relationship")) {
    const id = attribute(relationship, "Id");
    const target = attribute(relationship, "Target");
    // External targets are URLs, not parts, and there is nothing to unpack.
    if (!id || !target || attribute(relationship, "TargetMode") === "External") continue;
    map.set(id, resolveTarget(ownerPart, target));
  }
  return map;
}

/* ------------------------------------------------------------------- colour */

const SCHEME_ALIASES: Record<string, string> = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };

/** name → `#rrggbb`, read from the single theme part when there is one. */
function themeColours(entries: ZipEntries): Map<string, string> {
  const colours = new Map<string, string>();
  const themeName = [...entries.keys()].find((name) => /^ppt\/theme\/theme\d+\.xml$/.test(name));
  if (!themeName) return colours;
  const scheme = path(part(entries, themeName), "themeElements", "clrScheme");
  for (const entry of scheme?.children ?? []) {
    const srgb = child(entry, "srgbClr");
    const system = child(entry, "sysClr");
    const value = attribute(srgb, "val") ?? attribute(system, "lastClr");
    if (value && /^[0-9a-fA-F]{6}$/.test(value)) colours.set(entry.name, `#${value.toLowerCase()}`);
  }
  return colours;
}

/* -------------------------------------------------------------------- fonts */

export type ThemeFonts = { major: string; minor: string };

/**
 * The two faces a theme names: one for headings, one for everything else.
 *
 * Every other typeface in a package is written literally, but these two are
 * referenced as `+mj-lt` and `+mn-lt`, so a template that sets its heading face
 * once in the theme names it nowhere a run can see. Resolving them here is what
 * makes `<a:latin typeface="+mj-lt"/>` mean something.
 */
export function themeFonts(entries: ZipEntries): ThemeFonts {
  const themeName = [...entries.keys()].find((name) => /^ppt\/theme\/theme\d+\.xml$/.test(name));
  const scheme = themeName ? path(part(entries, themeName), "themeElements", "fontScheme") : null;
  const face = (which: "majorFont" | "minorFont"): string =>
    attribute(path(scheme, which, "latin"), "typeface")?.trim() ?? "";
  return { major: face("majorFont") || "Arial", minor: face("minorFont") || "Arial" };
}

/** The `#rrggbb` of a fill-like node, following a scheme reference if needed. */
function colourOf(holder: XmlNode | null, theme: Map<string, string>): string | null {
  if (!holder) return null;
  const srgb = child(holder, "srgbClr");
  const direct = attribute(srgb, "val");
  if (direct && /^[0-9a-fA-F]{6}$/.test(direct)) return `#${direct.toLowerCase()}`;
  const schemeName = attribute(child(holder, "schemeClr"), "val");
  if (!schemeName) return null;
  return theme.get(SCHEME_ALIASES[schemeName] ?? schemeName) ?? null;
}

/* ----------------------------------------------------------------- geometry */

type Scale = { unitsPerEmuX: number; unitsPerEmuY: number; unitsPerPoint: number };

function scaleFor(slideWidthEmu: number, slideHeightEmu: number): Scale {
  return {
    unitsPerEmuX: CANVAS_WIDTH / slideWidthEmu,
    unitsPerEmuY: CANVAS_HEIGHT / slideHeightEmu,
    // A point is 1/72", and the canvas is `CANVAS_WIDTH` units across whatever
    // the deck calls its width — so type scales with the slide, not with a
    // guess about how big a point ought to look.
    unitsPerPoint: CANVAS_WIDTH / ((slideWidthEmu / EMU_PER_INCH) * POINTS_PER_INCH),
  };
}

type Frame = { x: number; y: number; width: number; height: number; rotation: number };

/** Reads `<a:xfrm>`, in EMU, before any group transform is applied. */
function rawFrame(xfrm: XmlNode | null): { x: number; y: number; width: number; height: number; rotation: number } | null {
  const offset = child(xfrm, "off");
  const extent = child(xfrm, "ext");
  const x = integerAttribute(offset, "x");
  const y = integerAttribute(offset, "y");
  const width = integerAttribute(extent, "cx");
  const height = integerAttribute(extent, "cy");
  if (x === null || y === null || width === null || height === null) return null;
  // `rot` is in sixtieths of a degree.
  return { x, y, width, height, rotation: (integerAttribute(xfrm, "rot") ?? 0) / 60000 };
}

/**
 * A group re-maps its children's coordinates: the child space declared by
 * `chOff`/`chExt` is stretched onto the group's own box. Composing that here
 * means everything below can pretend it is reading a flat slide.
 */
type GroupTransform = (point: { x: number; y: number; width: number; height: number }) => { x: number; y: number; width: number; height: number };

const IDENTITY: GroupTransform = (point) => point;

function groupTransform(xfrm: XmlNode | null, outer: GroupTransform): GroupTransform {
  const own = rawFrame(xfrm);
  const childOffset = child(xfrm, "chOff");
  const childExtent = child(xfrm, "chExt");
  const cx = integerAttribute(childOffset, "x");
  const cy = integerAttribute(childOffset, "y");
  const cw = integerAttribute(childExtent, "cx");
  const ch = integerAttribute(childExtent, "cy");
  if (!own || cx === null || cy === null || !cw || !ch) return outer;

  const scaleX = own.width / cw;
  const scaleY = own.height / ch;
  return (point) => outer({
    x: own.x + (point.x - cx) * scaleX,
    y: own.y + (point.y - cy) * scaleY,
    width: point.width * scaleX,
    height: point.height * scaleY,
  });
}

/**
 * EMU to canvas units, clamped into the frame the editor will accept.
 *
 * `slide_elements` refuses a negative origin or a non-positive size, and decks
 * routinely bleed art off every edge, so the visible part is what gets kept.
 * A shape entirely off-slide has no visible part and is dropped.
 */
function toCanvas(box: { x: number; y: number; width: number; height: number }, rotation: number, scale: Scale): Frame | null {
  const left = box.x * scale.unitsPerEmuX;
  const top = box.y * scale.unitsPerEmuY;
  const right = left + box.width * scale.unitsPerEmuX;
  const bottom = top + box.height * scale.unitsPerEmuY;

  const clampedLeft = Math.max(0, Math.min(left, CANVAS_WIDTH));
  const clampedTop = Math.max(0, Math.min(top, CANVAS_HEIGHT));
  const clampedRight = Math.max(0, Math.min(right, CANVAS_WIDTH));
  const clampedBottom = Math.max(0, Math.min(bottom, CANVAS_HEIGHT));

  const width = clampedRight - clampedLeft;
  const height = clampedBottom - clampedTop;
  if (width < 0.5 || height < 0.5) return null;

  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { x: round(clampedLeft), y: round(clampedTop), width: round(width), height: round(height), rotation: round(rotation) };
}

/* --------------------------------------------------------------------- text */

type Paragraph = { text: string; bulleted: boolean };

/** Runs are split wherever formatting changes; a paragraph is their concatenation. */
function paragraphsOf(txBody: XmlNode): Paragraph[] {
  const output: Paragraph[] = [];
  for (const paragraph of childrenNamed(txBody, "p")) {
    let text = "";
    for (const piece of paragraph.children) {
      if (piece.name === "r") text += textOf(child(piece, "t"));
      // `<a:br>` is a soft line break inside one paragraph.
      else if (piece.name === "br") text += "\n";
      else if (piece.name === "fld") text += textOf(child(piece, "t"));
    }
    const properties = child(paragraph, "pPr");
    const bulleted = Boolean(properties) && !child(properties, "buNone")
      && Boolean(child(properties, "buChar") ?? child(properties, "buAutoNum"));
    output.push({ text, bulleted });
  }
  return output;
}

/* ----------------------------------------------------------- inheritance */

/** What a shape stands in for, read from its non-visual properties. */
function placeholderOf(shape: XmlNode): PlaceholderRef | null {
  // The wrapper is named after what it wraps — `nvSpPr` for a shape, `nvPicPr`
  // for a picture — and the picture one matters most here: a template's photo
  // slot is exactly the thing a deck has to fill.
  const node = path(shape, "nvSpPr", "nvPr", "ph")
    ?? path(shape, "nvPicPr", "nvPr", "ph")
    ?? path(shape, "nvGraphicFramePr", "nvPr", "ph");
  if (!node) return null;
  const index = attribute(node, "idx");
  // A `<p:ph/>` with no type is a body placeholder; PowerPoint writes it that
  // way for the ordinary content box, which is the most common one of all.
  return { kind: attribute(node, "type") ?? "body", index: index === null ? null : Number(index) };
}

/** Position, and the run properties a slide left unsaid. */
type Inherited = { xfrm: XmlNode | null; run: XmlNode | null; paragraph: XmlNode | null };

const INHERITS_NOTHING: Inherited = { xfrm: null, run: null, paragraph: null };

/**
 * Whether a slide's placeholder and a layout's are the same slot.
 *
 * `idx` is the real identity and matches exactly when both carry one. Titles
 * are the exception PowerPoint itself makes: a layout's title has no index, and
 * `title` and `ctrTitle` are the same slot drawn two ways.
 */
function sameSlot(wanted: PlaceholderRef, candidate: PlaceholderRef): boolean {
  const isTitle = (kind: string) => kind === "title" || kind === "ctrTitle";
  if (isTitle(wanted.kind) && isTitle(candidate.kind)) return true;
  if (wanted.index !== null && candidate.index !== null) return wanted.index === candidate.index;
  return wanted.kind === candidate.kind;
}

/** A placeholder's own default run: its list style first, then its first run. */
function slotRun(shape: XmlNode): XmlNode | null {
  const listDefault = path(shape, "txBody", "lstStyle", "lvl1pPr", "defRPr");
  if (listDefault) return listDefault;
  return path(shape, "txBody", "p", "r", "rPr");
}

/** The master's blanket style for a kind of placeholder. */
function masterRun(master: XmlNode | null, kind: string): XmlNode | null {
  const style = kind === "title" || kind === "ctrTitle"
    ? "titleStyle"
    : kind === "body" || kind === "subTitle" || kind === "obj" ? "bodyStyle" : "otherStyle";
  return path(master, "txStyles", style, "lvl1pPr", "defRPr");
}

/**
 * Resolves what a slide's placeholders inherit, for one slide.
 *
 * The chain is the one PowerPoint uses — slide, then the layout it was made
 * from, then that layout's master — and it is walked only where the slide is
 * silent. A designer's template says almost everything once, in the layout, and
 * repeats none of it on the slides; reading only the slides therefore sees a
 * deck of unpositioned boxes at the default size.
 */
function inheritanceFor(entries: ZipEntries, slidePart: string): (placeholder: PlaceholderRef | null) => Inherited {
  const layoutPart = [...relationships(entries, slidePart).values()].find((name) => name.includes("slideLayout"));
  const layout = layoutPart ? part(entries, layoutPart) : null;
  const masterPart = layoutPart
    ? [...relationships(entries, layoutPart).values()].find((name) => name.includes("slideMaster"))
    : undefined;
  const master = masterPart ? part(entries, masterPart) : null;

  const shapesOf = (root: XmlNode | null): XmlNode[] => descendants(path(root, "cSld", "spTree"), "sp");
  const layoutShapes = shapesOf(layout);
  const masterShapes = shapesOf(master);

  return (placeholder) => {
    if (!placeholder) return INHERITS_NOTHING;
    const find = (shapes: XmlNode[]) =>
      shapes.find((shape) => {
        const candidate = placeholderOf(shape);
        return candidate !== null && sameSlot(placeholder, candidate);
      }) ?? null;

    const fromLayout = find(layoutShapes);
    const fromMaster = find(masterShapes);

    return {
      xfrm: path(fromLayout, "spPr", "xfrm") ?? path(fromMaster, "spPr", "xfrm"),
      run: (fromLayout ? slotRun(fromLayout) : null)
        ?? (fromMaster ? slotRun(fromMaster) : null)
        ?? masterRun(master, placeholder.kind),
      paragraph: path(fromLayout, "txBody", "p", "pPr") ?? path(fromMaster, "txBody", "p", "pPr"),
    };
  };
}

/* --------------------------------------------------------------- text look */

/** The first value any level of the chain states, or nothing. */
function inheritedAttribute(name: string, ...nodes: readonly (XmlNode | null)[]): string | null {
  for (const node of nodes) {
    const value = attribute(node, name);
    if (value !== null) return value;
  }
  return null;
}

/** Whether the box sets one look throughout, or several. */
function runsDiffer(txBody: XmlNode): boolean {
  const looks = new Set<string>();
  for (const paragraph of childrenNamed(txBody, "p")) {
    for (const run of childrenNamed(paragraph, "r")) {
      // A run with no text carries no look anybody sees.
      if (!textOf(child(run, "t")).trim()) continue;
      const properties = child(run, "rPr");
      looks.add([
        attribute(properties, "sz") ?? "",
        attribute(properties, "b") ?? "",
        attribute(properties, "i") ?? "",
        attribute(path(properties, "latin"), "typeface") ?? "",
      ].join("|"));
      if (looks.size > 1) return true;
    }
  }
  return false;
}

/** `+mj-lt` and `+mn-lt` are the theme's own two faces, not names. */
function resolveTypeface(name: string | null, fonts: ThemeFonts): string {
  if (!name) return fonts.minor;
  const trimmed = name.trim();
  if (trimmed.startsWith("+mj")) return fonts.major;
  if (trimmed.startsWith("+mn")) return fonts.minor;
  return trimmed || fonts.minor;
}

type TextLook = { style: Record<string, unknown>; typography: Typography };

/**
 * How a text box looks, said twice.
 *
 * `style` is deliberately Manrope whatever the file says: this app bundles one
 * family, and a user's imported deck rendering in a face nobody has is a deck
 * of fallback glyphs. `typography` keeps what was actually asked for, because a
 * design template is that request and nothing else.
 */
function readTextLook(
  txBody: XmlNode,
  inherited: Inherited,
  scale: Scale,
  theme: Map<string, string>,
  fonts: ThemeFonts,
): TextLook {
  const firstParagraph = child(txBody, "p");
  const runProperties = child(child(firstParagraph, "r"), "rPr");
  const paragraphProperties = child(firstParagraph, "pPr");
  const bodyProperties = child(txBody, "bodyPr");

  // `sz` is in hundredths of a point. 18pt is PowerPoint's own body default,
  // and is reached only when neither the slide, its layout nor the master says.
  const rawSize = inheritedAttribute("sz", runProperties, inherited.run);
  const points = (rawSize === null ? 1800 : Number(rawSize)) / 100;
  const fontSize = Math.max(6, Math.round(points * scale.unitsPerPoint * 10) / 10);

  const bold = inheritedAttribute("b", runProperties, inherited.run) === "1";
  const italic = inheritedAttribute("i", runProperties, inherited.run) === "1";
  const colour = colourOf(child(runProperties, "solidFill"), theme)
    ?? colourOf(child(inherited.run, "solidFill"), theme)
    ?? "#151a18";
  const alignment = inheritedAttribute("algn", paragraphProperties, inherited.paragraph);
  const align = alignment === "ctr" ? "center" : alignment === "r" ? "right" : alignment === "just" ? "justify" : "left";
  const underlined = (inheritedAttribute("u", runProperties, inherited.run) ?? "none") !== "none";

  // `spcPct` is thousandths of a percent; `spcPts` is hundredths of a point and
  // has to be divided by the size to become the ratio everything else uses.
  const spacing = child(paragraphProperties, "lnSpc") ?? child(inherited.paragraph, "lnSpc");
  const percent = integerAttribute(child(spacing, "spcPct"), "val");
  const exact = integerAttribute(child(spacing, "spcPts"), "val");
  const lineHeightRatio = percent
    ? Math.round((percent / 100000) * 100) / 100
    : exact && points > 0 ? Math.round((exact / 100 / points) * 100) / 100 : 1.2;

  const letterSpacingPoints = (integerAttribute(runProperties, "spc") ?? integerAttribute(inherited.run, "spc") ?? 0) / 100;
  const capitals = inheritedAttribute("cap", runProperties, inherited.run);
  const anchor = attribute(bodyProperties, "anchor");

  return {
    style: {
      color: colour,
      fontSize,
      lineHeight: Math.round(fontSize * 1.28),
      fontWeight: bold ? "700" : "400",
      fontFamily: bold ? "Manrope_700Bold" : "Manrope_400Regular",
      textAlign: align === "justify" ? "left" : align,
      letterSpacing: 0,
      ...(italic ? { fontStyle: "italic" } : {}),
      // `u` names an underline style; `none` is how a run turns off one it would
      // otherwise inherit, so its presence is not the same as being underlined.
      ...(underlined ? { textDecoration: "underline" } : {}),
    },
    typography: {
      fontFamily: resolveTypeface(
        attribute(path(runProperties, "latin"), "typeface") ?? attribute(path(inherited.run, "latin"), "typeface"),
        fonts,
      ),
      fontSize,
      fontWeight: bold ? 700 : 400,
      italic,
      align,
      verticalAlign: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
      lineHeightRatio,
      letterSpacing: Math.round(letterSpacingPoints * scale.unitsPerPoint * 100) / 100,
      // `small` is small capitals, which nothing downstream can draw; upper case
      // is the closer of the two lies.
      transform: capitals === "all" || capitals === "small" ? "uppercase" : "none",
      color: colour,
      mixed: runsDiffer(txBody),
    },
  };
}

/* ------------------------------------------------------------------- shapes */

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml",
};

function mediaFor(entries: ZipEntries, partName: string): ImportedMedia | null {
  const bytes = entries.get(partName);
  if (!bytes) return null;
  const extension = partName.slice(partName.lastIndexOf(".") + 1).toLowerCase();
  const mime = MIME_BY_EXTENSION[extension];
  // The assets bucket accepts four image types; anything else (emf, wmf, tiff)
  // would be rejected on upload, so it is reported rather than half-imported.
  if (!mime) return null;
  return { part: partName, bytes, mime };
}

type ShapeContext = {
  entries: ZipEntries;
  rels: Map<string, string>;
  scale: Scale;
  theme: Map<string, string>;
  fonts: ThemeFonts;
  inherit: (placeholder: PlaceholderRef | null) => Inherited;
  warnings: string[];
};

function convertShape(shape: XmlNode, transform: GroupTransform, zIndex: number, context: ShapeContext): ImportedElement | null {
  const placeholder = placeholderOf(shape);
  const inherited = context.inherit(placeholder);
  // A placeholder that states no rectangle is not undecided about where it goes
  // — it is pointing at the layout, which has one.
  const raw = rawFrame(path(shape, "spPr", "xfrm")) ?? rawFrame(inherited.xfrm);
  if (!raw) return null;
  const frame = toCanvas(transform(raw), raw.rotation, context.scale);
  if (!frame) return null;

  const txBody = child(shape, "txBody");
  const paragraphs = txBody ? paragraphsOf(txBody) : [];
  const written = paragraphs
    .map((paragraph) => (paragraph.bulleted && paragraph.text.trim() ? `• ${paragraph.text}` : paragraph.text))
    .join("\n")
    .trim();

  if (txBody && written) {
    const look = readTextLook(txBody, inherited, context.scale, context.theme, context.fonts);
    return {
      type: "text",
      ...frame,
      zIndex,
      opacity: 1,
      style: look.style,
      content: { text: written, maxLines: Math.max(1, written.split("\n").length) },
      typography: look.typography,
      ...(placeholder ? { placeholder } : {}),
    };
  }

  // No words: keep it only if it is actually painted, so the invisible boxes a
  // deck is full of do not become invisible boxes the user has to select past.
  const fill = colourOf(path(shape, "spPr", "solidFill"), context.theme);
  const outline = colourOf(path(shape, "spPr", "ln", "solidFill"), context.theme);
  if (!fill && !outline) return null;
  return {
    type: "shape",
    ...frame,
    zIndex,
    opacity: 1,
    style: {
      fill: fill ?? "transparent",
      borderRadius: 0,
      ...(outline ? { stroke: outline, strokeWidth: 1 } : {}),
    },
    content: {},
    ...(placeholder ? { placeholder } : {}),
  };
}

function convertPicture(picture: XmlNode, transform: GroupTransform, zIndex: number, context: ShapeContext): ImportedElement | null {
  const placeholder = placeholderOf(picture);
  const raw = rawFrame(path(picture, "spPr", "xfrm")) ?? rawFrame(context.inherit(placeholder).xfrm);
  if (!raw) return null;
  const frame = toCanvas(transform(raw), raw.rotation, context.scale);
  if (!frame) return null;

  const embed = attribute(path(picture, "blipFill", "blip"), "embed");
  const target = embed ? context.rels.get(embed) : null;
  if (!target) return null;
  const media = mediaFor(context.entries, target);
  if (!media) {
    context.warnings.push(`"${target.split("/").pop()}" rasm turini ilova qo‘llab-quvvatlamaydi.`);
    return null;
  }

  return {
    type: "image",
    ...frame,
    zIndex,
    opacity: 1,
    style: { objectFit: "cover", borderRadius: 0 },
    // The storage path is filled in by the importer once the bytes are up.
    content: {},
    media,
    ...(placeholder ? { placeholder } : {}),
  };
}

function convertFrame(graphicFrame: XmlNode, transform: GroupTransform, zIndex: number, context: ShapeContext): ImportedElement | null {
  const raw = rawFrame(child(graphicFrame, "xfrm"));
  if (!raw) return null;
  const frame = toCanvas(transform(raw), raw.rotation, context.scale);
  if (!frame) return null;

  // A table's text is right there in the XML, so it is worth keeping even
  // flattened; a chart's data lives in a separate part and is not.
  const table = descendants(graphicFrame, "tbl")[0];
  if (table) {
    const lines = childrenNamed(table, "tr").map((row) =>
      childrenNamed(row, "tc")
        .map((cell) => {
          const cellBody = child(cell, "txBody");
          return cellBody ? paragraphsOf(cellBody).map((paragraph) => paragraph.text).join(" ").trim() : "";
        })
        .join("  ·  ")
    );
    const written = lines.filter(Boolean).join("\n");
    if (!written) return null;
    context.warnings.push("Jadval matn sifatida olindi — katakchalar tahrirlanadi, chiziqlar yo‘q.");
    return {
      type: "text",
      ...frame,
      zIndex,
      opacity: 1,
      style: {
        color: "#151a18", fontSize: 16, lineHeight: 21, fontWeight: "400",
        fontFamily: "Manrope_400Regular", textAlign: "left", letterSpacing: 0,
      },
      content: { text: written, maxLines: Math.max(1, lines.length) },
    };
  }

  context.warnings.push("Diagramma o‘rni saqlandi, lekin uni qayta chizish kerak.");
  return {
    type: "shape",
    ...frame,
    zIndex,
    opacity: 1,
    style: { fill: "#eef1f0", borderRadius: 12, stroke: "#c9d2cf", strokeWidth: 1 },
    content: {},
  };
}

/** Walks a shape tree, flattening groups as it goes. */
function collect(tree: XmlNode, transform: GroupTransform, context: ShapeContext, elements: ImportedElement[]): void {
  for (const node of tree.children) {
    if (node.name === "sp") {
      const element = convertShape(node, transform, elements.length, context);
      if (element) elements.push(element);
    } else if (node.name === "pic") {
      const element = convertPicture(node, transform, elements.length, context);
      if (element) elements.push(element);
    } else if (node.name === "graphicFrame") {
      const element = convertFrame(node, transform, elements.length, context);
      if (element) elements.push(element);
    } else if (node.name === "grpSp") {
      collect(node, groupTransform(path(node, "grpSpPr", "xfrm"), transform), context, elements);
    }
  }
}

/** The shape marked as the slide's title, which becomes the slide's name. */
function titleOf(tree: XmlNode): string | null {
  for (const shape of descendants(tree, "sp")) {
    const placeholder = path(shape, "nvSpPr", "nvPr", "ph");
    const kind = attribute(placeholder, "type");
    if (kind !== "title" && kind !== "ctrTitle") continue;
    const body = child(shape, "txBody");
    const written = body ? paragraphsOf(body).map((paragraph) => paragraph.text).join(" ").trim() : "";
    if (written) return written.slice(0, 180);
  }
  return null;
}

/* --------------------------------------------------------------------- deck */

/**
 * Reads a .pptx package into slides the editor can store.
 *
 * Slide order comes from `<p:sldIdLst>` rather than from the file names, which
 * are only incidentally in order — a deck that has had slides reordered and
 * re-saved keeps `slide3.xml` in the middle.
 */
export function readPptx(entries: ZipEntries): ImportedDeck {
  const presentation = part(entries, "ppt/presentation.xml");
  if (!presentation) throw new PptxError("Bu fayl PowerPoint taqdimoti emas.");

  const size = child(presentation, "sldSz");
  const slideWidth = integerAttribute(size, "cx") ?? 12192000;
  const slideHeight = integerAttribute(size, "cy") ?? 6858000;
  if (slideWidth <= 0 || slideHeight <= 0) throw new PptxError("Taqdimot o‘lchami noto‘g‘ri.");

  const scale = scaleFor(slideWidth, slideHeight);
  const theme = themeColours(entries);
  const fonts = themeFonts(entries);
  const deckRels = relationships(entries, "ppt/presentation.xml");
  const warnings: string[] = [];

  const ordered: string[] = [];
  for (const slideId of childrenNamed(child(presentation, "sldIdLst"), "sldId")) {
    // `<p:sldId id="256" r:id="rId2"/>` — the plain `id` is a deck-local number
    // and only the relationship id names a part, so this one is matched exactly.
    const target = deckRels.get(slideId.attributes["r:id"] ?? "");
    if (target) ordered.push(target);
  }
  if (ordered.length === 0) throw new PptxError("Taqdimotda slayd topilmadi.");
  if (ordered.length > MAX_SLIDES) {
    warnings.push(`Taqdimotda ${ordered.length} ta slayd bor; dastlabki ${MAX_SLIDES} tasi olindi.`);
  }

  const slides: ImportedSlide[] = [];
  for (const slidePart of ordered.slice(0, MAX_SLIDES)) {
    const document = part(entries, slidePart);
    const tree = path(document, "cSld", "spTree");
    if (!tree) continue;

    const rels = relationships(entries, slidePart);
    // Rebuilt per slide: two slides of one deck can be made from two layouts.
    const context: ShapeContext = {
      entries, rels, scale, theme, fonts, warnings,
      inherit: inheritanceFor(entries, slidePart),
    };
    const elements: ImportedElement[] = [];
    collect(tree, IDENTITY, context, elements);

    const notesPart = [...rels.values()].find((name) => name.includes("notesSlide"));
    const notesBody = notesPart ? part(entries, notesPart) : null;
    const notes = notesBody
      ? descendants(notesBody, "txBody").map((body) => paragraphsOf(body).map((paragraph) => paragraph.text).join("\n")).join("\n").trim()
      : "";

    const background = colourOf(path(document, "cSld", "bg", "bgPr", "solidFill"), theme);

    slides.push({
      title: titleOf(tree),
      speakerNotes: notes ? notes.slice(0, 4000) : null,
      background: background ? { color: background } : {},
      elements,
    });
  }

  if (slides.length === 0) throw new PptxError("Taqdimotdan birorta slayd o‘qib bo‘lmadi.");

  return {
    title: slides[0]?.title ?? null,
    slides,
    warnings: [...new Set(warnings)],
  };
}
