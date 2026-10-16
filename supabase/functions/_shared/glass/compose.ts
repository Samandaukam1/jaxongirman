/**
 * A Liquid Glass deck, laid out.
 *
 * Content in, element rows out — the same rows the phone, the web viewer and
 * both exporters already draw. Every page is composed here from its own copy:
 * the words are measured with the faces' real advance widths, cards and tiles
 * are sized to what they hold, siblings share one type size, and the finished
 * page is checked. A page on which any words would touch other words, leave
 * their card or leave the slide is rebuilt smaller; one that still fails is
 * replaced by a plainer composition of the same content. Nothing overlapping
 * is ever saved.
 *
 * Variety is structural. Each kind of page has two compositions and the
 * second use of a kind takes the other; each page's light is generated for
 * that page; nothing is designed in advance.
 *
 * Two styles share every layout. `glass` draws cards as lit translucent
 * panes over light; `editorial` draws the same boxes as flat tints, outlines
 * or rules on paper, with square marks and photographs to the edge — and sets
 * the cover, the agenda, the quote and the closing page as a magazine would.
 * The measuring and the checking do not know which style they serve.
 */

import { alpha, random } from "./color.ts";
import { backdrop, H, intersects, round, W, type Light, type Rect, type Row } from "./backdrop.ts";
import { paperBackdrop } from "./paper.ts";
import { studioBackdrop } from "./studio.ts";
import { indicator, raisedRows, wellRow } from "./soft.ts";
import { brandFill, corporateBackdrop, dropRows } from "./corporate.ts";
import { familyFill, leafCorners, naqshBackdrop, ornament, starRows } from "./naqsh.ts";
import { heroField, heroFill, heroIcon, spektrBackdrop } from "./spektr.ts";
import { mosaic, mozaikaBackdrop } from "./mozaika.ts";
import type { SlideContent } from "./content.ts";
import type { DesignDNA, FontPick } from "./dna.ts";
import { clip, columnHeight, fit, fitGroup, textWidth, wrap, type Fitted, type Placed, type Spec } from "./text.ts";
import { iconVector, lucideName, pickIcon } from "./icons.ts";
import { CHROME, deckNumber, type DeckLanguage } from "./language.ts";

export type Picture = { bucket: string; path: string } | { url: string };

/** Turns a font choice into the style fields every renderer reads. */
export type FaceResolver = (pick: FontPick) => Record<string, unknown>;

export type ComposedSlide = {
  title: string;
  layout: string;
  background: Record<string, unknown>;
  rows: Row[];
  report: Record<string, unknown>;
};

const MX = 64;
const RIGHT = W - MX;
const SPAN = RIGHT - MX;
const BOTTOM = 500;
type Align = "left" | "center" | "right";

type Ctx = {
  dna: DesignDNA;
  /** The deck's language: the words the server sets itself, and how numbers are written. */
  language: DeckLanguage;
  face: FaceResolver;
  index: number;
  total: number;
  short: string;
  variant: number;
  /** Below 1 when a page is being rebuilt because it did not fit. */
  scale: number;
  rows: Row[];
};

/** `ground`: a page that is a field of colour rather than the deck's white. */
type Built = { light: Light; hero?: boolean; ground?: string };

/** The words this deck's language puts on the pages the server sets. */
const L = (ctx: Ctx) => CHROME[ctx.language];

/* ----------------------------------------------------------------- atoms */

function row(type: Row["type"], rect: Rect, style: Record<string, unknown>, content: Record<string, unknown>): Row {
  return {
    type,
    x: round(rect.x),
    y: round(rect.y),
    width: round(Math.max(1, rect.width)),
    height: round(Math.max(1, rect.height)),
    rotation: 0,
    z_index: 0,
    opacity: 1,
    locked: false,
    style,
    content,
  };
}

const serifLike = (pick: FontPick) => /serif|prata|gloock|gilda|caslon|playfair|standard|instrument/i.test(pick.family);

/** Display sans tightens as it grows; serifs are drawn to be set as they are. */
const trackingFor = (pick: FontPick, size: number): number =>
  pick.tracking ?? (size >= 26 && !serifLike(pick) ? round(-size * 0.018) : 0);

function text(ctx: Ctx, at: { x: number; y: number; width: number }, fitted: Fitted, pick: FontPick, color: string, role: string,
  options: { align?: Align; upper?: boolean } = {}): number {
  if (!fitted.text) return at.y;
  const height = Math.max(fitted.lineHeight, fitted.height);
  ctx.rows.push(row("text", { x: at.x, y: at.y, width: at.width, height }, {
    color,
    fontSize: fitted.size,
    lineHeight: fitted.lineHeight,
    textAlign: options.align ?? "left",
    letterSpacing: trackingFor(pick, fitted.size),
    verticalAlign: "top",
    ...ctx.face(pick),
  }, { text: options.upper ? fitted.text.toUpperCase() : fitted.text, role }));
  return at.y + height;
}

type Piece = { placed: Placed; pick: FontPick; color: string; role: string; align?: Align; upper?: boolean };

/** A column of pieces, stacked with their gaps. Returns the bottom. */
function stack(ctx: Ctx, pieces: Piece[], at: { x: number; y: number; width: number }): number {
  let y = at.y;
  let first = true;
  for (const piece of pieces) {
    if (!piece.placed.text) continue;
    if (!first) y += piece.placed.gap;
    y = text(ctx, { x: at.x, y, width: at.width }, piece.placed, piece.pick, piece.color, piece.role, { align: piece.align, upper: piece.upper });
    first = false;
  }
  return y;
}

/** Whether this deck is set in the editorial style. */
const paper = (ctx: Ctx) => ctx.dna.style === "editorial";

/**
 * An editorial card: a flat tint, a hairline outline, or nothing but a rule
 * across its top — the deck's `panelLook` decides, the same for every card.
 * A strong panel (a chart, a hero number) always has substance.
 */
function flat(ctx: Ctx, rect: Rect, options: { strong?: boolean; radius?: number } = {}): void {
  const { colors } = ctx.dna;
  const look = options.strong && ctx.dna.panelLook === "rule" ? "tint" : ctx.dna.panelLook;
  const radius = Math.min(options.radius ?? ctx.dna.radius, rect.height / 2);
  ctx.rows.push(row("shape", rect, {
    fill: look === "tint" ? (options.strong ? colors.panelStrong : colors.panel) : "#00000000",
    borderRadius: radius,
    ...(look === "outline" ? { stroke: colors.line, strokeWidth: 1 } : {}),
  }, { kind: "panel" }));
  if (look === "rule") ctx.rows.push(row("shape", { x: rect.x, y: rect.y, width: rect.width, height: 2 }, { fill: colors.ink, borderRadius: 0 }, { kind: "accent" }));
}

/** Whether this deck is set in the soft 3D style. */
const softly = (ctx: Ctx) => ctx.dna.style === "soft3d";

/**
 * A soft 3D card: the surface itself pushed up toward the viewer — lit along
 * its upper left edge, its shadow falling to the lower right (`glass/soft.ts`).
 */
function raised(ctx: Ctx, rect: Rect, options: { strong?: boolean; radius?: number } = {}): void {
  const radius = Math.min(options.radius ?? ctx.dna.radius, rect.height / 2);
  ctx.rows.push(...raisedRows(ctx.dna, rect, radius, options.strong ? 11 : 8));
}

/** Whether this deck is set in the corporate style. */
const corp = (ctx: Ctx) => ctx.dna.style === "corporate";

/** A corporate card: white, rounded, floating on a soft realistic shadow. */
function floating(ctx: Ctx, rect: Rect, options: { strong?: boolean; radius?: number } = {}): void {
  const radius = Math.min(options.radius ?? ctx.dna.radius, rect.height / 2);
  ctx.rows.push(...dropRows(ctx.dna, rect, radius, options.strong ? 15 : 11));
  ctx.rows.push(row("shape", rect, { fill: "#FFFFFF", borderRadius: radius, stroke: ctx.dna.colors.rim, strokeWidth: 1 }, { kind: "panel" }));
}

/** Whether this deck is set in the national-ornament style. */
const national = (ctx: Ctx) => ctx.dna.style === "naqsh";

/**
 * A naqsh card: white on a light shadow, a hairline of the deck's colour, and
 * a short bar of its gradient along the top edge — a tile's glazed border.
 */
function tiled(ctx: Ctx, rect: Rect, options: { strong?: boolean; radius?: number } = {}): void {
  const radius = Math.min(options.radius ?? ctx.dna.radius, rect.height / 2);
  ctx.rows.push(...dropRows(ctx.dna, rect, radius, options.strong ? 11 : 8));
  ctx.rows.push(row("shape", rect, { fill: "#FFFFFF", borderRadius: radius, stroke: ctx.dna.colors.rim, strokeWidth: 1 }, { kind: "panel" }));
  if (rect.width > 120 && rect.height > 60) {
    const bar = { x: rect.x + radius, y: rect.y, width: Math.min(rect.width - radius * 2, 64), height: 3 };
    ctx.rows.push(row("shape", bar, { ...familyFill(ctx.dna, 90), borderRadius: 1.5 }, { kind: "accent" }));
  }
}

/** Whether this deck is set in the Spektr (infographic) style. */
const vivid = (ctx: Ctx) => ctx.dna.style === "spektr";

/** Whether this deck is set in the Mozaika (geometric) style. */
const geometric = (ctx: Ctx) => ctx.dna.style === "mozaika";

/** The styles whose figures, icons and cards each take their own colour of a spectrum. */
const spectral = (ctx: Ctx) => vivid(ctx) || geometric(ctx);

/**
 * The colour of the n-th figure, icon or card on a page. A Spektr deck gives
 * each its own colour of the spectrum; every other style keeps the one it
 * would have used anyway.
 */
function tint(ctx: Ctx, index: number, otherwise: string): string {
  if (!spectral(ctx)) return otherwise;
  const spectrum = ctx.dna.colors.chart;
  return spectrum[((index % spectrum.length) + spectrum.length) % spectrum.length]!;
}

/** A Spektr card: plain white on a light shadow; the colour is in what it holds. */
function bright(ctx: Ctx, rect: Rect, options: { strong?: boolean; radius?: number } = {}): void {
  const radius = Math.min(options.radius ?? ctx.dna.radius, rect.height / 2);
  ctx.rows.push(...dropRows(ctx.dna, rect, radius, options.strong ? 12 : 9));
  ctx.rows.push(row("shape", rect, { fill: "#FFFFFF", borderRadius: radius, stroke: ctx.dna.colors.rim, strokeWidth: 1 }, { kind: "panel" }));
}

/** A translucent card with a lit top edge, a bright rim and a soft lift. */
function glass(ctx: Ctx, rect: Rect, options: { strong?: boolean; radius?: number } = {}): void {
  if (spectral(ctx)) return bright(ctx, rect, options);
  if (paper(ctx)) return flat(ctx, rect, options);
  if (softly(ctx)) return raised(ctx, rect, options);
  if (corp(ctx)) return floating(ctx, rect, options);
  if (national(ctx)) return tiled(ctx, rect, options);
  const { colors } = ctx.dna;
  const dark = ctx.dna.direction.mode === "dark";
  const fill = options.strong ? colors.glassStrong : colors.glass;
  ctx.rows.push(row("shape", rect, {
    fill,
    gradientStops: [{ color: colors.sheen, offset: 0 }, { color: fill, offset: 46 }, { color: fill, offset: 100 }],
    gradientAngle: 162,
    borderRadius: Math.min(options.radius ?? ctx.dna.radius, rect.height / 2),
    stroke: colors.rim,
    strokeWidth: 1,
    backdropBlur: 22,
    shadows: [{ color: colors.shadow, opacity: dark ? 0.34 : 0.12, blur: 30, offsetX: 0, offsetY: 14 }],
  }, { kind: "glass" }));
}

function bar(ctx: Ctx, rect: Rect, color: string): void {
  ctx.rows.push(row("shape", rect, { fill: color, borderRadius: paper(ctx) ? 0 : round(Math.min(rect.width, rect.height) / 2) }, { kind: "accent" }));
}

function dot(ctx: Ctx, center: { x: number; y: number }, diameter: number, color: string): void {
  if (national(ctx)) {
    ctx.rows.push(...starRows(center, diameter * 1.15, { fill: color }, "accent"));
    return;
  }
  if (softly(ctx)) {
    ctx.rows.push(...indicator(ctx.dna, center, Math.max(5, diameter * 0.7)));
    return;
  }
  // Editorial marks are square: a printed bullet, not a lit one.
  const side = paper(ctx) ? round(diameter * 0.78) : diameter;
  ctx.rows.push(row("shape", { x: center.x - side / 2, y: center.y - side / 2, width: side, height: side },
    paper(ctx) ? { fill: color, borderRadius: 0 } : { shape: "ellipse", fill: color }, { kind: "accent" }));
}

function rule(ctx: Ctx, from: { x: number; y: number }, width: number, color: string, weight = 1): void {
  ctx.rows.push(row("line", { x: from.x, y: from.y - 4, width, height: 8 }, { color, strokeWidth: weight }, { kind: "rule" }));
}

/** A numbered disc lit in the accent. */
function badge(ctx: Ctx, center: { x: number; y: number }, diameter: number, label: string, index?: number): void {
  const { colors, fonts } = ctx.dna;
  if (spectral(ctx)) {
    // A disc of the spectrum; a numbered badge takes the colour of its number.
    const nth = index ?? ((Number.parseInt(label, 10) || 1) - 1);
    ctx.rows.push(row("shape", { x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter }, { shape: "ellipse", fill: tint(ctx, nth, colors.accent) }, { kind: "badge" }));
  } else if (softly(ctx)) {
    // A round button standing off the surface, its number lit in the accent.
    ctx.rows.push(...raisedRows(ctx.dna, { x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter }, diameter / 2, 4, "badge"));
  } else if (national(ctx)) {
    // An eight-pointed star of the deck's gradient: the number set in a tile.
    ctx.rows.push(...starRows(center, diameter * 1.18, familyFill(ctx.dna), "badge"));
  } else if (corp(ctx)) {
    // An icon tile: a rounded square in the brand's gradient, on its own shadow.
    const tile = { x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter };
    ctx.rows.push(...dropRows(ctx.dna, tile, diameter * 0.3, 5));
    ctx.rows.push(row("shape", tile, { ...brandFill(ctx.dna), borderRadius: round(diameter * 0.3) }, { kind: "badge" }));
  } else ctx.rows.push(row("shape", { x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter }, paper(ctx)
    // A square tag in the deck's colour.
    ? { fill: colors.accent, borderRadius: Math.min(ctx.dna.radius, 4) }
    : {
      shape: "ellipse",
      fill: colors.accent,
      gradientStops: [{ color: colors.accent, offset: 0 }, { color: colors.accent2, offset: 100 }],
      gradientAngle: 135,
      stroke: alpha("#FFFFFF", 0.5),
      strokeWidth: 1,
    }, { kind: "badge" }));
  // An icon badge draws its own glyph; there is no number to set.
  if (!label) return;
  const size = round(diameter * (label.length > 2 ? 0.32 : 0.4));
  const lineHeight = round(size * 1.2);
  text(ctx, { x: center.x - diameter / 2, y: center.y - lineHeight / 2, width: diameter },
    { text: label, size, lineHeight, lines: 1, height: lineHeight }, { ...fonts.strong, tracking: 0 }, colors.onAccent, "badge", { align: "center" });
}

