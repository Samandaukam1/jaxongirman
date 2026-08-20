// GENERATED FILE — do not edit by hand.
// Source: packages/jslayd/src/render.ts
// Regenerate with: node supabase/scripts/build-jslayd-runtime.mjs
//
// The JSLAYD runtime, projected into the Edge tree. Edit the package, not this.

import { extendChartPalette, resolveColor } from "./colors.ts";
import {
  conditionHolds,
  previewSlide,
  resolveBinding,
  resolveBullets,
  type ImageRef,
  type SlideData,
} from "./content.ts";
import { faceFor } from "./document.ts";
import type {
  Archetype,
  Border,
  ChartElement,
  ColorFamily,
  ColorValue,
  Corners,
  FontDeclaration,
  Geometry,
  Gradient,
  ImageElement,
  JslaydDocument,
  JslaydElement,
  ListElement,
  Shadow,
  ShapeElement,
  StatElement,
  TableElement,
  TextElement,
  TextSource,
  TextStyle,
} from "./document.ts";
import { CHART_FALLBACKS, DESIGN_ASSET_BUCKET, MIN_FONT_SIZE, MIN_RENDER_FONT_SIZE, RENDER_SCALE } from "./spec.ts";

/**
 * The JSLAYD render engine.
 *
 * Compiled document + slide content → the element rows the apps already draw.
 * There is one of these and every surface goes through it (§103): the generator
 * writes its output to the database, the admin preview and the picker
 * thumbnails render the same output, and both exporters read the rows it
 * produced. No second layout engine exists anywhere.
 *
 * Two coordinate systems meet here. A design is authored on the canonical
 * 1920 × 1080 canvas; the apps' stored geometry is the 1000 × 562.5 model that
 * every existing deck, the database constraint and all four renderers already
 * speak. `RENDER_SCALE` projects one onto the other exactly — the ratio is
 * identical in both axes — so authoring gains its canonical canvas without a
 * single stored row changing (§18).
 */

export type RenderedElement = {
  type: "text" | "image" | "shape" | "icon" | "chart" | "table" | "line" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  opacity: number;
  locked: boolean;
  style: Record<string, unknown>;
  content: Record<string, unknown>;
};

export type RenderedSlide = {
  /** The `slides.background` payload: `{ color }`, plus gradient keys if any. */
  background: Record<string, unknown>;
  elements: RenderedElement[];
};

/** Mean glyph advance as a fraction of font size — the engine's own estimate. */
const GLYPH_RATIO = 0.53;

/**
 * The colours to draw with: the family the deck chose, or the design's default.
 *
 * An unknown code resolves to the default rather than failing — a family that
 * was removed since a deck was generated must not stop it from rendering.
 */
export function familyOf(document: JslaydDocument, code?: string | null) {
  const families = document.colorFamilies ?? [];
  const chosen = code ? families.find((family) => family.code === code) : undefined;
  return {
    colors: chosen?.colors ?? document.colors,
    chartPalette: chosen?.chartPalette?.length ? chosen.chartPalette : document.chartPalette,
  };
}

export function renderArchetype(
  document: JslaydDocument,
  archetype: Archetype,
  slide: SlideData,
  familyCode?: string | null,
): RenderedSlide {
  const family = familyOf(document, familyCode);
  const context: RenderContext = {
    colors: family.colors,
    fonts: new Map(document.fonts.map((font) => [font.id, font])),
    slug: document.design.slug,
    chartPalette: family.chartPalette,
    slide,
  };
  const elements: RenderedElement[] = [];
  emit(archetype.elements, 0, 0, context, elements);
  // The apps sort by z_index, but a stable emit order keeps two renders of one
  // slide byte-identical, which is what visual regression compares.
  elements.sort((first, second) => first.z_index - second.z_index);
  return { background: paintBackground(archetype.background, context.colors), elements };
}

type RenderContext = {
  colors: ColorFamily;
  fonts: Map<string, FontDeclaration>;
  chartPalette: readonly string[];
  slide: SlideData;
  /** Every font file of a design is stored under it; see `assetKey`. */
  slug: string;
};

function emit(
  elements: readonly JslaydElement[],
  offsetX: number,
  offsetY: number,
  context: RenderContext,
  out: RenderedElement[],
): void {
  // Elements whose condition failed leave holes. They are collected first so a
  // growing element can reclaim the space before anything is measured into it.
  const dropped: Geometry[] = [];
  const kept: JslaydElement[] = [];
  for (const element of elements) {
    if (conditionHolds(element.when, context.slide)) kept.push(element);
    else dropped.push(element.geometry);
  }

  for (const element of kept) {
    const geometry = element.grow ? absorb(element.geometry, dropped) : element.geometry;
    const box = place(geometry, offsetX, offsetY);

    switch (element.type) {
      case "group":
        // A group is a coordinate frame, not a drawn thing: it contributes no
        // row of its own, and its children inherit its origin.
        emit(element.children, geometry.x + offsetX, geometry.y + offsetY, context, out);
        break;
      case "text": case "quote": case "number": case "badge":
        out.push(...renderText(element, box, geometry, context));
        break;
      case "list":
        out.push(...renderList(element, box, geometry, context));
        break;
      case "stat":
        out.push(...renderStat(element, box, geometry, context));
        break;
      case "image": case "frame":
        out.push(...renderImage(element, box, geometry, context));
        break;
      case "shape": case "decorative":
        out.push(renderShape(element, box, geometry, context));
        break;
      case "divider": case "line":
        out.push(renderLine(element, box, geometry, context));
        break;
      case "icon":
        out.push({
          ...base("icon", box, geometry, element.opacity),
          style: { color: resolveColor(element.color, context.colors), strokeWidth: element.strokeWidth },
          content: { icon: element.icon },
        });
        break;
      case "chart":
        out.push(renderChart(element, box, geometry, context));
        break;
      case "table": {
        const table = renderTable(element, box, geometry, context);
        if (table) out.push(table);
        break;
      }
    }
  }
}

/* --------------------------------------------------------------- geometry */

type Box = { x: number; y: number; width: number; height: number };

/**
 * Stretches a box down over the holes left by dropped siblings.
 *
 * Only a hole that sits below the element and overlaps it horizontally by at
 * least half its width counts — otherwise a missing sidebar would stretch a
 * headline across the whole slide, which is not what the author drew.
 */
function absorb(geometry: Geometry, dropped: readonly Geometry[]): Geometry {
  let bottom = geometry.y + geometry.height;
  for (const hole of dropped) {
    const overlap = Math.max(0, Math.min(geometry.x + geometry.width, hole.x + hole.width) - Math.max(geometry.x, hole.x));
    if (overlap < Math.min(geometry.width, hole.width) * 0.5) continue;
    if (hole.y + hole.height <= geometry.y) continue;
    bottom = Math.max(bottom, hole.y + hole.height);
  }
  return bottom === geometry.y + geometry.height ? geometry : { ...geometry, height: bottom - geometry.y };
}

/** Canvas units → the render model, with the group offset already applied. */
function place(geometry: Geometry, offsetX: number, offsetY: number): Box {
  return {
    x: scale(geometry.x + offsetX),
    y: scale(geometry.y + offsetY),
    width: scale(geometry.width),
    height: scale(geometry.height),
  };
}

function scale(value: number): number {
  return Math.round(value * RENDER_SCALE * 100) / 100;
}

/**
 * Stacking order, doubled.
 *
 * Some elements draw as more than one row — a badge is a plate and its copy, an
 * image with an overlay is two — and those companions have to sit either side
 * of the element the author declared without colliding with whatever they put
 * one step away. Doubling buys an odd slot above and below each authored level,
 * and `z_index` is an integer column, so a half step was never available.
 */
function zOf(geometry: Geometry): number {
  return geometry.zIndex * 2;
}

function base(type: RenderedElement["type"], box: Box, geometry: Geometry, opacity: number): RenderedElement {
  return {
    type,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: geometry.rotation,
    z_index: zOf(geometry),
    opacity,
    locked: false,
    style: {},
    content: {},
  };
}

/* ----------------------------------------------------------------- paints */

/**
 * A fill, as the renderers read it.
 *
 * The legacy two-stop keys (`fill`, `gradientTo`, `gradientAngle`) are always
 * emitted so every renderer and both exporters keep working untouched, and the
 * full stop list rides alongside under `gradientStops`. A renderer that has
 * learned multi-stop reads that key; one that has not draws the two-stop
 * approximation and is merely less pretty, never broken (§71).
 */
function paint(value: ColorValue | Gradient | null, colors: ColorFamily): Record<string, unknown> {
  if (!value) return {};
  if (!("stops" in value)) return { fill: resolveColor(value, colors) };
  const stops = value.stops.map((stop) => ({ offset: stop.offset, color: resolveColor(stop.color, colors) }));
  return {
    fill: stops[0]!.color,
    gradientTo: stops[stops.length - 1]!.color,
    gradientAngle: value.angle,
    gradientType: value.type,
    gradientStops: stops,
  };
}