function imageContent(source: Picture): Record<string, unknown> {
  return "url" in source
    ? { kind: "image", url: source.url }
    : { kind: "image", storageBucket: source.bucket, storagePath: source.path };
}

function picture(ctx: Ctx, rect: Rect, source: Picture, radius: number): void {
  if (paper(ctx)) {
    // A block of the deck's colour set behind the photograph, offset toward
    // the page edge the way a magazine prints one.
    const shift = 12;
    const toward = rect.x + rect.width / 2 < W / 2 ? -1 : 1;
    const back = { x: rect.x + toward * shift, y: rect.y + shift, width: rect.width, height: rect.height };
    if (back.x >= 0 && back.x + back.width <= W && back.y + back.height <= H) {
      ctx.rows.push(row("shape", back, { fill: ctx.dna.colors.block, borderRadius: Math.min(ctx.dna.radius, 4) }, { kind: "accent" }));
    }
    ctx.rows.push(row("image", rect, { objectFit: "cover", borderRadius: Math.min(ctx.dna.radius, 4) }, imageContent(source)));
    return;
  }
  if (geometric(ctx)) {
    // An arch — or, for a wide picture, a leaf — with a block of a mosaic
    // colour of the same shape behind it, offset up and out toward the edge.
    const r = Math.min(rect.width, rect.height) / 2;
    const corners = (rect.height >= rect.width * 0.9 ? [r, r, radius, radius] : [r, radius, r, radius]).map(round);
    const toward = rect.x + rect.width / 2 < W / 2 ? -1 : 1;
    const back = { x: rect.x + toward * 18, y: rect.y - 18, width: rect.width, height: rect.height };
    const tiles = ctx.dna.tiles?.page ?? [ctx.dna.colors.accent];
    if (back.y >= 0 && back.x >= -40 && back.x + back.width <= W + 40) {
      ctx.rows.push(row("shape", back, { fill: tiles[ctx.index % tiles.length]!, borderRadius: radius, borderRadiusCorners: corners }, { kind: "accent" }));
    }
    ctx.rows.push(...dropRows(ctx.dna, rect, radius, 12, false, corners));
    ctx.rows.push(row("image", rect, { objectFit: "cover", borderRadius: radius, borderRadiusCorners: corners }, imageContent(source)));
    return;
  }
  if (vivid(ctx)) {
    // A block of the hero gradient behind the photograph, offset up and out
    // toward the page's edge — away from the words and the footer — and the
    // photograph rounded over it on its shadow.
    const toward = rect.x + rect.width / 2 < W / 2 ? -1 : 1;
    const back = { x: rect.x + toward * 16, y: rect.y - 16, width: rect.width, height: rect.height };
    if (back.y >= 0 && back.x >= -40 && back.x + back.width <= W + 40) ctx.rows.push(row("shape", back, { ...heroFill(ctx.dna, 135), borderRadius: radius + 8 }, { kind: "accent" }));
    ctx.rows.push(...dropRows(ctx.dna, rect, radius + 8, 12));
    ctx.rows.push(row("image", rect, { objectFit: "cover", borderRadius: radius + 8 }, imageContent(source)));
    return;
  }
  if (national(ctx)) {
    // The bodom's leaf: a white frame with two opposite corners swept wide,
    // on a light shadow, and a small star set at one of its square corners.
    const frame = { x: rect.x - 6, y: rect.y - 6, width: rect.width + 12, height: rect.height + 12 };
    const leaf = leafCorners(frame.width, frame.height, 12);
    ctx.rows.push(...dropRows(ctx.dna, frame, 12, 12, false, leaf));
    ctx.rows.push(row("shape", frame, { fill: "#FFFFFF", borderRadius: 12, borderRadiusCorners: leaf }, { kind: "frame" }));
    ctx.rows.push(row("image", rect, { objectFit: "cover", borderRadius: 8, borderRadiusCorners: leafCorners(rect.width, rect.height, 6) }, imageContent(source)));
    ctx.rows.push(...starRows({ x: frame.x + frame.width - 4, y: frame.y + 4 }, 22, familyFill(ctx.dna), "accent"));
    return;
  }
  if (corp(ctx)) {
    // A block of the brand behind the photograph, offset toward the page's
    // edge, and the photograph floating over it on its shadow.
    const toward = rect.x + rect.width / 2 < W / 2 ? -1 : 1;
    const back = { x: rect.x + toward * 22, y: rect.y + 22, width: rect.width, height: rect.height };
    if (back.x >= -40 && back.x + back.width <= W + 40) ctx.rows.push(row("shape", back, { ...brandFill(ctx.dna), borderRadius: radius + 4 }, { kind: "accent" }));
    ctx.rows.push(...dropRows(ctx.dna, rect, radius + 4, 14));
    ctx.rows.push(row("image", rect, { objectFit: "cover", borderRadius: radius + 4 }, imageContent(source)));
    return;
  }
  if (softly(ctx)) {
    // A photograph set into the surface, in a well around its edge.
    ctx.rows.push(wellRow(ctx.dna, { x: rect.x - 10, y: rect.y - 10, width: rect.width + 20, height: rect.height + 20 }, radius + 10));
    ctx.rows.push(row("image", rect, { objectFit: "cover", borderRadius: radius }, imageContent(source)));
    return;
  }
  glass(ctx, { x: rect.x - 7, y: rect.y - 7, width: rect.width + 14, height: rect.height + 14 }, { strong: true, radius: radius + 7 });
  ctx.rows.push(row("image", rect, { objectFit: "cover", borderRadius: radius }, imageContent(source)));
}

const num = (index: number) => String(index + 1).padStart(2, "0");

/** Type sizes at full scale, shrunk together when a page is rebuilt. */
function sizes(ctx: Ctx) {
  const s = ctx.scale;
  return {
    title: 42 * s, lead: 18 * s, number: 36 * s, cardTitle: 21 * s, cardText: 16.5 * s,
    stat: 70 * s, statLabel: 17 * s, chip: 16 * s,
  };
}

/* ---------------------------------------------------------------- frames */

/** Eyebrow and title. Returns where the next thing may start. */
function header(ctx: Ctx, slide: { eyebrow: string; title: string }, at: {
  x?: number; y?: number; width: number; max?: number; lines?: number; align?: "left" | "center";
}): number {
  const { colors, fonts } = ctx.dna;
  const x = at.x ?? MX;
  const y = at.y ?? 46;
  const align = at.align ?? "left";
  const eyebrow = clip(slide.eyebrow || `${num(ctx.index - 1)} · ${ctx.short}`, 40);
  const eyebrowFit = fit({ text: eyebrow, font: fonts.label, width: at.width - 32, height: 16, max: 10.5, min: 8.5, leading: 1.3, upper: true, maxLines: 1 });
  if (align === "left" && softly(ctx)) {
    // The label as a pressed-in tag with its indicator lit.
    const tagWidth = Math.min(at.width, textWidth(eyebrowFit.text, eyebrowFit.size, fonts.label, true) + 42);
    ctx.rows.push(wellRow(ctx.dna, { x, y: y - 5, width: tagWidth, height: 23 }, 11.5));
    ctx.rows.push(...indicator(ctx.dna, { x: x + 13, y: y + 6.5 }, 5));
    text(ctx, { x: x + 24, y, width: at.width - 24 }, eyebrowFit, fonts.label, colors.accent, "eyebrow", { upper: true });
  } else if (align === "left") {
    if (national(ctx)) ctx.rows.push(...starRows({ x: x + 6, y: y + 6.8 }, 11, familyFill(ctx.dna), "accent"));
    else if (geometric(ctx)) {
      // A quarter disc and a dot: the mosaic in miniature.
      ctx.rows.push(row("shape", { x, y: y + 1, width: 12, height: 12 }, { fill: colors.accent, borderRadius: 0, borderRadiusCorners: [12, 0, 0, 0] }, { kind: "accent" }));
      ctx.rows.push(row("shape", { x: x + 15, y: y + 4, width: 7, height: 7 }, { shape: "ellipse", fill: ctx.dna.tiles?.page[2] ?? colors.accent2 }, { kind: "accent" }));
    }
    else if (paper(ctx)) bar(ctx, { x, y: y + 3, width: 8, height: 8 }, colors.accent);
    else bar(ctx, { x, y: y + 5.6, width: 20, height: 2.4 }, colors.accent);
    text(ctx, { x: x + 30, y, width: at.width - 30 }, eyebrowFit, fonts.label, colors.accent, "eyebrow", { upper: true });
  } else {
    text(ctx, { x, y, width: at.width }, eyebrowFit, fonts.label, colors.accent, "eyebrow", { upper: true, align: "center" });
  }
  const max = (at.max ?? sizes(ctx).title);
  const lines = at.lines ?? 2;
  const titleFit = fit({ text: slide.title, font: fonts.title, width: at.width, height: lines * max * 1.12, max, min: Math.min(max, 22), leading: 1.1, maxLines: lines });
  if ((corp(ctx) || vivid(ctx)) && align === "left") return twoTone(ctx, { x, y: y + 24, width: at.width }, titleFit, fonts.title, "title");
  return text(ctx, { x, y: y + 24, width: at.width }, titleFit, fonts.title, colors.ink, "title", { align });
}

/**
 * A corporate title in two tones: its last line in the brand, or — on one
 * line — its last word. Each part is its own row, set where the measured
 * line puts it, so nothing the renderer wraps differently can collide.
 */
function twoTone(ctx: Ctx, at: { x: number; y: number; width: number }, fitted: Fitted, pick: FontPick, role: string): number {
  const { colors } = ctx.dna;
  if (!fitted.text) return at.y;
  const lines = wrap(fitted.text, fitted.size, pick, at.width);
  const lh = fitted.lineHeight;
  const piece = (value: string) => ({ text: value, size: fitted.size, lineHeight: lh, lines: 1, height: lh });
  if (lines.length >= 2) {
    lines.forEach((line, index) => text(ctx, { x: at.x, y: at.y + index * lh, width: at.width }, piece(line), pick, index === lines.length - 1 ? colors.accent : colors.ink, role));
    return at.y + lines.length * lh;
  }
  const words = fitted.text.split(" ");
  if (words.length < 2) return text(ctx, at, fitted, pick, colors.ink, role);
  const head = `${words.slice(0, -1).join(" ")} `;
  // Measured as the renderer will draw it — the face's own advances with the
  // row's tracking, without the safety margin used for wrapping — so the brand
  // word sits one space after the rest, not a gap away. Three points of room
  // keep the first part from ever wrapping.
  const tracking = trackingFor(pick, fitted.size);
  const exact = textWidth(head, fitted.size, { ...pick, tracking: 0 }) / 1.035 + tracking * head.length;
  const headWidth = Math.min(at.width, exact + 3);
  text(ctx, { x: at.x, y: at.y, width: headWidth }, piece(head.trimEnd()), pick, colors.ink, role);
  text(ctx, { x: at.x + headWidth, y: at.y, width: at.width - headWidth }, piece(words[words.length - 1]!), pick, colors.accent, role);
  return at.y + lh;
}

/** How tall a header would be, without drawing it. */
function headerHeight(ctx: Ctx, slide: { eyebrow: string; title: string }, at: { width: number; max?: number; lines?: number }): number {
  return header({ ...ctx, rows: [] }, slide, { ...at, y: 0 });
}

function leadFit(ctx: Ctx, value: string, width: number, height: number, max?: number): Fitted | null {
  if (!value) return null;
  return fit({ text: value, font: ctx.dna.fonts.body, width, height, max: max ?? sizes(ctx).lead, min: 12, leading: 1.45 });
}

function footer(ctx: Ctx, from = MX): void {
  const { colors, fonts } = ctx.dna;
  const label = { ...fonts.label, tracking: 1.6 };
  // The corporate page keeps its bottom edge for the brand: its title and
  // number sit at the top, beside the deck's mark.
  if (corp(ctx)) {
    const nav = fit({ text: ctx.short, font: label, width: 300, height: 12, max: 8.5, min: 7.5, leading: 1.3, upper: true, maxLines: 1 });
    text(ctx, { x: 60, y: 26, width: 300 }, nav, label, alpha(colors.inkSoft, 0.85), "footer", { upper: true });
    const page = `${num(ctx.index - 1)} / ${String(ctx.total).padStart(2, "0")}`;
    text(ctx, { x: RIGHT - 120, y: 26, width: 120 }, { text: page, size: 8.5, lineHeight: 11, lines: 1, height: 11 }, label, alpha(colors.inkSoft, 0.85), "page", { align: "right" });
    return;
  }
  // The naqsh page keeps its right edge for the band of ornament: its title
  // and number sit together on the left, parted by a small star.
  if (national(ctx)) {
    const page = `${num(ctx.index - 1)} / ${String(ctx.total).padStart(2, "0")}`;
    const pageWidth = textWidth(page, 8.5, label) + 4;
    text(ctx, { x: from, y: 526, width: pageWidth }, { text: page, size: 8.5, lineHeight: 11, lines: 1, height: 11 }, label, colors.accent, "page");
    ctx.rows.push(...starRows({ x: from + pageWidth + 9, y: 531.5 }, 7, { fill: alpha(colors.accent, 0.6) }, "accent"));
    const title = fit({ text: ctx.short, font: label, width: 420, height: 12, max: 8.5, min: 7.5, leading: 1.3, upper: true, maxLines: 1 });
    text(ctx, { x: from + pageWidth + 20, y: 526, width: 420 }, title, label, alpha(colors.inkSoft, 0.8), "footer", { upper: true });
    return;
  }
  // The editorial page closes on a hairline, as a printed one does.
  if (paper(ctx)) rule(ctx, { x: from, y: 517 }, RIGHT - from, colors.line);
  const left = fit({ text: ctx.short, font: label, width: Math.min(520, RIGHT - from - 140), height: 12, max: 8.5, min: 7.5, leading: 1.3, upper: true, maxLines: 1 });
  text(ctx, { x: from, y: 526, width: Math.min(520, RIGHT - from - 140) }, left, label, alpha(colors.inkSoft, 0.8), "footer", { upper: true });
  const page = `${num(ctx.index - 1)} / ${String(ctx.total).padStart(2, "0")}`;
  if (softly(ctx)) {
    const pill = textWidth(page, 8.5, label) + 22;
    ctx.rows.push(wellRow(ctx.dna, { x: RIGHT - pill + 11, y: 520, width: pill, height: 19 }, 9.5));
  }
  text(ctx, { x: RIGHT - 120, y: 526, width: 120 }, { text: page, size: 8.5, lineHeight: 11, lines: 1, height: 11 }, label, alpha(colors.inkSoft, 0.8), "page", { align: "right" });
}

/** A title column on the left, centred on the page; returns its rows' bottom. */
function sideColumn(ctx: Ctx, slide: SlideContent, width: number): void {
  const { colors, fonts } = ctx.dna;
  const max = Math.min(sizes(ctx).title, 36);
  const measured = headerHeight(ctx, slide, { width, max, lines: 4 });
  const lead = leadFit(ctx, slide.lead, width, 460 - measured - 16, 15.5 * ctx.scale);
  const total = measured + (lead ? lead.height + 16 : 0);
  const top = Math.max(46, (H - total) / 2 - 16);
  const y = header(ctx, slide, { y: top, width, max, lines: 4 });
  if (lead) text(ctx, { x: MX, y: y + 16, width }, lead, fonts.body, colors.inkSoft, "lead");
}

/** Headline across the top, and the lead under it. Returns where content may start. */
function topBlock(ctx: Ctx, slide: SlideContent, width: number, leadLines = 2): number {
  const { colors, fonts } = ctx.dna;
  const y = header(ctx, slide, { width });
  const lead = slide.lead
    ? fit({ text: slide.lead, font: fonts.body, width: Math.min(width, 720), height: leadLines * 16.5 * 1.45, max: sizes(ctx).lead, min: 12, leading: 1.45, maxLines: leadLines })
    : null;
  return lead ? text(ctx, { x: MX, y: y + 12, width: Math.min(width, 720) }, lead, fonts.body, colors.inkSoft, "lead") : y;
}

/** Where a block of `height` sits in [top, bottom]: a little above centre. */
const settle = (top: number, bottom: number, height: number) => top + Math.max(0, (bottom - top - height) * 0.42);

/* -------------------------------------------------------- content pages */

/* ----------------------------------------------------------------- icons */

type IconLook = {
  color: string;
  gradient?: [string, string];
  shadow?: { color: string; dx: number; dy: number; blur: number; opacity: number };
  weight: "fill" | "duo";
};

/**
 * An icon in the deck's own manner: a two-tone glyph lit by the accent's
 * gradient on glass, a flat solid mark in print, the device's neon on soft
 * 3D, the brand's gradient over a real shadow on a corporate page.
 */
function iconLook(ctx: Ctx): IconLook {
  const { colors } = ctx.dna;
  if (paper(ctx)) return { color: colors.accent, weight: "fill" };
  if (softly(ctx)) return { color: colors.accent, weight: "fill", shadow: { color: colors.shadow, dx: 1.5, dy: 2.5, blur: 4, opacity: 0.45 } };
  if (corp(ctx)) {
    const [brand, brand2] = colors.glows;
    return { color: brand!, gradient: [brand!, brand2!], weight: "fill", shadow: { color: colors.shadow, dx: 0, dy: 3, blur: 6, opacity: 0.3 } };
  }
  if (national(ctx)) return { color: colors.accent, gradient: [colors.accent, colors.accent2], weight: "fill", shadow: { color: colors.shadow, dx: 0, dy: 2, blur: 4, opacity: 0.22 } };
  if (spectral(ctx)) return { color: colors.chart[0]!, gradient: [colors.chart[0]!, colors.chart[1]!], weight: "fill" };
  return {
    color: colors.accent, gradient: [colors.accent, colors.accent2], weight: "duo",
    shadow: { color: ctx.dna.direction.mode === "dark" ? "#000000" : colors.accent, dx: 0, dy: 3, blur: 7, opacity: 0.3 },
  };
}

function iconRow(ctx: Ctx, rect: Rect, name: string, look: IconLook, options: { kind?: string; decor?: boolean; opacity?: number } = {}): Row {
  const one = row("icon", rect, {
    color: look.color,
    ...(look.gradient ? { gradientStops: [{ color: look.gradient[0], offset: 0 }, { color: look.gradient[1], offset: 100 }], gradientAngle: 135 } : {}),
    ...(look.shadow ? { iconShadow: look.shadow } : {}),
  }, {
    // Older phone builds draw Lucide by name; newer ones draw `vector`.
    icon: lucideName(name),
    glyph: name,
    vector: iconVector(name, look.weight),
    kind: options.kind ?? "icon",
    ...(options.decor ? { decor: true } : {}),
  });
  return { ...one, opacity: options.opacity ?? 1, locked: Boolean(options.decor) };
}

function icon(ctx: Ctx, center: { x: number; y: number }, size: number, name: string, index = 0): void {
  if (spectral(ctx)) {
    // The infographic way: a white glyph in a disc of its own colour.
    ctx.rows.push(row("shape", { x: center.x - size / 2, y: center.y - size / 2, width: size, height: size }, { shape: "ellipse", fill: tint(ctx, index, ctx.dna.colors.accent) }, { kind: "badge" }));
    const glyph = size * 0.56;
    ctx.rows.push(iconRow(ctx, { x: center.x - glyph / 2, y: center.y - glyph / 2, width: glyph, height: glyph }, name, { color: "#FFFFFF", weight: "fill" }));
    return;
  }
  ctx.rows.push(iconRow(ctx, { x: center.x - size / 2, y: center.y - size / 2, width: size, height: size }, name, iconLook(ctx)));
}

/**
 * The icon at the far end of a card's number row. The number's box is first
 * narrowed to its own figures, so the two never share a rectangle — and when
 * the card is too narrow for both, the number stays and the icon does not.
 */
function numberedIcon(ctx: Ctx, placed: Placed, pick: FontPick, card: { x: number; y: number; width: number }, pad: number, size: number, name: string, index = 0): void {
  const figures = textWidth(placed.text, placed.size, pick) * 1.08 + 6;
  let number: Row | undefined;
  for (let at = ctx.rows.length - 1; at >= 0 && !number; at -= 1) {
    const one = ctx.rows[at]!;
    if (one.type === "text" && one.content.role === "number") number = one;
  }
  if (number) number.width = round(Math.min(number.width, figures));
  const right = card.x + card.width - pad;
  if (right - size < card.x + pad + figures + 8) return;
  icon(ctx, { x: right - size / 2, y: card.y + pad + placed.lineHeight / 2 }, size, name, index);
}

/** A round or square badge carrying an icon instead of a number. */
function iconBadge(ctx: Ctx, center: { x: number; y: number }, diameter: number, name: string, index = 0): void {
  badge(ctx, center, diameter, "", index);
  const size = diameter * 0.52;
  const onBadge: IconLook = spectral(ctx)
    ? { color: "#FFFFFF", weight: "fill" }
    : softly(ctx)
    ? { color: ctx.dna.colors.accent, weight: "fill" }
    : { color: ctx.dna.colors.onAccent, weight: "fill" };
  ctx.rows.push(iconRow(ctx, { x: center.x - size / 2, y: center.y - size / 2, width: size, height: size }, name, onBadge, { kind: "badge-icon" }));
}

/** One icon per point: the writer's choice when it is new on the page, else what the words call for. */
function pointIcons(items: { title: string; text: string; icon?: string }[]): string[] {
  const used = new Set<string>();
  return items.map((item, index) => {
    const chosen = item.icon && !used.has(item.icon) ? item.icon : pickIcon(`${item.title} ${item.text}`, used, index);
    used.add(chosen);
    return chosen;
  });
}

/**
 * The page's subject as a large, faint mark in a corner the layout left
 * empty — never touching a word, a card or a picture. Skipped when there is
 * no such corner.
 */
function subjectMark(ctx: Ctx, name: string): Row | null {
  const taken = ctx.rows.map((one) => ({ x: one.x, y: one.y, width: one.width, height: one.height }));
  const look = iconLook(ctx);
  const dark = ctx.dna.direction.mode === "dark";
  const opacity = paper(ctx) ? 0.1 : softly(ctx) ? 0.12 : corp(ctx) || national(ctx) ? 0.1 : spectral(ctx) ? 0.08 : dark ? 0.16 : 0.12;
  const mark: IconLook = { ...look, weight: paper(ctx) || softly(ctx) ? "fill" : look.weight, shadow: undefined };
  for (const size of [210, 180, 150, 124]) {
    const spots = [
      { x: W - 40 - size, y: H - 44 - size }, { x: W - 40 - size, y: 40 }, { x: 40, y: H - 44 - size },
      { x: W - 40 - size, y: (H - size) / 2 }, { x: (W - size) / 2, y: H - 44 - size },
    ];
    for (const spot of spots) {
      const box = { x: spot.x, y: spot.y, width: size, height: size };
      if (taken.some((rect) => intersects(box, rect, 16))) continue;
      return iconRow(ctx, box, name, mark, { kind: "mark", decor: true, opacity });
    }
  }
  return null;
}

function cardSpecs(ctx: Ctx, item: { title: string; text: string }, index: number, compact: boolean): Spec[] {
  const { fonts } = ctx.dna;
  const s = sizes(ctx);
  return [
    { text: num(index), font: fonts.display, size: compact ? s.number * 0.82 : s.number, min: 18, leading: 1.05, maxLines: 1 },
    { text: item.title, font: fonts.strong, size: compact ? s.cardTitle * 0.9 : s.cardTitle, min: 12.5, leading: 1.25, maxLines: 2, gap: 12 },
    { text: item.text, font: fonts.body, size: compact ? s.cardText * 0.94 : s.cardText, min: 11, leading: 1.45, gap: 8 },
  ];
}

function pieces(ctx: Ctx, placed: Placed[], roles: string[], colors: string[], picks: FontPick[], align?: Align): Piece[] {
  return placed.map((one, index) => ({ placed: one, pick: picks[index]!, color: colors[index]!, role: roles[index]!, align }));
}

function cards(ctx: Ctx, slide: SlideContent): Built {
  const { colors, fonts } = ctx.dna;
  const items = slide.points.slice(0, 4);
  const n = items.length;
  const pad = 22;

  if (ctx.variant % 2 === 1) {
    sideColumn(ctx, slide, 296);
    const area = { x: 392, y: 52, width: RIGHT - 392, height: 456 };
    if (n === 4) {
      const gap = 16;
      const cw = (area.width - gap) / 2;
      const group = fitGroup(items.map((item, index) => cardSpecs(ctx, item, index, true)), cw - pad * 2, (area.height - gap) / 2 - pad * 2);
      const ch = Math.max(150, ...group.pieces.map((column) => columnHeight(column) + pad * 2));
      const top = settle(area.y, area.y + area.height, ch * 2 + gap);
      const icons = pointIcons(items);
      items.forEach((_, index) => {
        const x = area.x + (index % 2) * (cw + gap);
        const y = top + Math.floor(index / 2) * (ch + gap);
        glass(ctx, { x, y, width: cw, height: ch });
        stack(ctx, pieces(ctx, group.pieces[index]!, ["number", "card-title", "card-text"], [tint(ctx, index, colors.accent), colors.ink, colors.inkSoft], [fonts.display, fonts.strong, fonts.body]), { x: x + pad, y: y + pad, width: cw - pad * 2 });
        // In the number's row, at the far edge: the number stays the order, the icon says what it is.
        numberedIcon(ctx, group.pieces[index]![0]!, fonts.display, { x, y, width: cw }, pad, 34, icons[index]!, index);
      });
    } else {
      const gap = 14;
      const inner = area.width - 108;
      const group = fitGroup(items.map((item) => [
        { text: item.title, font: fonts.strong, size: sizes(ctx).cardTitle, min: 12.5, leading: 1.25, maxLines: 2 },
        { text: item.text, font: fonts.body, size: sizes(ctx).cardText, min: 11, leading: 1.45, gap: 6 },
      ]), inner, (area.height - gap * (n - 1)) / n - 28);
      const ch = Math.max(84, ...group.pieces.map((column) => columnHeight(column) + 28));
      const top = settle(area.y, area.y + area.height, ch * n + gap * (n - 1));
      const listIcons = pointIcons(items);
      items.forEach((_, index) => {
        const y = top + index * (ch + gap);
        glass(ctx, { x: area.x, y, width: area.width, height: ch });
        iconBadge(ctx, { x: area.x + 42, y: y + ch / 2 }, 42, listIcons[index]!, index);
        const column = group.pieces[index]!;
        stack(ctx, pieces(ctx, column, ["card-title", "card-text"], [colors.ink, colors.inkSoft], [fonts.strong, fonts.body]), { x: area.x + 84, y: y + (ch - columnHeight(column)) / 2, width: inner });
      });
    }
    footer(ctx);
    return { light: "right" };
  }

  const start = topBlock(ctx, slide, 680) + 26;
  const gap = 18;
  const cw = (SPAN - gap * (n - 1)) / n;
  const group = fitGroup(items.map((item, index) => cardSpecs(ctx, item, index, n === 4)), cw - pad * 2, BOTTOM - start - pad * 2);
  const ch = Math.max(170, ...group.pieces.map((column) => columnHeight(column) + pad * 2));
  const top = settle(start, BOTTOM, ch);
  const icons = pointIcons(items);
  items.forEach((_, index) => {
    const x = MX + index * (cw + gap);
    glass(ctx, { x, y: top, width: cw, height: ch });
    stack(ctx, pieces(ctx, group.pieces[index]!, ["number", "card-title", "card-text"], [tint(ctx, index, colors.accent), colors.ink, colors.inkSoft], [fonts.display, fonts.strong, fonts.body]), { x: x + pad, y: top + pad, width: cw - pad * 2 });
    numberedIcon(ctx, group.pieces[index]![0]!, fonts.display, { x, y: top, width: cw }, pad, 36, icons[index]!, index);
  });
  footer(ctx);
  return { light: "bottom" };
}

function bullets(ctx: Ctx, slide: SlideContent): Built {
  const { colors, fonts } = ctx.dna;
  const items = slide.points.slice(0, 5);
  const n = items.length;
  const s = sizes(ctx);
  const specs = (item: { title: string; text: string }): Spec[] => [
    { text: item.title, font: fonts.strong, size: s.cardTitle * 0.9, min: 12, leading: 1.25, maxLines: 2 },
    { text: item.text, font: fonts.body, size: s.cardText * 0.95, min: 11, leading: 1.42, gap: 5 },
  ];

  if (ctx.variant % 2 === 1) {
    const start = topBlock(ctx, slide, 760) + 26;
    const columns = n > 3 ? 2 : 1;
    const per = Math.ceil(n / columns);
    const gap = 14;
    const cw = (SPAN - gap * (columns - 1)) / columns;
    const inner = cw - 66;
    const group = fitGroup(items.map(specs), inner, (BOTTOM - start - gap * (per - 1)) / per - 32);
    const ch = Math.max(70, ...group.pieces.map((column) => columnHeight(column) + 32));
    const top = settle(start, BOTTOM, ch * per + gap * (per - 1));
    const bulletIcons = pointIcons(items);
    items.forEach((_, index) => {
      const column = Math.floor(index / per);
      const x = MX + column * (cw + gap);
      const y = top + (index % per) * (ch + gap);
      glass(ctx, { x, y, width: cw, height: ch });
      icon(ctx, { x: x + 25, y: y + 16 + group.pieces[index]![0]!.lineHeight / 2 }, spectral(ctx) ? 26 : 22, bulletIcons[index]!, index);
      stack(ctx, pieces(ctx, group.pieces[index]!, ["card-title", "card-text"], [colors.ink, colors.inkSoft], [fonts.strong, fonts.body]), { x: x + 44, y: y + 16, width: inner });
    });
    footer(ctx);
    return { light: "bottom" };
  }

  sideColumn(ctx, slide, 318);
  const panel = { x: 416, y: 52, width: RIGHT - 416, height: 456 };
  const pad = 26;
  const inner = panel.width - pad * 2 - 42;
  const group = fitGroup(items.map(specs), inner, (panel.height - pad * 2) / n - 22);
  const rh = Math.max(...group.pieces.map((column) => columnHeight(column) + 22));
  const height = rh * n + pad * 2;
  const top = settle(panel.y, panel.y + panel.height, height);
  glass(ctx, { ...panel, y: top, height });
  const rowIcons = pointIcons(items);
  items.forEach((_, index) => {
    const ry = top + pad + index * rh;
    if (index > 0) rule(ctx, { x: panel.x + pad, y: ry }, panel.width - pad * 2, alpha(colors.ink, 0.12));
    icon(ctx, { x: panel.x + pad + 13, y: ry + 11 + group.pieces[index]![0]!.lineHeight / 2 }, spectral(ctx) ? 28 : 24, rowIcons[index]!, index);
    stack(ctx, pieces(ctx, group.pieces[index]!, ["card-title", "card-text"], [colors.ink, colors.inkSoft], [fonts.strong, fonts.body]), { x: panel.x + pad + 42, y: ry + 11, width: inner });
  });
  footer(ctx);
  return { light: "right" };
}