function paintBackground(value: ColorValue | Gradient, colors: ColorFamily): Record<string, unknown> {
  const painted = paint(value, colors);
  const { fill, ...rest } = painted;
  return { color: fill ?? colors.background, ...rest };
}

function corners(value: Corners | null): Record<string, unknown> {
  if (!value) return {};
  const { topLeft, topRight, bottomRight, bottomLeft } = value;
  const uniform = topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft;
  return uniform
    ? { borderRadius: scale(topLeft) }
    : {
        borderRadius: scale(Math.min(topLeft, topRight, bottomRight, bottomLeft)),
        borderRadiusCorners: [scale(topLeft), scale(topRight), scale(bottomRight), scale(bottomLeft)],
      };
}

function border(value: Border | null, colors: ColorFamily): Record<string, unknown> {
  if (!value) return {};
  return {
    stroke: resolveColor(value.color, colors),
    strokeWidth: scale(value.width),
    strokeStyle: value.style,
    strokeOpacity: value.opacity,
  };
}

/** Same forward-compatible shape as gradients: a legacy flag plus the detail. */
function shadows(list: readonly Shadow[], colors: ColorFamily): Record<string, unknown> {
  if (list.length === 0) return {};
  return {
    shadow: true,
    shadows: list.map((entry) => ({
      offsetX: scale(entry.offsetX),
      offsetY: scale(entry.offsetY),
      blur: scale(entry.blur),
      spread: scale(entry.spread),
      opacity: entry.opacity,
      color: resolveColor(entry.color, colors),
    })),
  };
}

/* ------------------------------------------------------------------ fonts */

/**
 * Faces bundled with the apps, by display name and weight.
 *
 * A custom face is drawn under the family the runtime registers it as; until
 * that file loads — and in PPTX, where a face cannot be embedded — the design's
 * declared fallback is what appears. The substitution is always the one the
 * author chose, never one the engine picked for them (§78).
 */
const BUNDLED_FACES: Record<string, { weight: number; family: string }[]> = {
  "Manrope": [
    { weight: 400, family: "Manrope_400Regular" },
    { weight: 500, family: "Manrope_500Medium" },
    { weight: 600, family: "Manrope_600SemiBold" },
    { weight: 700, family: "Manrope_700Bold" },
  ],
  "League Spartan": [
    { weight: 700, family: "LeagueSpartan_700Bold" },
    { weight: 800, family: "LeagueSpartan_800ExtraBold" },
  ],
  "Arimo": [
    { weight: 400, family: "Arimo_400Regular" },
    { weight: 700, family: "Arimo_700Bold" },
  ],
  "Pinyon Script": [{ weight: 400, family: "PinyonScript_400Regular" }],
  "Inter": [
    { weight: 400, family: "Inter_400Regular" },
    { weight: 900, family: "Inter_900Black" },
  ],
  "Caveat Brush": [{ weight: 400, family: "CaveatBrush_400Regular" }],
};

export function bundledFace(fallback: string, weight: number): string {
  const faces = BUNDLED_FACES[fallback] ?? BUNDLED_FACES["Manrope"]!;
  let best = faces[0]!;
  for (const face of faces) {
    if (Math.abs(face.weight - weight) < Math.abs(best.weight - weight)) best = face;
  }
  return best.family;
}

/**
 * The object key a face is actually stored under.
 *
 * A design declares its files by name — `apelsen-display-700.ttf` — because
 * that is what an author types and what the design owns. They are uploaded to
 * the design's own folder in the bucket, so the name alone addresses nothing:
 * an exporter asking for it gets a 404 and silently falls back to a bundled
 * face, which is a deck set in the wrong typeface with nothing to show for it.
 *
 * A name already carrying a folder is left alone, so a document that stores the
 * full key — every design generated from a PowerPoint template does — is not
 * given the prefix twice.
 */
function assetKey(asset: string, slug: string): string {
  return asset.includes("/") ? asset : `${slug}/${asset}`;
}