/** The one size at which every figure of a row stands whole on one line. */
function valueSize(values: string[], pick: FontPick, width: number, max: number, min: number): number {
  return Math.min(...values.map((value) => fit({ text: value, font: pick, width, height: max * 1.2, max, min, leading: 1.04, maxLines: 1 }).size));
}

function stats(ctx: Ctx, slide: SlideContent): Built {
  const { colors, fonts } = ctx.dna;
  const items = slide.stats.slice(0, 4);
  const s = sizes(ctx);

  if (ctx.variant % 2 === 1 && items.length >= 2) {
    const hero = items[0]!;
    const tile = { x: MX, y: 52, width: 396, height: 456 };
    glass(ctx, tile, { strong: true });
    const inner = tile.width - 60;
    // A figure is sized to stand on one line whole; it is never cut.
    const heroSize = valueSize([hero.value], fonts.display, inner, 112 * ctx.scale, 26);
    const group = fitGroup([[
      { text: hero.value, font: fonts.display, size: heroSize, min: Math.min(heroSize, 26), leading: 1.02, maxLines: 1 },
      { text: hero.label, font: fonts.strong, size: 19 * ctx.scale, min: 13, leading: 1.35, maxLines: 5, gap: 16 },
    ]], inner, tile.height - 120);
    const column = group.pieces[0]!;
    const y = tile.y + (tile.height - columnHeight(column)) / 2 + 10;
    bar(ctx, { x: tile.x + 30, y: y - 28, width: 34, height: 3 }, colors.accent);
    stack(ctx, pieces(ctx, column, ["statistic", "statistic-label"], [tint(ctx, 0, colors.accent), colors.ink], [fonts.display, fonts.strong]), { x: tile.x + 30, y, width: inner });

    const x0 = tile.x + tile.width + 30;
    const width = RIGHT - x0;
    let top = header(ctx, slide, { x: x0, y: 52, width, max: Math.min(s.title, 34), lines: 3 });
    const lead = leadFit(ctx, slide.lead, width, 90, 15 * ctx.scale);
    if (lead) top = text(ctx, { x: x0, y: top + 12, width }, lead, fonts.body, colors.inkSoft, "lead");
    const rest = items.slice(1);
    const gap = 14;
    const tw = (width - gap * (rest.length - 1)) / rest.length;
    const start = top + 22;
    const restSize = valueSize(rest.map((item) => item.value), fonts.display, tw - 36, 42 * ctx.scale, 16);
    const restGroup = fitGroup(rest.map((item) => [
      { text: item.value, font: fonts.display, size: restSize, min: Math.min(restSize, 16), leading: 1.04, maxLines: 1 },
      { text: item.label, font: fonts.body, size: 14 * ctx.scale, min: 10.5, leading: 1.38, gap: 8 },
    ]), tw - 36, BOTTOM + 8 - start - 36);
    const th = Math.max(110, ...restGroup.pieces.map((one) => columnHeight(one) + 36));
    const ty = BOTTOM + 8 - th;
    rest.forEach((_, index) => {
      const x = x0 + index * (tw + gap);
      glass(ctx, { x, y: ty, width: tw, height: th });
      stack(ctx, pieces(ctx, restGroup.pieces[index]!, ["statistic", "statistic-label"], [tint(ctx, index + 1, colors.accent2), colors.inkSoft], [fonts.display, fonts.body]), { x: x + 18, y: ty + 18, width: tw - 36 });
    });
    footer(ctx);
    return { light: "left" };
  }

  const start = topBlock(ctx, slide, 700) + 28;
  const gap = 18;
  const n = items.length;
  const tw = (SPAN - gap * (n - 1)) / n;
  const statSize = valueSize(items.map((item) => item.value), fonts.display, tw - 52, n >= 4 ? 54 : s.stat, 18);
  const group = fitGroup(items.map((item) => [
    { text: item.value, font: fonts.display, size: statSize, min: Math.min(statSize, 18), leading: 1.04, maxLines: 1 },
    { text: item.label, font: fonts.body, size: s.statLabel, min: 11, leading: 1.4, gap: 12 },
  ]), tw - 52, BOTTOM - start - 76);
  const th = Math.max(170, ...group.pieces.map((one) => columnHeight(one) + 76));
  const top = settle(start, BOTTOM, th);
  const statIcons = spectral(ctx) ? pointIcons(items.map((item) => ({ title: item.label, text: "" }))) : [];
  items.forEach((_, index) => {
    const x = MX + index * (tw + gap);
    glass(ctx, { x, y: top, width: tw, height: th });
    const accent = tint(ctx, index, index % 2 ? colors.accent2 : colors.accent);
    // The infographic marks each figure with its icon in its colour; the others a short rule.
    if (spectral(ctx)) icon(ctx, { x: x + 26 + 15, y: top + 28 }, 30, statIcons[index]!, index);
    else bar(ctx, { x: x + 26, y: top + 28, width: 30, height: 3 }, accent);
    stack(ctx, pieces(ctx, group.pieces[index]!, ["statistic", "statistic-label"], [accent, colors.inkSoft], [fonts.display, fonts.body]), { x: x + 26, y: top + 48, width: tw - 52 });
  });
  footer(ctx);
  return { light: "bottom" };
}

function timeline(ctx: Ctx, slide: SlideContent): Built {
  const { colors, fonts } = ctx.dna;
  const items = slide.points.slice(0, 5);
  const n = items.length;
  const start = topBlock(ctx, slide, 760);
  const column = SPAN / n;
  const yearGroup = fitGroup(items.map((item, index) => [
    { text: item.title || num(index), font: fonts.display, size: 32 * ctx.scale, min: 14, leading: 1.08, maxLines: 1 },
  ]), column - 18, 44);
  const yearHeight = Math.max(...yearGroup.pieces.map((one) => columnHeight(one)));
  const cardGroup = fitGroup(items.map((item) => [
    { text: item.text, font: fonts.body, size: 16 * ctx.scale, min: 10.5, leading: 1.42 },
  ]), column - 46, 190);
  const ch = Math.max(84, ...cardGroup.pieces.map((one) => columnHeight(one) + 34));
  const block = yearHeight + 22 + 30 + ch;
  const top = settle(start + 30, BOTTOM, block);
  const axis = top + yearHeight + 22;
  rule(ctx, { x: MX, y: axis }, SPAN, alpha(colors.accent, 0.5), 2);
  items.forEach((_, index) => {
    const cx = MX + column * (index + 0.5);
    const accent = tint(ctx, index, colors.accent);
    stack(ctx, pieces(ctx, yearGroup.pieces[index]!, ["year"], [accent], [fonts.display], "center"), { x: cx - (column - 18) / 2, y: top, width: column - 18 });
    ctx.rows.push(row("shape", { x: cx - 15, y: axis - 15, width: 30, height: 30 }, { shape: "ellipse", fill: alpha(accent, 0.2) }, { kind: "accent" }));
    dot(ctx, { x: cx, y: axis }, 12, accent);
    const card = { x: MX + column * index + 7, y: axis + 30, width: column - 14, height: ch };
    glass(ctx, card);
    stack(ctx, pieces(ctx, cardGroup.pieces[index]!, ["card-text"], [colors.ink], [fonts.body], "center"), { x: card.x + 16, y: card.y + 17, width: card.width - 32 });
  });
  footer(ctx);
  return { light: ctx.variant % 2 ? "corners" : "bottom" };
}

function process(ctx: Ctx, slide: SlideContent): Built {
  const { colors, fonts } = ctx.dna;
  const items = slide.points.slice(0, 5);
  const n = items.length;
  const s = sizes(ctx);
  const specs = (item: { title: string; text: string }): Spec[] => [
    { text: item.title, font: fonts.strong, size: s.cardTitle * 0.9, min: 12, leading: 1.25, maxLines: 2 },
    { text: item.text, font: fonts.body, size: s.cardText * 0.95, min: 10.5, leading: 1.42, gap: 6 },
  ];

  if (ctx.variant % 2 === 1) {
    sideColumn(ctx, slide, 312);
    const x0 = 410;
    const gap = 14;
    const inner = RIGHT - x0 - 54 - 40;
    const group = fitGroup(items.map(specs), inner, (456 - gap * (n - 1)) / n - 26);
    const rh = Math.max(64, ...group.pieces.map((one) => columnHeight(one) + 26));
    const top = settle(52, 508, rh * n + gap * (n - 1));
    const spine = x0 + 20;
    ctx.rows.push(row("shape", { x: spine - 1, y: top + rh / 2, width: 2, height: Math.max(1, (n - 1) * (rh + gap)) }, { fill: alpha(colors.accent, 0.45) }, { kind: "accent" }));
    items.forEach((_, index) => {
      const ry = top + index * (rh + gap);
      badge(ctx, { x: spine, y: ry + rh / 2 }, 40, String(index + 1));
      const box = { x: x0 + 54, y: ry, width: RIGHT - x0 - 54, height: rh };
      glass(ctx, box);
      const column = group.pieces[index]!;
      stack(ctx, pieces(ctx, column, ["card-title", "card-text"], [colors.ink, colors.inkSoft], [fonts.strong, fonts.body]), { x: box.x + 20, y: ry + (rh - columnHeight(column)) / 2, width: inner });
    });
    footer(ctx);
    return { light: "right" };
  }

  const start = topBlock(ctx, slide, 760) + 48;
  const gap = 26;
  const cw = (SPAN - gap * (n - 1)) / n;
  const group = fitGroup(items.map(specs), cw - 36, BOTTOM - start - 56);
  const ch = Math.max(150, ...group.pieces.map((one) => columnHeight(one) + 56));
  const top = settle(start, BOTTOM, ch);
  items.forEach((_, index) => {
    const x = MX + index * (cw + gap);
    glass(ctx, { x, y: top, width: cw, height: ch });
    if (index < n - 1) rule(ctx, { x: x + cw + 4, y: top }, gap - 8, alpha(colors.accent, 0.7), 2);
    badge(ctx, { x: x + cw / 2, y: top }, 42, String(index + 1));
    stack(ctx, pieces(ctx, group.pieces[index]!, ["card-title", "card-text"], [colors.ink, colors.inkSoft], [fonts.strong, fonts.body], "center"), { x: x + 18, y: top + 36, width: cw - 36 });
  });
  footer(ctx);
  return { light: "bottom" };
}

function comparison(ctx: Ctx, slide: SlideContent): Built {
  const { colors, fonts } = ctx.dna;
  const start = topBlock(ctx, slide, 760) + 26;
  const pw = (SPAN - 48) / 2;
  const sides = [slide.left!, slide.right!];
  const inner = pw - 76;
  const headGroup = fitGroup(sides.map((side) => [
    { text: side.heading, font: fonts.strong, size: 22 * ctx.scale, min: 14, leading: 1.2, maxLines: 2 },
  ]), pw - 56, 60);
  const pointCount = Math.max(...sides.map((side) => side.points.length));
  const pointGroup = fitGroup(sides.flatMap((side) => side.points.slice(0, 4).map((point) => [
    { text: point, font: fonts.body, size: 17 * ctx.scale, min: 11, leading: 1.4 },
  ])), inner, (BOTTOM - start - 110) / Math.max(1, pointCount) - 12);
  let cursor = 0;
  const bodies = sides.map((side) => {
    const own = pointGroup.pieces.slice(cursor, cursor + Math.min(4, side.points.length));
    cursor += own.length;
    return own;
  });
  const heads = headGroup.pieces.map((one) => columnHeight(one));
  const bodyHeight = (list: Placed[][]) => list.reduce((sum, one) => sum + columnHeight(one) + 12, 0);
  const ph = Math.max(200, ...sides.map((_, index) => 26 + heads[index]! + 30 + bodyHeight(bodies[index]!) + 14));
  const top = settle(start, BOTTOM, ph);
  sides.forEach((_, index) => {
    const x = MX + index * (pw + 48);
    glass(ctx, { x, y: top, width: pw, height: ph });
    const accent = tint(ctx, index, index ? colors.accent2 : colors.accent);
    let py = stack(ctx, pieces(ctx, headGroup.pieces[index]!, ["card-title"], [colors.ink], [fonts.strong]), { x: x + 28, y: top + 26, width: pw - 56 });
    bar(ctx, { x: x + 28, y: py + 11, width: 36, height: 3 }, accent);
    py += 30;
    for (const point of bodies[index]!) {
      dot(ctx, { x: x + 32, y: py + point[0]!.lineHeight / 2 }, 8, accent);
      py = stack(ctx, pieces(ctx, point, ["card-text"], [colors.ink], [fonts.body]), { x: x + 48, y: py, width: inner }) + 12;
    }
  });
  badge(ctx, { x: W / 2, y: top + ph / 2 }, 52, "VS", 2);
  footer(ctx);
  return { light: "center" };
}

/**
 * The editorial quote: a column of the deck's colour down the left with the
 * quotation mark set large in it, and the words on the paper beside it.
 */
function quotePaper(ctx: Ctx, slide: SlideContent): Built {
  const { colors, fonts } = ctx.dna;
  const body = slide.quote!;
  const band = { x: 0, y: 0, width: 300, height: H };
  ctx.rows.push(row("shape", band, { fill: colors.block, borderRadius: 0 }, { kind: "block" }));
  const mark: FontPick = serifLike(fonts.display) ? { ...fonts.display, tracking: 0 } : { family: "DM Serif Display", weight: 400, em: 0.446, tracking: 0 };
  text(ctx, { x: 40, y: H / 2 - 110, width: 220 }, { text: "“", size: 220, lineHeight: 200, lines: 1, height: 200 }, mark, colors.onBlock, "quote-mark", { align: "center" });

  const x = 348;
  const width = RIGHT - x;
  const eyebrowFit = fit({ text: slide.title, font: fonts.label, width: width - 30, height: 16, max: 10.5, min: 8.5, leading: 1.3, upper: true, maxLines: 1 });
  bar(ctx, { x, y: 55, width: 8, height: 8 }, colors.accent);
  text(ctx, { x: x + 30, y: 52, width: width - 30 }, eyebrowFit, fonts.label, colors.accent, "eyebrow", { upper: true });
  const group = fitGroup([[
    { text: body.text, font: fonts.display, size: 36 * ctx.scale, min: 18, leading: 1.24, maxLines: 8 },
    { text: body.author, font: fonts.label, size: 11, min: 9, leading: 1.3, maxLines: 1, upper: true, gap: 36 },
  ]], width, 360);
  const column = group.pieces[0]!;
  const top = settle(100, 490, columnHeight(column));
  const after = text(ctx, { x, y: top, width }, column[0]!, fonts.display, colors.ink, "quote");
  if (column[1]?.text) {
    bar(ctx, { x, y: after + 17, width: 28, height: 2 }, colors.accent);
    text(ctx, { x, y: after + column[1].gap, width }, column[1], fonts.label, colors.accent, "attribution", { upper: true });
  }
  footer(ctx, x);
  return { light: "right" };
}

function quote(ctx: Ctx, slide: SlideContent): Built {
  if (paper(ctx)) return quotePaper(ctx, slide);
  if (vivid(ctx) || geometric(ctx)) return heroQuote(ctx, slide);
  const { colors, fonts } = ctx.dna;
  const body = slide.quote!;
  const eyebrowFit = fit({ text: slide.title, font: fonts.label, width: 700, height: 16, max: 10.5, min: 8.5, leading: 1.3, upper: true, maxLines: 1 });
  text(ctx, { x: 150, y: 52, width: 700 }, eyebrowFit, fonts.label, colors.accent, "eyebrow", { upper: true, align: "center" });
  const group = fitGroup([[
    { text: body.text, font: fonts.display, size: 38 * ctx.scale, min: 18, leading: 1.26, maxLines: 7 },
    { text: body.author, font: fonts.label, size: 11, min: 9, leading: 1.3, maxLines: 1, upper: true, gap: 40 },
  ]], 780, 300);
  const column = group.pieces[0]!;
  const top = Math.max(settle(180, 498, columnHeight(column)), 178);
  // A sans face's quotation mark is two straight strokes; the mark is drawn
  // from a serif whatever the deck is set in.
  const mark: FontPick = serifLike(fonts.display) ? { ...fonts.display, tracking: 0 } : { family: "DM Serif Display", weight: 400, em: 0.446, tracking: 0 };
  text(ctx, { x: W / 2 - 60, y: top - 104, width: 120 }, { text: "“", size: 110, lineHeight: 100, lines: 1, height: 100 }, mark, alpha(colors.accent, 0.85), "quote-mark", { align: "center" });
  const after = text(ctx, { x: 110, y: top, width: 780 }, column[0]!, fonts.display, colors.ink, "quote", { align: "center" });
  if (column[1]?.text) {
    bar(ctx, { x: W / 2 - 18, y: after + 18, width: 36, height: 2.4 }, colors.accent);
    text(ctx, { x: 200, y: after + column[1].gap, width: 600 }, column[1], fonts.label, colors.accent, "attribution", { upper: true, align: "center" });
  }
  footer(ctx);
  return { light: "corners" };
}