function typeface(style: TextStyle, context: RenderContext): Record<string, unknown> {
  const font = context.fonts.get(style.font);
  const fallbackFace = bundledFace(font?.fallback ?? "Manrope", style.fontWeight);
  // The file for this weight and slope, rather than the font's only file: a
  // package ships several, and picking the wrong one is how a heading ends up
  // drawn in the body weight.
  const face = faceFor(font, style.fontWeight, style.fontStyle === "italic");
  return {
    fontFamily: face ? font!.family : fallbackFace,
    // The bundled face to draw with while the custom one loads, and the face
    // PowerPoint is told to use — never a substitution the engine picked (§78).
    fontFallback: fallbackFace,
    // The object key of the custom face, so an exporter that can embed a font
    // embeds the design's own rather than approximating it.
    ...(face ? { fontAsset: assetKey(face.asset, context.slug), fontDisplayName: font!.name } : {}),
    fontWeight: String(style.fontWeight),
    fontStyle: style.fontStyle,
  };
}

/* ------------------------------------------------------------------- text */

/**
 * Shrinks the copy until it fits, and never cuts a word.
 *
 * Text deleted here is gone from the deck for good, whereas a denser block is
 * something the author can still restyle in the editor — so the last resort is
 * a tighter setting, not a shorter sentence.
 */