/** A number as Uzbek writes it: a decimal comma, not a point. */
export function uzNumber(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

function chart(ctx: Ctx, slide: SlideContent): Built {
  const { colors, fonts } = ctx.dna;
  const data = slide.chart!;
  const flip = ctx.variant % 2 === 1;
  const y = header(ctx, slide, { width: 820 });
  const top = Math.min(220, y + 26);
  const panel = flip ? { x: 396, y: top, width: RIGHT - 396, height: BOTTOM - top } : { x: MX, y: top, width: 540, height: BOTTOM - top };
  const side = flip ? { x: MX, width: 300 } : { x: 632, width: RIGHT - 632 };
  glass(ctx, panel, { strong: true });

  const total = data.values.reduce((sum, value) => sum + value, 0);
  const parts = /%/.test(data.unit) && Math.abs(total - 100) <= 4 && data.values.length <= 5;
  const series = [...colors.chart];
  const unit = data.unit.trim();
  // Said in full beside the chart; the short label stays under its bar.
  const name = (index: number) => data.names?.[index] ?? data.labels[index] ?? "";
  if (parts) {
    const size = Math.min(panel.height - 60, 240);
    ctx.rows.push(row("chart", { x: panel.x + 30, y: panel.y + (panel.height - size) / 2, width: size, height: size }, {
      series, color: colors.accent, trackColor: alpha(colors.ink, 0.1), strokeWidth: round(size * 0.2),
      labelColor: colors.inkSoft, labelSize: 11, showLabels: false, showValues: false,
    }, { chartType: "donut", labels: data.labels, values: data.values, unit: data.unit }));
    const lx = panel.x + 30 + size + 28;
    const lw = panel.x + panel.width - 22 - lx;
    const group = fitGroup(data.labels.map((label, index) => [
      { text: `${name(index) || label} — ${deckNumber(data.values[index]!, ctx.language)}%`, font: fonts.body, size: 14 * ctx.scale, min: 10, leading: 1.3, maxLines: 2 },
    ]), lw - 22, (panel.height - 60) / data.labels.length - 10);
    const step = Math.max(...group.pieces.map((one) => columnHeight(one))) + 12;
    let ly = panel.y + (panel.height - step * data.labels.length) / 2;
    data.labels.forEach((_, index) => {
      const column = group.pieces[index]!;
      dot(ctx, { x: lx + 6, y: ly + column[0]!.lineHeight / 2 }, 11, series[index % series.length]!);
      stack(ctx, pieces(ctx, column, ["legend"], [colors.ink], [fonts.body]), { x: lx + 22, y: ly, width: lw - 22 });
      ly += step;
    });
  } else {
    ctx.rows.push(row("chart", { x: panel.x + 28, y: panel.y + 30, width: panel.width - 56, height: panel.height - 54 }, {
      series, color: colors.accent, trackColor: alpha(colors.ink, 0.1),
      labelColor: colors.inkSoft, labelSize: 11, showLabels: true, showValues: true, cornerRadius: 8,
      gap: round((panel.width - 56) / (data.values.length * 3.2)),
    }, { chartType: "bar", labels: data.labels, values: data.values, unit: data.unit }));
  }

  const maxIndex = data.values.indexOf(Math.max(...data.values));
  const group = fitGroup([[
    { text: `${deckNumber(data.values[maxIndex]!, ctx.language)}${unit === "%" ? "%" : ""}`, font: fonts.display, size: 66 * ctx.scale, min: 28, leading: 1.04, maxLines: 1 },
    { text: unit && unit !== "%" ? `${name(maxIndex)} · ${unit}` : name(maxIndex), font: fonts.strong, size: 15 * ctx.scale, min: 11, leading: 1.3, maxLines: 2, gap: 6 },
    { text: data.insight || slide.lead, font: fonts.body, size: 15.5 * ctx.scale, min: 11, leading: 1.45, gap: 34 },
    { text: data.insight ? slide.lead : "", font: fonts.body, size: 13 * ctx.scale, min: 10, leading: 1.4, gap: 14 },
  ]], side.width, BOTTOM - top - 4);
  const column = group.pieces[0]!;
  const after = stack(ctx, pieces(ctx, column.slice(0, 2), ["statistic", "statistic-label"], [colors.accent, colors.ink], [fonts.display, fonts.strong]), { x: side.x, y: top + 4, width: side.width });
  bar(ctx, { x: side.x, y: after + 15, width: 30, height: 2.4 }, colors.accent2);
  stack(ctx, pieces(ctx, [{ ...column[2]!, gap: 0 }, column[3]!], ["insight", "lead"], [colors.ink, colors.inkSoft], [fonts.body, fonts.body]), { x: side.x, y: after + column[2]!.gap, width: side.width });
  footer(ctx);
  return { light: flip ? "right" : "left" };
}

function statement(ctx: Ctx, slide: SlideContent): Built {
  if (vivid(ctx) || geometric(ctx)) return heroStatement(ctx, slide);
  const { colors, fonts } = ctx.dna;
  const centered = ctx.variant % 2 === 1;
  const align: Align = centered ? "center" : "left";
  const width = 800;
  const x = centered ? (W - width) / 2 : MX;
  const eyebrowFit = fit({ text: slide.eyebrow || L(ctx).keyPoint, font: fonts.label, width, height: 16, max: 10.5, min: 8.5, leading: 1.3, upper: true, maxLines: 1 });
  if (!centered) bar(ctx, { x, y: 57.6, width: 20, height: 2.4 }, colors.accent);
  text(ctx, { x: centered ? x : x + 30, y: 52, width: centered ? width : width - 30 }, eyebrowFit, fonts.label, colors.accent, "eyebrow", { upper: true, align });
  const titleBottom = text(ctx, { x, y: 76, width }, fit({ text: slide.title, font: fonts.strong, width, height: 52, max: 20 * ctx.scale, min: 14, leading: 1.25, maxLines: 2 }), fonts.strong, colors.inkSoft, "title", { align });

  const chips = slide.points.slice(0, 2);
  const chipTop = chips.length ? 412 : BOTTOM;
  const room = chipTop - 28 - (titleBottom + 28);
  const big = fit({ text: slide.lead || slide.title, font: fonts.display, width, height: room, max: 50 * ctx.scale, min: 20, leading: 1.16, maxLines: 7 });
  text(ctx, { x, y: settle(titleBottom + 28, chipTop - 28, big.height), width }, big, fonts.display, colors.ink, "statement", { align });

  if (chips.length) {
    const gap = 18;
    const cw = (SPAN - gap * (chips.length - 1)) / chips.length;
    const group = fitGroup(chips.map((point) => [
      { text: [point.title, point.text].filter(Boolean).join(" — "), font: fonts.body, size: sizes(ctx).chip, min: 10.5, leading: 1.4, maxLines: 3 },
    ]), cw - 66, 60);
    const ch = Math.max(64, ...group.pieces.map((one) => columnHeight(one) + 28));
    chips.forEach((_, index) => {
      const cx = MX + index * (cw + gap);
      const box = { x: cx, y: BOTTOM + 4 - ch, width: cw, height: ch };
      glass(ctx, box);
      dot(ctx, { x: cx + 26, y: box.y + ch / 2 }, 10, index ? colors.accent2 : colors.accent);
      const column = group.pieces[index]!;
      stack(ctx, pieces(ctx, column, ["card-text"], [colors.ink], [fonts.body]), { x: cx + 46, y: box.y + (ch - columnHeight(column)) / 2, width: cw - 66 });
    });
  }
  footer(ctx);
  return { light: centered ? "corners" : "right" };
}

function photo(ctx: Ctx, slide: SlideContent, source: Picture): Built {
  const { colors, fonts } = ctx.dna;
  const flip = ctx.variant % 2 === 1;
  const frame = flip ? { x: W - 52 - 410, y: 52, width: 410, height: 458 } : { x: 52, y: 52, width: 410, height: 458 };
  picture(ctx, frame, source, ctx.dna.radius + 6);

  const x = flip ? MX : 506;
  const width = flip ? frame.x - 40 - MX : RIGHT - 506;
  let y = header(ctx, slide, { x, y: 52, width, max: Math.min(sizes(ctx).title, 34), lines: 3 });
  const lead = leadFit(ctx, slide.lead, width, 70, 15 * ctx.scale);
  if (lead) y = text(ctx, { x, y: y + 12, width }, lead, fonts.body, colors.inkSoft, "lead");
  const items = slide.points.slice(0, 3);
  const start = y + 24;
  const group = fitGroup(items.map((item) => [
    { text: item.title, font: fonts.strong, size: 18 * ctx.scale, min: 12, leading: 1.25, maxLines: 2 },
    { text: item.text, font: fonts.body, size: 15.5 * ctx.scale, min: 10.5, leading: 1.4, gap: 4 },
  ]), width - 48, (BOTTOM - start) / Math.max(1, items.length) - 20);
  const slot = Math.max(...group.pieces.map((one) => columnHeight(one))) + 20;
  items.forEach((_, index) => {
    const py = start + index * slot;
    if (index > 0) rule(ctx, { x, y: py - 10 }, width, alpha(colors.ink, 0.12));
    text(ctx, { x, y: py, width: 40 }, { text: num(index), size: 20, lineHeight: 22, lines: 1, height: 22 }, { ...fonts.display, tracking: 0 }, colors.accent, "number");
    stack(ctx, pieces(ctx, group.pieces[index]!, ["card-title", "card-text"], [colors.ink, colors.inkSoft], [fonts.strong, fonts.body]), { x: x + 48, y: py + 1, width: width - 48 });
  });
  footer(ctx);
  return { light: flip ? "right" : "left" };
}

/* ------------------------------------------------------- the fixed pages */

/**
 * The editorial cover.
 *
 * With a photograph: the photograph to the page edge on the right, a strip of
 * the deck's colour down its inner edge, the words on the paper beside it.
 * Without one: a field of the deck's colour across most of the page with the
 * title set on it, and the year large on the paper.
 */
function coverPaper(ctx: Ctx, input: DeckText, source: Picture | null): Built {
  const { colors, fonts } = ctx.dna;
  const credits = [
    input.author ? { label: L(ctx).author, value: input.author } : null,
    input.teacher ? { label: L(ctx).teacher, value: input.teacher } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  const words = (at: { x: number; width: number; ink: string; soft: string; mark: string }) => {
    const creditHeight = credits.length ? 44 : 0;
    const bottom = H - 56;
    const top = 72;
    const group = fitGroup([[
      { text: input.topic, font: fonts.display, size: 58 * ctx.scale, min: 26, leading: 1.04, maxLines: 6 },
      { text: input.subtitle, font: fonts.body, size: 16.5 * ctx.scale, min: 12, leading: 1.45, maxLines: 3, gap: 22 },
    ]], at.width, bottom - creditHeight - 36 - (top + 34));
    bar(ctx, { x: at.x, y: top + 3, width: 8, height: 8 }, at.mark);
    text(ctx, { x: at.x + 22, y: top, width: at.width - 22 }, fit({ text: `${L(ctx).deck} · ${input.year}`, font: fonts.label, width: at.width - 22, height: 14, max: 10.5, min: 9, leading: 1.3, upper: true, maxLines: 1 }), fonts.label, at.mark, "eyebrow", { upper: true });
    stack(ctx, [
      { placed: group.pieces[0]![0]!, pick: fonts.display, color: at.ink, role: "title" },
      { placed: group.pieces[0]![1]!, pick: fonts.body, color: at.soft, role: "subtitle" },
    ], { x: at.x, y: top + 34, width: at.width });
    if (credits.length) {
      const y = bottom - creditHeight;
      rule(ctx, { x: at.x, y: y - 14 }, at.width, alpha(at.ink, 0.3));
      const cw = at.width / credits.length;
      credits.forEach((credit, index) => {
        const cx = at.x + index * cw;
        const after = text(ctx, { x: cx, y, width: cw - 12 }, fit({ text: credit.label, font: fonts.label, width: cw - 12, height: 12, max: 8.5, min: 7.5, leading: 1.3, upper: true, maxLines: 1 }), fonts.label, at.soft, "credit-label", { upper: true });
        text(ctx, { x: cx, y: after + 5, width: cw - 12 }, fit({ text: credit.value, font: fonts.strong, width: cw - 12, height: 20, max: 14, min: 10.5, leading: 1.3, maxLines: 1 }), fonts.strong, at.ink, "credit");
      });
    }
  };

  if (source) {
    const edge = 548;
    ctx.rows.push(row("image", { x: edge, y: 0, width: W - edge, height: H }, { objectFit: "cover", borderRadius: 0 }, imageContent(source)));
    ctx.rows.push(row("shape", { x: edge - 8, y: 0, width: 8, height: H }, { fill: colors.block, borderRadius: 0 }, { kind: "accent" }));
    words({ x: MX, width: edge - 8 - 44 - MX, ink: colors.ink, soft: colors.inkSoft, mark: colors.accent });
    return { light: "left", hero: true };
  }

  const field = { x: 0, y: 0, width: 620, height: H };
  ctx.rows.push(row("shape", field, { fill: colors.block, borderRadius: 0 }, { kind: "block" }));
  words({ x: MX, width: field.width - MX - 56, ink: colors.onBlock, soft: alpha(colors.onBlock, 0.84), mark: colors.onBlock });
  const yearFit = fit({ text: String(input.year), font: { ...fonts.display, tracking: 0 }, width: RIGHT - 660, height: 110, max: 96, min: 40, leading: 1.02, maxLines: 1 });
  text(ctx, { x: 660, y: H - 64 - yearFit.height, width: RIGHT - 660 }, yearFit, { ...fonts.display, tracking: 0 }, colors.accent, "year", { align: "right" });
  return { light: "right", hero: true };
}

/**
 * The corporate cover: the photograph to the left edge with its right side
 * rounded, the title on the white beside it in two tones; without a
 * photograph, a large rounded form of the brand holds the year.
 */
function coverCorporate(ctx: Ctx, input: DeckText, source: Picture | null): Built {
  const { colors, fonts } = ctx.dna;
  const left = { x: -48, y: 40, width: 508, height: H - 80 };
  if (source) {
    ctx.rows.push(...dropRows(ctx.dna, left, 44, 16));
    ctx.rows.push(row("image", left, { objectFit: "cover", borderRadius: 44 }, imageContent(source)));
  } else {
    ctx.rows.push(row("shape", left, { ...brandFill(ctx.dna), borderRadius: 44 }, { kind: "block" }));
    const year = fit({ text: String(input.year), font: { ...fonts.display, tracking: 0 }, width: 300, height: 120, max: 104, min: 40, leading: 1, maxLines: 1 });
    text(ctx, { x: 64, y: H - 64 - year.height, width: 330 }, year, { ...fonts.display, tracking: 0 }, alpha("#FFFFFF", 0.92), "year");
  }
  const x = 512;
  const width = RIGHT - x;
  const credits = [
    input.author ? { label: L(ctx).author, value: input.author } : null,
    input.teacher ? { label: L(ctx).teacher, value: input.teacher } : null,
  ].filter(Boolean) as { label: string; value: string }[];
  const group = fitGroup([[
    { text: input.topic, font: fonts.display, size: 52 * ctx.scale, min: 24, leading: 1.06, maxLines: 6 },
    { text: input.subtitle, font: fonts.body, size: 16 * ctx.scale, min: 11.5, leading: 1.45, maxLines: 3, gap: 18 },
  ]], width, 330);
  const column = group.pieces[0]!;
  const block = 30 + columnHeight(column) + (credits.length ? 74 : 0);
  let y = Math.max(70, (H - block) / 2);
  bar(ctx, { x, y: y + 5.6, width: 20, height: 2.4 }, colors.accent);
  text(ctx, { x: x + 30, y, width: width - 30 }, fit({ text: `${L(ctx).deck} · ${input.year}`, font: fonts.label, width: width - 30, height: 14, max: 10.5, min: 9, leading: 1.3, upper: true, maxLines: 1 }), fonts.label, colors.accent, "eyebrow", { upper: true });
  y = twoTone(ctx, { x, y: y + 30, width }, column[0]!, fonts.display, "title");
  if (column[1]?.text) y = text(ctx, { x, y: y + column[1].gap, width }, column[1], fonts.body, colors.inkSoft, "subtitle");
  if (credits.length) {
    const card = { x, y: y + 26, width: Math.min(width, credits.length * 190), height: 58 };
    if (card.y + card.height <= H - 30) {
      floating(ctx, card, { radius: 16 });
      const cw = (card.width - 36) / credits.length;
      credits.forEach((credit, index) => {
        const cx = card.x + 18 + index * cw;
        const top = text(ctx, { x: cx, y: card.y + 12, width: cw - 10 }, fit({ text: credit.label, font: fonts.label, width: cw - 10, height: 12, max: 8.5, min: 7.5, leading: 1.3, upper: true, maxLines: 1 }), fonts.label, colors.accent, "credit-label", { upper: true });
        text(ctx, { x: cx, y: top + 4, width: cw - 10 }, fit({ text: credit.value, font: fonts.strong, width: cw - 10, height: 20, max: 14, min: 10.5, leading: 1.3, maxLines: 1 }), fonts.strong, colors.ink, "credit");
      });
    }
  }
  return { light: "right", hero: true };
}

/**
 * The naqsh cover: a panel of bodom down the left of the page; the
 * photograph in a bodom-leaf frame standing across the panel's edge, or, without
 * one, a white medallion with the star and the year; the title on the white.
 */
function coverNaqsh(ctx: Ctx, input: DeckText, source: Picture | null): Built {
  const { colors, fonts } = ctx.dna;
  const family = ctx.dna.ornament ?? "blue";
  ctx.rows.push(ornament(family, "panel", { x: 0, y: 0 }));
  ctx.rows.push(row("shape", { x: 420, y: 0, width: 3, height: H }, { ...familyFill(ctx.dna, 180) }, { kind: "accent" }));
  let x = 540;
  if (source) {
    const frame = { x: 262, y: 96, width: 268, height: 370 };
    picture(ctx, frame, source, 8);
    x = 572;
  } else {
    const disc = { x: 300, y: 151, width: 240, height: 240 };
    ctx.rows.push(...dropRows(ctx.dna, disc, 120, 14));
    ctx.rows.push(row("shape", disc, { shape: "ellipse", fill: "#FFFFFF" }, { kind: "frame" }));
    ctx.rows.push(...starRows({ x: 420, y: 271 }, 176, familyFill(ctx.dna), "block"));
    const year = fit({ text: String(input.year), font: { ...fonts.display, tracking: 0 }, width: 110, height: 40, max: 32, min: 18, leading: 1, maxLines: 1 });
    text(ctx, { x: 365, y: 271 - year.lineHeight / 2, width: 110 }, year, { ...fonts.display, tracking: 0 }, "#FFFFFF", "year", { align: "center" });
    x = 584;
  }
  const width = RIGHT - x;
  const credits = [
    input.author ? { label: L(ctx).author, value: input.author } : null,
    input.teacher ? { label: L(ctx).teacher, value: input.teacher } : null,
  ].filter(Boolean) as { label: string; value: string }[];
  const group = fitGroup([[
    { text: input.topic, font: fonts.display, size: 46 * ctx.scale, min: 22, leading: 1.08, maxLines: 6 },
    { text: input.subtitle, font: fonts.body, size: 15.5 * ctx.scale, min: 11.5, leading: 1.45, maxLines: 3, gap: 16 },
  ]], width, 320);
  const column = group.pieces[0]!;
  const block = 30 + columnHeight(column) + (credits.length ? 70 : 0);
  let y = Math.max(64, (H - block) / 2);
  ctx.rows.push(...starRows({ x: x + 6, y: y + 6.8 }, 11, familyFill(ctx.dna), "accent"));
  text(ctx, { x: x + 20, y, width: width - 20 }, fit({ text: `${L(ctx).deck} · ${input.year}`, font: fonts.label, width: width - 20, height: 14, max: 10.5, min: 9, leading: 1.3, upper: true, maxLines: 1 }), fonts.label, colors.accent, "eyebrow", { upper: true });
  y = text(ctx, { x, y: y + 30, width }, column[0]!, fonts.display, colors.ink, "title");
  if (column[1]?.text) y = text(ctx, { x, y: y + column[1].gap, width }, column[1], fonts.body, colors.inkSoft, "subtitle");
  if (credits.length && y + 70 <= H - 36) {
    rule(ctx, { x, y: y + 24 }, Math.min(width, 280), colors.line);
    const cw = Math.min(width, 360) / credits.length;
    credits.forEach((credit, index) => {
      const cx = x + index * cw;
      const top = text(ctx, { x: cx, y: y + 38, width: cw - 12 }, fit({ text: credit.label, font: fonts.label, width: cw - 12, height: 12, max: 8.5, min: 7.5, leading: 1.3, upper: true, maxLines: 1 }), fonts.label, colors.accent, "credit-label", { upper: true });
      text(ctx, { x: cx, y: top + 4, width: cw - 12 }, fit({ text: credit.value, font: fonts.strong, width: cw - 12, height: 20, max: 14, min: 10.5, leading: 1.3, maxLines: 1 }), fonts.strong, colors.ink, "credit");
    });
  }
  return { light: "right", hero: true };
}

/**
 * The naqsh close: the whole page a tilework wall of girih in the family's
 * gradient, and on it one white card in the bodom's leaf, a star above the
 * thanks set in it.
 */
function closingNaqsh(ctx: Ctx, input: DeckText): Built {
  const { colors, fonts } = ctx.dna;
  ctx.rows.push(ornament(ctx.dna.ornament ?? "blue", "koshin", { x: 0, y: 0 }));
  const card = { x: 236, y: 92, width: 528, height: 378 };
  const leaf = leafCorners(card.width, card.height, 18);
  ctx.rows.push(...dropRows(ctx.dna, card, 18, 18, false, leaf));
  ctx.rows.push(row("shape", card, { fill: "#FFFFFF", borderRadius: 18, borderRadiusCorners: leaf }, { kind: "panel" }));
  const inset = { x: card.x + 12, y: card.y + 12, width: card.width - 24, height: card.height - 24 };
  ctx.rows.push(row("shape", inset, { fill: "#00000000", borderRadius: 10, borderRadiusCorners: leafCorners(inset.width, inset.height, 10), stroke: alpha(colors.accent, 0.35), strokeWidth: 1.2 }, { kind: "frame" }));
  ctx.rows.push(...starRows({ x: W / 2, y: card.y + 62 }, 38, familyFill(ctx.dna), "accent"));
  const width = 360;
  const group = fitGroup([[
    { text: L(ctx).closingEyebrow, font: fonts.label, size: 10.5, min: 9, leading: 1.3, upper: true, maxLines: 1 },
    { text: L(ctx).thanks, font: fonts.display, size: 44 * ctx.scale, min: 24, leading: 1.08, maxLines: 3, gap: 14 },
    { text: input.topic, font: fonts.body, size: 14.5 * ctx.scale, min: 11, leading: 1.4, maxLines: 2, gap: 26 },
    { text: input.author ?? "", font: fonts.label, size: 10.5, min: 9, leading: 1.3, upper: true, maxLines: 1, gap: 12 },
  ]], width, 290);
  const column = group.pieces[0]!;
  let y = settle(card.y + 96, card.y + card.height - 34, columnHeight(column));
  const picks = [fonts.label, fonts.display, fonts.body, fonts.label];
  const tones = [colors.accent, colors.ink, colors.inkSoft, colors.accent];
  const roles = ["eyebrow", "title", "subtitle", "credit"];
  column.forEach((piece, index) => {
    if (!piece.text) return;
    if (index > 0) y += piece.gap;
    y = text(ctx, { x: (W - width) / 2, y, width }, piece, picks[index]!, tones[index]!, roles[index]!, { align: "center", upper: index === 0 || index === 3 });
  });
  return { light: "bottom", hero: true };
}

/* ---------------------------------------------------------------- heroes */

/**
 * A hero page — the cover, a statement, a quotation, the close — in the two
 * styles that have them. Spektr: the hero gradient edge to edge (laid as its
 * backdrop), the words in white in one column on the left where the gradient
 * is deepest, and the subject's icon in white line art standing off the right
 * edge, as large as the words leave room for. Mozaika: a field of the
 * family's colour (the page's ground) with a block of mosaic beside the words
 * — on the right, or on the left of the close — and the cover's photograph
 * set in it as a disc. In both, what is read small is read on white pills.
 */
const WHITE = "#FFFFFF";
/** Spektr's column: as wide as it may be while the largest icon still clears it. */
const HERO_WIDTH = 486;
/** Mozaika's hero mosaic: five rows of cells down the page, this many columns. */
const MOSAIC_CELL = H / 5;
const MOSAIC_COLS = { cover: 4, statement: 2, quote: 2, closing: 3 } as const;

type HeroPage = keyof typeof MOSAIC_COLS;
type Column = { x: number; width: number };

function heroColumn(ctx: Ctx, page: HeroPage): Column {
  if (!geometric(ctx)) return { x: MX, width: HERO_WIDTH };
  const block = MOSAIC_COLS[page] * MOSAIC_CELL;
  if (page === "closing") return { x: block + 62, width: RIGHT - block - 62 };
  return { x: MX, width: W - block - 40 - MX };
}

const heroBuilt = (ctx: Ctx, light: Light): Built => ({ light, hero: true, ...(geometric(ctx) ? { ground: ctx.dna.colors.block } : {}) });

function heroEyebrow(ctx: Ctx, col: Column, value: string, y: number): number {
  const { fonts } = ctx.dna;
  const fitted = fit({ text: value, font: fonts.label, width: col.width - 30, height: 16, max: 10.5, min: 8.5, leading: 1.3, upper: true, maxLines: 1 });
  bar(ctx, { x: col.x, y: y + 5.6, width: 20, height: 2.4 }, WHITE);
  return text(ctx, { x: col.x + 30, y, width: col.width - 30 }, fitted, fonts.label, WHITE, "eyebrow", { upper: true });
}

/** The page number and the deck's name, in white at the foot of the column. */
function heroFooter(ctx: Ctx, col: Column): void {
  const label = { ...ctx.dna.fonts.label, tracking: 1.6 };
  const page = `${num(ctx.index - 1)} / ${String(ctx.total).padStart(2, "0")}`;
  const pageWidth = textWidth(page, 8.5, label) + 4;
  text(ctx, { x: col.x, y: 526, width: pageWidth }, { text: page, size: 8.5, lineHeight: 11, lines: 1, height: 11 }, label, WHITE, "page");
  ctx.rows.push(row("shape", { x: col.x + pageWidth + 7, y: 530, width: 4, height: 4 }, { shape: "ellipse", fill: alpha(WHITE, 0.7) }, { kind: "accent" }));
  const width = Math.min(380, col.width - pageWidth - 20);
  const title = fit({ text: ctx.short, font: label, width, height: 12, max: 8.5, min: 7.5, leading: 1.3, upper: true, maxLines: 1 });
  text(ctx, { x: col.x + pageWidth + 20, y: 526, width }, title, label, alpha(WHITE, 0.88), "footer", { upper: true });
}

/** A white pill on the field, on a soft shadow: what is read small is read on white. */
function heroPill(ctx: Ctx, rect: Rect): void {
  const radius = Math.min(rect.height / 2, 22);
  ctx.rows.push(...dropRows(ctx.dna, rect, radius, 8));
  ctx.rows.push(row("shape", rect, { fill: WHITE, borderRadius: radius }, { kind: "panel" }));
}

/** The giant line icon, if the words leave room for one. */
function heroMark(ctx: Ctx, name: string): void {
  const mark = heroIcon(ctx.rows, name);
  if (mark) ctx.rows.push(mark);
}

/** What stands beside the words: Spektr's icon, or Mozaika's block of mosaic. */
function heroArt(ctx: Ctx, page: HeroPage, name: string, source: Picture | null = null): void {
  if (!geometric(ctx)) return heroMark(ctx, name);
  const cols = MOSAIC_COLS[page];
  const origin = { x: page === "closing" ? 0 : W - cols * MOSAIC_CELL, y: 0 };
  const colors = ctx.dna.tiles?.hero ?? [WHITE];
  const next = random(ctx.dna.seed ^ (ctx.index * 7919));
  const hole = source && page === "cover" ? { col: 1, row: 1, span: 2 } : undefined;
  ctx.rows.push(...mosaic({ origin, cols, rows: 5, cell: MOSAIC_CELL, colors, under: ctx.dna.colors.block, next, fill: 0.62, hole }));
  if (!hole || !source) return;
  // The photograph, as a disc on a square of its own colour, in the mosaic.
  const size = MOSAIC_CELL * hole.span;
  const box = { x: origin.x + hole.col * MOSAIC_CELL, y: origin.y + hole.row * MOSAIC_CELL, width: size, height: size };
  ctx.rows.push(row("shape", box, { fill: colors[Math.floor(next() * colors.length)]! }, { kind: "tile", decor: true }));
  const disc = { x: box.x + 10, y: box.y + 10, width: size - 20, height: size - 20 };
  ctx.rows.push(row("image", disc, { objectFit: "cover", borderRadius: round(disc.width / 2) }, imageContent(source)));
}

function heroCover(ctx: Ctx, input: DeckText, source: Picture | null): Built {
  const { colors, fonts } = ctx.dna;
  const col = heroColumn(ctx, "cover");
  const credits = [
    input.author ? { label: L(ctx).author, value: input.author, icon: "student" } : null,
    input.teacher ? { label: L(ctx).teacher, value: input.teacher, icon: "chalkboard-teacher" } : null,
  ].filter(Boolean) as { label: string; value: string; icon: string }[];
  const group = fitGroup([[
    { text: input.topic, font: fonts.display, size: 58 * ctx.scale, min: 26, leading: 1.04, maxLines: 4 },
    { text: input.subtitle, font: fonts.body, size: 16.5 * ctx.scale, min: 12, leading: 1.45, maxLines: 3, gap: 18 },
  ]], col.width, 330);
  const column = group.pieces[0]!;
  const pillHeight = 62;
  const block = 30 + columnHeight(column) + (credits.length ? 34 + pillHeight : 0);
  let y = Math.max(56, (H - block) / 2 - 6);
  heroEyebrow(ctx, col, `${L(ctx).deck} · ${input.year}`, y);
  y = text(ctx, { x: col.x, y: y + 30, width: col.width }, column[0]!, fonts.display, WHITE, "title");
  if (column[1]?.text) y = text(ctx, { x: col.x, y: y + column[1].gap, width: col.width }, column[1], fonts.body, alpha(WHITE, 0.92), "subtitle");
  const pill = { x: col.x, y: y + 34, width: credits.length === 2 ? Math.min(440, col.width) : 250, height: pillHeight };
  if (credits.length && pill.y + pill.height <= H - 28) {
    heroPill(ctx, pill);
    const cw = (pill.width - 20) / credits.length;
    credits.forEach((credit, index) => {
      const cx = pill.x + 12 + index * cw;
      icon(ctx, { x: cx + 19, y: pill.y + pillHeight / 2 }, 34, credit.icon, index);
      const tw = cw - 54;
      const top = text(ctx, { x: cx + 44, y: pill.y + 14, width: tw }, fit({ text: credit.label, font: fonts.label, width: tw, height: 12, max: 8.5, min: 7.5, leading: 1.3, upper: true, maxLines: 1 }), fonts.label, colors.accent, "credit-label", { upper: true });
      text(ctx, { x: cx + 44, y: top + 4, width: tw }, fit({ text: credit.value, font: fonts.strong, width: tw, height: 20, max: 14, min: 10, leading: 1.3, maxLines: 1 }), fonts.strong, colors.ink, "credit");
    });
  }
  heroArt(ctx, "cover", pickIcon(`${input.topic} ${input.subtitle}`), source);
  return heroBuilt(ctx, "right");
}

function heroStatement(ctx: Ctx, slide: SlideContent): Built {
  const { colors, fonts } = ctx.dna;
  const col = heroColumn(ctx, "statement");
  heroEyebrow(ctx, col, slide.eyebrow || L(ctx).keyPoint, 52);
  const titleBottom = text(ctx, { x: col.x, y: 78, width: col.width }, fit({ text: slide.title, font: fonts.strong, width: col.width, height: 52, max: 19 * ctx.scale, min: 13, leading: 1.25, maxLines: 2 }), fonts.strong, alpha(WHITE, 0.92), "title");
  const chips = slide.points.slice(0, 2);
  const inner = col.width - 76;
  const group = fitGroup(chips.map((point) => [
    { text: [point.title, point.text].filter(Boolean).join(" — "), font: fonts.body, size: 14.5 * ctx.scale, min: 10.5, leading: 1.38, maxLines: 2 },
  ]), inner, 44);
  const gap = 12;
  const ch = chips.length ? Math.max(54, ...group.pieces.map((one) => columnHeight(one) + 24)) : 0;
  const chipTop = chips.length ? BOTTOM + 4 - (ch * chips.length + gap * (chips.length - 1)) : BOTTOM;
  const big = fit({ text: slide.lead || slide.title, font: fonts.display, width: col.width, height: chipTop - 28 - (titleBottom + 26), max: 46 * ctx.scale, min: 20, leading: 1.14, maxLines: 7 });
  text(ctx, { x: col.x, y: settle(titleBottom + 26, chipTop - 28, big.height), width: col.width }, big, fonts.display, WHITE, "statement");
  const icons = pointIcons(chips);
  chips.forEach((_, index) => {
    const box = { x: col.x, y: chipTop + index * (ch + gap), width: col.width, height: ch };
    heroPill(ctx, box);
    icon(ctx, { x: box.x + 30, y: box.y + ch / 2 }, 34, icons[index]!, index);
    const column = group.pieces[index]!;
    stack(ctx, pieces(ctx, column, ["card-text"], [colors.ink], [fonts.body]), { x: box.x + 60, y: box.y + (ch - columnHeight(column)) / 2, width: inner });
  });
  heroFooter(ctx, col);
  heroArt(ctx, "statement", slide.icon ?? pickIcon(`${slide.title} ${slide.eyebrow} ${slide.lead}`));
  return heroBuilt(ctx, "right");
}

function heroQuote(ctx: Ctx, slide: SlideContent): Built {
  const { fonts } = ctx.dna;
  const body = slide.quote!;
  const col = heroColumn(ctx, "quote");
  heroEyebrow(ctx, col, slide.title, 52);
  const group = fitGroup([[
    { text: body.text, font: fonts.display, size: 34 * ctx.scale, min: 17, leading: 1.24, maxLines: 8 },
    { text: body.author, font: fonts.label, size: 11, min: 9, leading: 1.3, maxLines: 1, upper: true, gap: 36 },
  ]], col.width, 300);
  const column = group.pieces[0]!;
  const top = Math.max(settle(172, 498, columnHeight(column)), 172);
  const mark: FontPick = serifLike(fonts.display) ? { ...fonts.display, tracking: 0 } : { family: "DM Serif Display", weight: 400, em: 0.446, tracking: 0 };
  text(ctx, { x: col.x - 6, y: top - 104, width: 120 }, { text: "“", size: 120, lineHeight: 100, lines: 1, height: 100 }, mark, alpha(WHITE, 0.9), "quote-mark");
  const after = text(ctx, { x: col.x, y: top, width: col.width }, column[0]!, fonts.display, WHITE, "quote");
  if (column[1]?.text) {
    bar(ctx, { x: col.x, y: after + 17, width: 28, height: 2.4 }, WHITE);
    text(ctx, { x: col.x, y: after + column[1].gap, width: col.width }, column[1], fonts.label, WHITE, "attribution", { upper: true });
  }
  heroFooter(ctx, col);
  heroArt(ctx, "quote", slide.icon ?? pickIcon(`${slide.title} ${body.text}`));
  return heroBuilt(ctx, "right");
}

function heroClosing(ctx: Ctx, input: DeckText): Built {
  const { colors, fonts } = ctx.dna;
  const col = heroColumn(ctx, "closing");
  const group = fitGroup([[
    { text: L(ctx).thanks, font: fonts.display, size: 60 * ctx.scale, min: 28, leading: 1.04, maxLines: 3 },
    { text: input.topic, font: fonts.body, size: 16.5 * ctx.scale, min: 12, leading: 1.4, maxLines: 2, gap: 20 },
  ]], col.width, 300);
  const column = group.pieces[0]!;
  const pillHeight = 58;
  const block = 30 + columnHeight(column) + (input.author ? 34 + pillHeight : 0);
  let y = Math.max(56, (H - block) / 2 - 6);
  heroEyebrow(ctx, col, L(ctx).closingEyebrow, y);
  y = text(ctx, { x: col.x, y: y + 30, width: col.width }, column[0]!, fonts.display, WHITE, "title");
  if (column[1]?.text) y = text(ctx, { x: col.x, y: y + column[1].gap, width: col.width }, column[1], fonts.body, alpha(WHITE, 0.92), "subtitle");
  if (input.author) {
    const name = fit({ text: input.author, font: fonts.strong, width: 320, height: 20, max: 14.5, min: 10.5, leading: 1.3, maxLines: 1 });
    const width = Math.min(col.width, textWidth(name.text, name.size, fonts.strong) + 84);
    const pill = { x: col.x, y: y + 34, width, height: pillHeight };
    if (pill.y + pill.height <= H - 28) {
      heroPill(ctx, pill);
      icon(ctx, { x: pill.x + 29, y: pill.y + pillHeight / 2 }, 34, "student", 0);
      text(ctx, { x: pill.x + 56, y: pill.y + (pillHeight - name.lineHeight) / 2, width: width - 68 }, name, fonts.strong, colors.ink, "credit");
    }
  }
  heroArt(ctx, "closing", pickIcon(`${input.topic} ${input.subtitle}`));
  return heroBuilt(ctx, "bottom");
}

function cover(ctx: Ctx, input: DeckText, source: Picture | null): Built {
  if (paper(ctx)) return coverPaper(ctx, input, source);
  if (corp(ctx)) return coverCorporate(ctx, input, source);
  if (national(ctx)) return coverNaqsh(ctx, input, source);
  if (vivid(ctx) || geometric(ctx)) return heroCover(ctx, input, source);
  const { colors, fonts } = ctx.dna;
  const width = source ? 452 : 640;
  const group = fitGroup([[
    { text: `${L(ctx).deck} · ${input.year}`, font: fonts.label, size: 10.5, min: 9, leading: 1.3, upper: true, maxLines: 1 },
    { text: input.topic, font: fonts.display, size: (source ? 60 : 68) * ctx.scale, min: 28, leading: 1.04, maxLines: 5, gap: 18 },
    { text: input.subtitle, font: fonts.body, size: 17 * ctx.scale, min: 12.5, leading: 1.45, maxLines: 3, gap: 20 },
  ]], width, 330);
  const column = group.pieces[0]!;
  const credits = [
    input.author ? { label: L(ctx).author, value: input.author } : null,
    input.teacher ? { label: L(ctx).teacher, value: input.teacher } : null,
  ].filter(Boolean) as { label: string; value: string }[];
  const block = columnHeight(column);
  const y = Math.max(64, (H - block - (credits.length ? 100 : 0)) / 2 - 10);
  bar(ctx, { x: MX, y: y + 5.6, width: 20, height: 2.4 }, colors.accent);
  text(ctx, { x: MX + 30, y, width: width - 30 }, column[0]!, fonts.label, colors.accent, "eyebrow", { upper: true });
  const after = stack(ctx, [
    { placed: column[1]!, pick: fonts.display, color: colors.ink, role: "title" },
    { placed: column[2]!, pick: fonts.body, color: colors.inkSoft, role: "subtitle" },
  ], { x: MX, y: y + column[0]!.lineHeight + column[1]!.gap, width });

  if (credits.length) {
    const pillWidth = credits.length === 2 ? Math.min(width, 440) : 250;
    const pill = { x: MX, y: Math.max(after + 30, 420), width: pillWidth, height: 64 };
    if (pill.y + pill.height <= H - 20) {
      glass(ctx, pill, { radius: Math.min(ctx.dna.radius, 22) });
      const cw = (pill.width - 40) / credits.length;
      credits.forEach((credit, index) => {
        const cx = pill.x + 20 + index * cw;
        const top = text(ctx, { x: cx, y: pill.y + 14, width: cw - 12 }, fit({ text: credit.label, font: fonts.label, width: cw - 12, height: 12, max: 8.5, min: 7.5, leading: 1.3, upper: true, maxLines: 1 }), fonts.label, colors.inkSoft, "credit-label", { upper: true });
        text(ctx, { x: cx, y: top + 5, width: cw - 12 }, fit({ text: credit.value, font: fonts.strong, width: cw - 12, height: 20, max: 14, min: 10.5, leading: 1.3, maxLines: 1 }), fonts.strong, colors.ink, "credit");
      });
    }
  }

  if (source) picture(ctx, { x: 560, y: 64, width: 400, height: 434 }, source, ctx.dna.radius + 10);
  return { light: "right", hero: true };
}

function agenda(ctx: Ctx, titles: string[]): Built {
  const { colors, fonts } = ctx.dna;
  const items = titles.slice(0, 16);
  const width = 290;
  const titleFit = fit({ text: L(ctx).agenda, font: fonts.display, width, height: 150, max: 48 * ctx.scale, min: 26, leading: 1.06, maxLines: 3 });
  let y = Math.max(80, (H - titleFit.height - 70) / 2 - 20);
  bar(ctx, { x: MX, y: y + 5.6, width: 20, height: 2.4 }, colors.accent);
  text(ctx, { x: MX + 30, y, width: width - 30 }, fit({ text: L(ctx).agendaEyebrow, font: fonts.label, width: width - 30, height: 14, max: 10.5, min: 8.5, leading: 1.3, upper: true, maxLines: 1 }), fonts.label, colors.accent, "eyebrow");
  y = text(ctx, { x: MX, y: y + 26, width }, titleFit, fonts.display, colors.ink, "title");
  text(ctx, { x: MX, y: y + 14, width }, fit({ text: L(ctx).sections(titles.length), font: fonts.body, width, height: 24, max: 15.5, min: 12, leading: 1.4, maxLines: 1 }), fonts.body, colors.inkSoft, "lead");

  const columns = items.length > 7 ? 2 : 1;
  const per = Math.ceil(items.length / columns);
  const panel = { x: 388, y: 52, width: RIGHT - 388, height: 456 };
  const pad = 24;
  const cw = (panel.width - pad * 2 - (columns - 1) * 22) / columns;
  const group = fitGroup(items.map((title) => [
    { text: title, font: fonts.strong, size: (columns === 2 ? 15.5 : 19) * ctx.scale, min: 10, leading: 1.25, maxLines: 2 },
  ]), cw - 48, (panel.height - pad * 2) / per - 16);
  const rh = Math.max(...group.pieces.map((one) => columnHeight(one))) + 18;
  const height = rh * per + pad * 2;
  const top = settle(panel.y, panel.y + panel.height, height);
  // On paper the list stands between two strong rules, with no card around it.
  if (paper(ctx)) {
    rule(ctx, { x: panel.x, y: top + pad - 10 }, panel.width, colors.ink, 1.5);
    rule(ctx, { x: panel.x, y: top + height - pad + 10 }, panel.width, colors.ink, 1.5);
  } else glass(ctx, { ...panel, y: top, height });
  const numberSize = columns === 2 ? 15 : 21;
  items.forEach((_, index) => {
    const column = Math.floor(index / per);
    const x = panel.x + pad + column * (cw + 22);
    const ry = top + pad + (index % per) * rh;
    if (index % per > 0) rule(ctx, { x, y: ry }, cw, paper(ctx) ? colors.line : alpha(colors.ink, 0.1));
    const lineHeight = round(numberSize * 1.15);
    text(ctx, { x, y: ry + (rh - lineHeight) / 2, width: 42 }, { text: num(index), size: numberSize, lineHeight, lines: 1, height: lineHeight }, { ...fonts.display, tracking: 0 }, tint(ctx, index, colors.accent), "number");
    const piece = group.pieces[index]!;
    stack(ctx, pieces(ctx, piece, ["agenda-item"], [colors.ink], [fonts.strong]), { x: x + 48, y: ry + (rh - columnHeight(piece)) / 2, width: cw - 48 });
  });
  footer(ctx);
  return { light: "right" };
}

function references(ctx: Ctx, sources: string[]): Built {
  const { colors, fonts } = ctx.dna;
  const list = sources.length ? sources.slice(0, 12) : [L(ctx).referencesFallback];
  const y = header(ctx, { eyebrow: L(ctx).referencesEyebrow, title: L(ctx).references }, { width: 760, lines: 1 });
  const columns = list.length > 5 ? 2 : 1;
  const per = Math.ceil(list.length / columns);
  const start = y + 24;
  const pad = 26;
  const cw = (SPAN - pad * 2 - (columns - 1) * 28) / columns;
  const group = fitGroup(list.map((source) => [
    { text: source, font: fonts.body, size: 16 * ctx.scale, min: 9.5, leading: 1.38, maxLines: 3 },
  ]), cw - 30, (BOTTOM - start - pad * 2) / per - 12);
  const rh = Math.max(...group.pieces.map((one) => columnHeight(one))) + 12;
  const height = rh * per + pad * 2 - 12;
  const top = settle(start, BOTTOM + 4, height);
  glass(ctx, { x: MX, y: top, width: SPAN, height });
  list.forEach((_, index) => {
    const column = Math.floor(index / per);
    const x = MX + pad + column * (cw + 28);
    const ry = top + pad + (index % per) * rh;
    const piece = group.pieces[index]!;
    text(ctx, { x, y: ry, width: 28 }, { text: `${index + 1}.`, size: piece[0]!.size, lineHeight: piece[0]!.lineHeight, lines: 1, height: piece[0]!.lineHeight }, { ...fonts.strong, tracking: 0 }, colors.accent, "number");
    stack(ctx, pieces(ctx, piece, ["source"], [colors.ink], [fonts.body]), { x: x + 30, y: ry, width: cw - 30 });
  });
  footer(ctx);
  return { light: "corners" };
}

function closing(ctx: Ctx, input: DeckText): Built {
  if (national(ctx)) return closingNaqsh(ctx, input);
  if (vivid(ctx) || geometric(ctx)) return heroClosing(ctx, input);
  const { colors, fonts } = ctx.dna;
  const width = 800;
  const x = (W - width) / 2;
  const group = fitGroup([[
    { text: L(ctx).closingEyebrow, font: fonts.label, size: 10.5, min: 9, leading: 1.3, upper: true, maxLines: 1 },
    { text: L(ctx).thanks, font: fonts.display, size: 68 * ctx.scale, min: 30, leading: 1.06, maxLines: 2, gap: 16 },
    { text: input.topic, font: fonts.body, size: 16.5 * ctx.scale, min: 12, leading: 1.4, maxLines: 2, gap: 44 },
    { text: input.author ?? "", font: fonts.label, size: 11, min: 9, leading: 1.3, upper: true, maxLines: 1, gap: 14 },
  ]], width - 80, 380);
  const column = group.pieces[0]!;
  const top = settle(70, 470, columnHeight(column));
  const roles = ["eyebrow", "title", "subtitle", "credit"];
  // The editorial deck closes on a page of its own colour; the corporate one
  // on a rounded panel of its brand, floating on the white.
  const field = paper(ctx) || corp(ctx);
  if (paper(ctx)) ctx.rows.push(row("shape", { x: 0, y: 0, width: W, height: H }, { fill: colors.block, borderRadius: 0 }, { kind: "block" }));
  if (corp(ctx)) {
    const panel = { x: 44, y: 44, width: W - 88, height: H - 88 };
    ctx.rows.push(...dropRows(ctx.dna, panel, 40, 18));
    ctx.rows.push(row("shape", panel, { ...brandFill(ctx.dna), borderRadius: 40 }, { kind: "block" }));
  }
  const colorsFor = field
    ? [colors.onBlock, colors.onBlock, alpha(colors.onBlock, 0.84), colors.onBlock]
    : [colors.accent, colors.ink, colors.inkSoft, colors.accent];
  const picks = [fonts.label, fonts.display, fonts.body, fonts.label];
  let y = top;
  column.forEach((piece, index) => {
    if (!piece.text) return;
    if (index > 0) y += piece.gap;
    if (index === 2) bar(ctx, { x: W / 2 - 20, y: y - 24, width: 40, height: 2.4 }, field ? colors.onBlock : colors.accent);
    y = text(ctx, { x: x + 40, y, width: width - 80 }, piece, picks[index]!, colorsFor[index]!, roles[index]!, { align: "center", upper: index === 0 || index === 3 });
  });
  return { light: "bottom", hero: true };
}

/* ------------------------------------------------------------------ deck */

export type DeckText = {
  topic: string;
  shortTitle: string;
  subtitle: string;
  author: string | null;
  teacher: string | null;
  year: number;
};

export type DeckInput = DeckText & {
  dna: DesignDNA;
  /** The deck's language; Uzbek when not said. */
  language?: DeckLanguage;
  face: FaceResolver;
  slides: SlideContent[];
  sources: string[];
  cover: Picture | null;
  /** Photographs found for content pages, keyed by their search query. */
  pictures: ReadonlyMap<string, Picture>;
};

const cards_ = (rows: Row[]) => rows.filter((one) => one.type === "shape" && (one.content.kind === "glass" || one.content.kind === "panel"));
const within = (one: Rect, box: Rect) => one.x >= box.x - 1 && one.y >= box.y - 1 && one.x + one.width <= box.x + box.width + 1 && one.y + one.height <= box.y + box.height + 1;

/** Text rows not sitting inside a card: these are read straight off the light. */
function wordsOnGround(rows: Row[]): Rect[] {
  const cards = cards_(rows);
  return rows.filter((one) => one.type === "text" && !cards.some((card) => within(one, card)));
}

/**
 * What no page may do.
 *
 * Words off the slide, words on top of words, words that start inside a card
 * and run out of it, words over a photograph. Checked on every page before it
 * is accepted; a page with any of these is rebuilt.
 */
export function pageFaults(rows: Row[]): string[] {
  const faults: string[] = [];
  const words = rows.filter((one) => one.type === "text");
  const cards = cards_(rows);
  // An ornament picture is the ground a page is printed on, not a photograph.
  const pictures = rows.filter((one) => one.type === "image" && !one.content.decor);
  for (const one of words) {
    const role = String(one.content.role);
    if (one.x < -0.5 || one.y < -0.5 || one.x + one.width > W + 0.5 || one.y + one.height > H + 0.5) faults.push(`out_of_bounds:${role}`);
    // A card owns the words whose middle is in it. Badges sit on a card's edge
    // on purpose — the step number on a process card, the VS between two
    // panels — so they are held to the overlap rule below, not to this one.
    const cx = one.x + one.width / 2;
    const cy = one.y + Math.min(one.height, 20) / 2;
    const host = role === "badge" ? undefined : cards.find((card) => cx >= card.x && cx <= card.x + card.width && cy >= card.y && cy <= card.y + card.height);
    if (host && !within(one, host)) faults.push(`spills:${role}`);
    if (pictures.some((picture) => intersects(one, picture, -1))) faults.push(`over_picture:${role}`);
  }
  for (let a = 0; a < words.length; a += 1) {
    for (let b = a + 1; b < words.length; b += 1) {
      if (intersects(words[a]!, words[b]!, -1.5)) faults.push(`overlap:${String(words[a]!.content.role)}/${String(words[b]!.content.role)}`);
    }
  }
  return faults;
}

/** The layouts that leave room for a subject mark often enough to look for it. */
const MARKED = new Set(["cards", "bullets", "stats", "statement", "quote", "chart"]);

export function composeDeck(input: DeckInput): ComposedSlide[] {
  const total = input.slides.length + 4;
  const used = new Map<string, number>();
  const pages: ComposedSlide[] = [];
  const short = clip(input.shortTitle || input.topic, 48);

  const page = (index: number, title: string, layout: string, build: (ctx: Ctx) => Built, fallback?: (ctx: Ctx) => Built, subject?: string) => {
    const variant = (used.get(layout) ?? 0) + (input.dna.seed % 2);
    used.set(layout, (used.get(layout) ?? 0) + 1);

    /**
     * Built, checked, and rebuilt smaller until it is clean.
     *
     * The measuring is exact enough that the first build nearly always
     * passes; this loop is what makes "nearly" into "always". After three
     * scales the page falls back to the plainest composition of its content,
     * which is checked the same way.
     */
    let attempt: { ctx: Ctx; built: Built; faults: string[] } | null = null;
    const rejected: string[][] = [];
    const tries: Array<{ scale: number; build: (ctx: Ctx) => Built }> = [
      { scale: 1, build }, { scale: 0.9, build }, { scale: 0.8, build },
      ...(fallback ? [{ scale: 1, build: fallback }, { scale: 0.85, build: fallback }] : []),
    ];
    for (const trial of tries) {
      const ctx: Ctx = { dna: input.dna, language: input.language ?? "uz", face: input.face, index, total, short, variant, scale: trial.scale, rows: [] };
      const built = trial.build(ctx);
      const faults = pageFaults(ctx.rows);
      attempt = { ctx, built, faults };
      if (faults.length === 0) break;
      rejected.push(faults.slice(0, 6));
    }
    const { ctx, built, faults } = attempt!;

    const editorial = input.dna.style === "editorial";
    const studio = input.dna.style === "soft3d";
    // A raised or floating form's shadow lies on the surface, under every
    // face — its neighbours' included — so shadows are drawn before anything.
    // The subject's mark lies under everything the layout drew.
    const mark = subject && !built.hero ? subjectMark(ctx, subject) : null;
    const laid = mark ? [mark, ...ctx.rows] : ctx.rows;
    const content = studio || ["corporate", "naqsh", "spektr", "mozaika"].includes(input.dna.style)
      ? [...laid.filter((one) => one.content.kind === "shadow"), ...laid.filter((one) => one.content.kind !== "shadow")]
      : laid;
    const keep = content.map((one) => ({ x: one.x, y: one.y, width: one.width, height: one.height }));
    const next = random(input.dna.seed ^ (index * 104729));
    const corporate = input.dna.style === "corporate";
    const naqsh = input.dna.style === "naqsh";
    const spektr = input.dna.style === "spektr";
    const mozaika = input.dna.style === "mozaika";
    const light = spektr
      ? (built.hero ? heroField(input.dna, next) : spektrBackdrop(input.dna))
      : mozaika
      ? (built.hero ? [] : mozaikaBackdrop({ dna: input.dna, next, keep, index }))
      : naqsh
      ? naqshBackdrop({ dna: input.dna, family: input.dna.ornament ?? "blue", next, light: built.light, words: wordsOnGround(content), keep, hero: Boolean(built.hero) })
      : editorial
      ? paperBackdrop({ dna: input.dna, next, light: built.light, keep, hero: Boolean(built.hero) })
      : corporate
        ? corporateBackdrop({ dna: input.dna, next, light: built.light, words: wordsOnGround(content), keep, hero: Boolean(built.hero) })
      : studio
        ? studioBackdrop({ dna: input.dna, next, light: built.light, keep, hero: Boolean(built.hero) })
        : backdrop({ dna: input.dna, next, light: built.light, keep, words: wordsOnGround(content), hero: Boolean(built.hero) });
    const rows = [...light, ...content].map((one, z) => ({ ...one, z_index: z }));
    const angle = 120 + Math.round(random(input.dna.seed + index)() * 50);
    pages.push({
      title,
      layout,
      // Paper is flat; glass sits on a graded ground.
      background: editorial || studio || corporate || naqsh || spektr || mozaika
        ? { color: built.ground ?? input.dna.colors.ground }
        : {
          color: input.dna.colors.ground,
          gradientStops: [{ color: input.dna.colors.ground, offset: 0 }, { color: input.dna.colors.ground2, offset: 100 }],
          gradientAngle: angle,
        },
      rows,
      report: {
        engine: "glass_v1", style: input.dna.style, layout, variant: variant % 2 ? "b" : "a", scale: ctx.scale,
        light: built.light, motif: input.dna.motif, faults,
        // What the earlier builds of this page got wrong, so a page that had
        // to fall back can be explained without re-running it.
        ...(rejected.length ? { rebuilt: rejected } : {}),
      },
    });
  };

  page(1, input.topic, "cover", (ctx) => cover(ctx, input, input.cover), (ctx) => cover(ctx, input, null));
  const chrome = CHROME[input.language ?? "uz"];
  page(2, chrome.agenda, "agenda", (ctx) => agenda(ctx, input.slides.map((slide) => slide.title)));
  input.slides.forEach((slide, offset) => {
    const picture = slide.imageQuery ? input.pictures.get(slide.imageQuery) ?? null : null;
    const kind = slide.kind === "photo" && !picture ? "bullets" : slide.kind;
    const plain = (ctx: Ctx) => statement(ctx, { ...slide, kind: "statement", lead: slide.lead || slide.points.map((point) => point.title).filter(Boolean).join(", ") });
    page(offset + 3, slide.title, kind, (ctx) => {
      switch (kind) {
        case "cards": return cards(ctx, slide);
        case "bullets": return bullets(ctx, slide);
        case "stats": return stats(ctx, slide);
        case "timeline": return timeline(ctx, slide);
        case "process": return process(ctx, slide);
        case "comparison": return comparison(ctx, slide);
        case "quote": return quote(ctx, slide);
        case "chart": return chart(ctx, slide);
        case "photo": return photo(ctx, slide, picture!);
        default: return statement(ctx, slide);
      }
    }, kind === "statement" ? undefined : plain, MARKED.has(kind) ? slide.icon ?? pickIcon(`${slide.title} ${slide.eyebrow} ${slide.lead}`) : undefined);
  });
  page(total - 1, chrome.references, "references", (ctx) => references(ctx, input.sources));
  page(total, chrome.thanksTitle, "closing", (ctx) => closing(ctx, input));
  return pages;
}