function fit(text: string, style: TextStyle, box: Box): { fontSize: number; maxLines: number } {
  const start = scale(style.fontSize);
  // The apps clamp anything below `MIN_RENDER_FONT_SIZE`, so shrinking past it
  // buys nothing and loses the composition to a resize nobody authored.
  const floor = Math.max(MIN_RENDER_FONT_SIZE, scale(style.minFontSize));
  const explicit = text.split("\n");
  const linesAt = (size: number) => {
    const perLine = Math.max(1, Math.floor(box.width / (size * GLYPH_RATIO)));
    return explicit.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
  };
  const roomAt = (size: number) => Math.max(1, Math.floor(box.height / (size * style.lineHeight)));

  /**
   * The line budget the design was drawn for: what the box holds at the size
   * the author chose. Freezing it is what protects the composition — recomputing
   * it as the type shrinks would let a headline the author drew as two lines
   * quietly become five at nearly full size.
   */
  const budget = style.maxLines ?? roomAt(start);

  if (style.overflow === "wrap") return { fontSize: start, maxLines: style.maxLines ?? linesAt(start) };
  if (style.overflow === "clip") return { fontSize: start, maxLines: Math.min(budget, roomAt(start)) };

  // First pass keeps the drawn budget. Only copy longer than the slot was ever
  // drawn for reaches the second, which trades the budget away for the frame's
  // full height rather than letting a word disappear.
  for (let size = start; size >= floor; size -= 1) {
    const allowed = Math.min(budget, roomAt(size));
    if (linesAt(size) <= allowed) return { fontSize: round2(size), maxLines: allowed };
  }
  for (let size = floor; size >= MIN_RENDER_FONT_SIZE; size -= 1) {
    const allowed = roomAt(size);
    if (linesAt(size) <= allowed) return { fontSize: round2(size), maxLines: allowed };
  }
  // Nothing fits even at the floor. Report the floor rather than something
  // under it: every renderer clamps below this anyway, so a smaller number
  // would describe a slide that will never be drawn.
  return { fontSize: MIN_RENDER_FONT_SIZE, maxLines: roomAt(MIN_RENDER_FONT_SIZE) };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function textStyleOf(style: TextStyle, fontSize: number, context: RenderContext): Record<string, unknown> {
  const color = resolveColor(style.color, context.colors);
  return {
    color,
    fontSize,
    lineHeight: round2(fontSize * style.lineHeight),
    letterSpacing: scale(style.letterSpacing),
    textAlign: style.align,
    verticalAlign: style.verticalAlign === "middle" ? "center" : style.verticalAlign,
    textTransform: style.transform,
    ...typeface(style, context),
    ...(style.effect === "none" ? {} : { textEffect: style.effect }),
    ...(style.shadows.length ? shadows(style.shadows, context.colors) : {}),
    ...(style.strokeColor ? { textStroke: resolveColor(style.strokeColor, context.colors), textStrokeWidth: scale(style.strokeWidth) } : {}),
    ...(style.highlight ? { highlight: resolveColor(style.highlight, context.colors) } : {}),
    ...(style.gradient ? { textGradient: paint(style.gradient, context.colors) } : {}),
    ...(style.blur > 0 ? { blur: scale(style.blur) } : {}),
  };
}

function sourceText(source: TextSource, context: RenderContext): string | null {
  return "literal" in source ? source.literal : resolveBinding(source.bind, context.slide);
}

/** The plate a text or stat element sits on, when it asked for one. */
function plate(
  fill: ColorValue | Gradient | null,
  cornerSet: Corners | null,
  borderSet: Border | null,
  shadowList: readonly Shadow[],
  box: Box,
  geometry: Geometry,
  opacity: number,
  context: RenderContext,
): RenderedElement | null {
  if (!fill && !borderSet && shadowList.length === 0) return null;
  return {
    ...base("shape", box, geometry, opacity),
    z_index: zOf(geometry) - 1,
    style: {
      ...paint(fill, context.colors),
      ...corners(cornerSet),
      ...border(borderSet, context.colors),
      ...shadows(shadowList, context.colors),
    },
  };
}

function renderText(element: TextElement, box: Box, geometry: Geometry, context: RenderContext): RenderedElement[] {
  const text = sourceText(element.source, context);
  if (!text) return [];
  /**
   * Which element of the design this row came from.
   *
   * Carried so something downstream can find its way back. A design imported
   * from PowerPoint is exported by editing the original slide, and the only
   * thing joining a finished row of copy to the shape it belongs in is this id
   * — without it the words would have to be matched by guessing at position.
   */
  const origin = { elementId: element.id };

  const inset = scale(element.padding);
  const inner: Box = {
    x: box.x + inset,
    y: box.y + inset,
    width: Math.max(1, box.width - inset * 2),
    height: Math.max(1, box.height - inset * 2),
  };
  const shaped = fit(text, element.text, inner);
  const rows: RenderedElement[] = [];
  const backing = plate(element.background, element.corners, element.border, [], box, geometry, element.opacity, context);
  if (backing) rows.push(backing);
  rows.push({
    ...base("text", inner, geometry, element.opacity),
    style: textStyleOf(element.text, shaped.fontSize, context),
    content: { text, maxLines: shaped.maxLines, ...origin },
  });
  return rows;
}

/**
 * A list becomes one text block with its markers baked in.
 *
 * Every renderer and both exporters already draw a multi-line text row
 * correctly, so a list that is one row inherits all of that for free — and a
 * user editing the slide gets a single editable block rather than five that
 * drift apart.
 */
function renderList(element: ListElement, box: Box, geometry: Geometry, context: RenderContext): RenderedElement[] {
  const items = resolveBullets(context.slide, element.maxItems);
  if (items.length === 0) return [];
  const marker = (index: number) => {
    if (element.marker === "number") return `${index + 1}.  `;
    if (element.marker === "dash") return "—  ";
    if (element.marker === "bullet") return "•  ";
    return "";
  };
  const text = items.map((item, index) => `${marker(index)}${item}`).join("\n");
  // Item spacing rides on the leading, since the block is a single row.
  const spaced: TextStyle = {
    ...element.text,
    lineHeight: element.text.lineHeight + element.itemSpacing / Math.max(1, element.text.fontSize),
  };
  const shaped = fit(text, spaced, box);
  return [{
    ...base("text", box, geometry, element.opacity),
    style: { ...textStyleOf(spaced, shaped.fontSize, context), markerColor: resolveColor(element.markerColor, context.colors) },
    content: { text, maxLines: shaped.maxLines, listMarker: element.marker },
  }];
}

/**
 * A stat card: value and label laid out as one block.
 *
 * The value takes the height its own type needs and the label follows it, so a
 * three-character figure and a nine-character one both sit at the same optical
 * position rather than the label floating away from the shorter number.
 */
function renderStat(element: StatElement, box: Box, geometry: Geometry, context: RenderContext): RenderedElement[] {
  const rawValue = sourceText(element.value, context);
  if (!rawValue) return [];
  const value = `${element.prefix}${rawValue}${element.suffix}`;
  const label = element.label ? sourceText(element.label, context) : null;

  const inset = scale(element.padding);
  const inner: Box = {
    x: box.x + inset,
    y: box.y + inset,
    width: Math.max(1, box.width - inset * 2),
    height: Math.max(1, box.height - inset * 2),
  };
  const gap = scale(element.spacing);
  const labelHeight = label
    ? Math.min(inner.height * 0.45, scale(element.labelStyle.fontSize) * element.labelStyle.lineHeight * 2)
    : 0;
  const valueBox: Box = { ...inner, height: Math.max(1, inner.height - labelHeight - (label ? gap : 0)) };
  const valueShaped = fit(value, element.valueStyle, valueBox);

  const rows: RenderedElement[] = [];
  const backing = plate(element.background, element.corners, element.border, element.shadows, box, geometry, element.opacity, context);
  if (backing) rows.push(backing);
  rows.push({
    ...base("text", valueBox, geometry, element.opacity),
    style: textStyleOf(element.valueStyle, valueShaped.fontSize, context),
    content: { text: value, maxLines: 1, statRole: "value" },
  });
  if (label) {
    const labelBox: Box = { ...inner, y: valueBox.y + valueBox.height + gap, height: Math.max(1, labelHeight) };
    const labelShaped = fit(label, element.labelStyle, labelBox);
    rows.push({
      ...base("text", labelBox, geometry, element.opacity),
      style: textStyleOf(element.labelStyle, labelShaped.fontSize, context),
      content: { text: label, maxLines: labelShaped.maxLines, statRole: "label" },
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ media */

/**
 * A slot filled by a reusable object rather than a photograph.
 *
 * The shapes arrive already drawn, in the element's own 0–1 space, and are
 * projected into the slot the design placed. That order matters: JSLAYD decides
 * where a visual sits and how big it is, and the element only fills it. An
 * element that could move itself would be a design deciding its own layout.
 */
function renderPlacedElement(element: ImageElement, box: Box, geometry: Geometry, context: RenderContext): RenderedElement[] {
  const shapes = context.slide.elements[element.slot] ?? [];
  if (shapes.length === 0) return [];

  const baseZ = zOf(geometry);
  return [...shapes]
    .sort((first, second) => first.zIndex - second.zIndex)
    .map((shape, order) => ({
      // An element built from geometry emits shapes; one built from a render
      // emits a single image. Both arrive here already positioned in the
      // element's own space, so the projection below is the same either way.
      ...base(shape.type === "image" ? "image" : "shape", {
        x: box.x + shape.x * box.width,
        y: box.y + shape.y * box.height,
        width: shape.width * box.width,
        height: shape.height * box.height,
      }, geometry, element.opacity * shape.opacity),
      rotation: shape.rotation,
      // Stacked above whatever the slot sits on, in the order the element
      // declared, so the design's own layering is preserved around it.
      z_index: baseZ + order,
      style: shape.style,
      content: { kind: "jelement", slot: element.slot, ...(shape.content ?? {}) },
    }));
}

function renderImage(element: ImageElement, box: Box, geometry: Geometry, context: RenderContext): RenderedElement[] {
  // A design may declare the slot takes an element instead of a picture.
  if (element.strategy === "jelement") return renderPlacedElement(element, box, geometry, context);

  /**
   * The design's own artwork resolves to itself.
   *
   * A template's logo, texture or cover photograph is part of the composition
   * rather than a place to put something, so it does not wait for the deck to
   * supply anything and does not disappear when the deck supplies nothing.
   */
  const owned = element.source && "asset" in element.source
    ? { bucket: DESIGN_ASSET_BUCKET, path: `${context.slug}/${element.source.asset}` }
    : null;
  const picture = owned ?? context.slide.images[element.slot] ?? null;
  // A slot with no picture still draws when the design says the image is
  // required: the renderer shows a placeholder, which is a composition with a
  // hole in it rather than a composition that silently lost a quarter of itself.
  if (!picture && !element.required) return [];

  const rows: RenderedElement[] = [{
    ...base("image", box, geometry, element.opacity),
    style: {
      objectFit: element.fit === "fill" ? "cover" : element.fit,
      focusX: element.focus.x,
      focusY: element.focus.y,
      ...corners(element.corners),
      ...border(element.border, context.colors),
      ...shadows(element.shadows, context.colors),
    },
    content: {
      ...imageContent(picture),
      kind: element.type === "frame" ? "frame" : "image",
      slot: element.slot,
      strategy: element.strategy,
      // Only where the hole is: an editor showing an empty box needs to know
      // what belongs in it, and a filled one does not. Added conditionally so a
      // picture that resolved carries exactly the fields it always did.
      ...(picture ? {} : imageHint(element)),
    },
  }];

  if (element.overlay) {
    rows.push({
      ...base("shape", box, geometry, element.overlayOpacity),
      z_index: zOf(geometry) + 1,
      style: { ...paint(element.overlay, context.colors), ...corners(element.corners) },
    });
  }
  return rows;
}

/**
 * What kind of picture belongs in an empty slot.
 *
 * A composition with a hole in it is honest, and it is also a question: the
 * person filling it is looking at a grey rectangle and guessing whether it
 * wants a portrait, a diagram or a photograph of a building. The design already
 * knows — it declared an orientation, a source and sometimes a style — so the
 * answer travels with the hole rather than staying in a document nobody
 * editing a deck will ever open.
 */
function imageHint(element: ImageElement): Record<string, unknown> {
  const kind = element.strategy === "user_upload"
    ? "o‘z rasmingiz"
    : element.strategy === "jelement" ? "chizma element" : "mavzuga oid surat";
  const shape = element.orientation === "portrait"
    ? "tik"
    : element.orientation === "square" ? "kvadrat" : element.orientation === "landscape" ? "yotiq" : "";

  return {
    empty: true,
    orientation: element.orientation,
    required: element.required,
    ...(element.stylePreference ? { stylePreference: element.stylePreference } : {}),
    hint: [shape, kind].filter(Boolean).join(" "),
  };
}

function imageContent(picture: ImageRef | null): Record<string, unknown> {
  if (!picture) return {};
  return "url" in picture ? { url: picture.url } : { storageBucket: picture.bucket, storagePath: picture.path };
}

/* ----------------------------------------------------------------- shapes */

function renderShape(element: ShapeElement, box: Box, geometry: Geometry, context: RenderContext): RenderedElement {
  // A circle or ellipse is a rectangle with a radius the renderers already
  // honour, which is why no renderer needs a new shape primitive to draw one.
  const rounded = element.shape === "circle" || element.shape === "ellipse"
    ? { borderRadius: Math.min(box.width, box.height) / 2 }
    : corners(element.corners);
  return {
    ...base("shape", box, geometry, element.opacity),
    style: {
      ...paint(element.fill, context.colors),
      ...rounded,
      ...border(element.border, context.colors),
      ...shadows(element.shadows, context.colors),
      shape: element.shape,
      ...(element.sides ? { sides: element.sides } : {}),
    },
  };
}

function renderLine(element: ShapeElement, box: Box, geometry: Geometry, context: RenderContext): RenderedElement {
  const fill = element.fill && !("stops" in element.fill) ? resolveColor(element.fill, context.colors) : context.colors.border;
  return {
    ...base("line", box, geometry, element.opacity),
    style: { color: fill, strokeWidth: Math.max(1, scale(element.thickness)) },
  };
}

/* ----------------------------------------------------------------- charts */

function renderChart(element: ChartElement, box: Box, geometry: Geometry, context: RenderContext): RenderedElement {
  const data = context.slide.chart;
  const values = data?.values ?? [];
  const authored = element.palette
    ? element.palette.map((color) => resolveColor(color, context.colors))
    : [...context.chartPalette];
  const series = extendChartPalette(authored, Math.max(values.length, authored.length), context.colors.background);

  return {
    ...base("chart", box, geometry, element.opacity),
    style: {
      color: resolveColor(element.color, context.colors),
      trackColor: resolveColor(element.trackColor, context.colors),
      labelColor: resolveColor(element.labelColor, context.colors),
      axisColor: resolveColor(element.axisColor, context.colors),
      series,
      labelSize: scale(element.labelSize),
      ...typeface({ ...emptyTextStyle, font: element.font, fontWeight: 500 }, context),
      showLegend: element.style.showLegend,
      showLabels: element.style.showLabels,
      showValues: element.style.showValues,
      showGrid: element.style.showGrid,
      showAxis: element.style.showAxis,
      cornerRadius: scale(element.style.cornerRadius),
      gap: scale(element.style.gap),
      strokeWidth: scale(element.style.strokeWidth),
    },
    content: {
      // `chartType` stays in the three-value vocabulary every renderer already
      // draws; `chartKind` carries what the design actually asked for, so a
      // renderer that learns `area` can honour it without a document change.
      chartType: CHART_FALLBACKS[element.chart] ?? "bar",
      chartKind: element.chart,
      labels: data?.labels ?? [],
      values,
    },
  };
}

const emptyTextStyle: TextStyle = {
  font: "font_1",
  fontSize: 20,
  fontWeight: 400,
  fontStyle: "normal",
  letterSpacing: 0,
  lineHeight: 1.2,
  align: "left",
  verticalAlign: "top",
  transform: "none",
  color: { role: "text" },
  maxLines: null,
  overflow: "shrink",
  minFontSize: MIN_FONT_SIZE,
  effect: "none",
  shadows: [],
  strokeWidth: 0,
  strokeColor: null,
  highlight: null,
  gradient: null,
  blur: 0,
};

/* ----------------------------------------------------------------- tables */

/**
 * A table sized to the data it actually received.
 *
 * The design declares how many rows it was drawn for; the slide may bring
 * fewer or more. Fewer means the rows simply grow into the box. More means the
 * type steps down — but only to the point where it is still readable, and past
 * that the table is truncated rather than rendered as a grey smear (§31).
 */
function renderTable(element: TableElement, box: Box, geometry: Geometry, context: RenderContext): RenderedElement | null {
  const data = context.slide.table;
  if (!data || data.rows.length === 0) return null;

  const columns = data.columns.length ? data.columns : Array.from({ length: element.columns }, () => "");
  const header = element.header && data.columns.length > 0;
  const wanted = data.rows.length + (header ? 1 : 0);
  const padding = scale(element.table.padding);
  const readable = Math.max(MIN_RENDER_FONT_SIZE, scale(element.table.cellSize) * 0.7);

  let cellSize = scale(element.table.cellSize);
  while (cellSize > readable && wanted * (cellSize * 1.4 + padding * 2) > box.height) cellSize -= 1;
  const rowHeight = cellSize * 1.4 + padding * 2;
  const capacity = Math.max(1, Math.floor(box.height / rowHeight));
  const rows = data.rows.slice(0, Math.max(1, capacity - (header ? 1 : 0)));

  const widths = element.table.columnWidths.length === columns.length
    ? element.table.columnWidths
    : Array.from({ length: columns.length }, () => 1 / columns.length);

  return {
    ...base("table", box, geometry, element.opacity),
    style: {
      ...corners(element.corners),
      ...border(element.table.border, context.colors),
      padding,
      align: element.table.align,
      columnWidths: widths,
      rowHeight: round2(rowHeight),
      headerBackground: element.table.headerBackground ? resolveColor(element.table.headerBackground, context.colors) : null,
      headerColor: resolveColor(element.table.headerColor, context.colors),
      headerSize: Math.min(scale(element.table.headerSize), cellSize * 1.2),
      ...prefixed("header", typeface({ ...emptyTextStyle, font: element.table.headerFont, fontWeight: 700 }, context)),
      cellBackground: element.table.cellBackground ? resolveColor(element.table.cellBackground, context.colors) : null,
      cellAltBackground: element.table.cellAltBackground ? resolveColor(element.table.cellAltBackground, context.colors) : null,
      cellColor: resolveColor(element.table.cellColor, context.colors),
      cellSize: round2(cellSize),
      ...prefixed("cell", typeface({ ...emptyTextStyle, font: element.table.cellFont, fontWeight: 400 }, context)),
    },
    content: {
      columns: header ? columns : [],
      rows,
      header,
      truncated: rows.length < data.rows.length,
    },
  };
}

function prefixed(prefix: string, values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [`${prefix}${key[0]!.toUpperCase()}${key.slice(1)}`, value]),
  );
}

/* ---------------------------------------------------------------- preview */

/**
 * The payload the design catalogue stores and the pickers draw (§28, §63).
 *
 * It is the real engine on deterministic sample content, so a thumbnail is
 * never an approximation of the design — it is the design, at one eighth the
 * size. The apps render it through the canvas they already have; nothing new
 * ships to a phone to make a preview appear.
 */
export function renderPreview(document: JslaydDocument, archetypeId?: string, familyCode?: string | null): RenderedSlide {
  const archetype = archetypeId
    ? document.archetypes.find((entry) => entry.id === archetypeId) ?? document.archetypes[0]!
    : document.archetypes.find((entry) => entry.purpose === "cover") ?? document.archetypes[0]!;
  const slide = previewSlide(archetype.purpose);
  // Image slots resolve to nothing, so the picker draws the design's own
  // placeholder treatment rather than a stock photograph the design never chose.
  return renderArchetype(document, archetype, slide, familyCode);
}

/** Every archetype rendered on sample content — the admin's all-slides grid. */
export function renderAllPreviews(document: JslaydDocument, familyCode?: string | null): { id: string; purpose: string; slide: RenderedSlide }[] {
  return document.archetypes.map((archetype, index) => ({
    id: archetype.id,
    purpose: archetype.purpose,
    slide: renderArchetype(document, archetype, previewSlide(archetype.purpose, index, document.archetypes.length), familyCode),
  }));
}
