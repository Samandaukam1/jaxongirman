import type {
  Blueprint,
  ChartSlot,
  ColorRole,
  Frame,
  IconSlot,
  ImageSlot,
  LayoutRecipe,
  PaletteFamily,
  ShapeSlot,
  Slot,
  SlotCondition,
  SlideTemplate,
  TextSlot,
} from "./design-types.ts";
import type { ElementRow, LayoutName, SemanticSlide } from "./presentation-types.ts";

export const MODEL_WIDTH = 1000;
export const MODEL_HEIGHT = 562.5;

/**
 * Average glyph advance for Manrope as a fraction of font size. Deno cannot
 * measure text, so line counts are estimated; `fit` keeps a margin for error and
 * `validateAndRepair` in layout.ts is the final safety net.
 */
const AVERAGE_GLYPH_RATIO = 0.53;
const LINE_HEIGHT_RATIO = 1.22;

export type SlideContext = {
  presentationId: string;
  ownerId: string;
  slideId: string;
  index: number;
  total: number;
  semantic: SemanticSlide;
  image: { bucket: string; path: string } | null;
  sources: readonly string[];
};

type Ids = Pick<SlideContext, "presentationId" | "ownerId" | "slideId">;

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function conditionHolds(condition: SlotCondition | undefined, context: SlideContext): boolean {
  const { semantic, image, sources } = context;
  switch (condition ?? "always") {
    case "always": return true;
    case "hasImage": return Boolean(image);
    case "noImage": return !image;
    case "hasStat": return Boolean(semantic.statistic);
    case "hasChart": return Boolean(semantic.chart);
    case "hasQuote": return Boolean(semantic.quote);
    case "hasBullets": return semantic.bullets.length > 0;
    case "hasBody": return Boolean(clean(semantic.body));
    case "hasSubtitle": return Boolean(clean(semantic.subtitle));
    case "hasSources": return sources.length > 0;
  }
}

/** Text bound to a slot role; `null` means the slot has nothing to show. */
function textForRole(slot: TextSlot, context: SlideContext): string | null {
  const { semantic, sources, index, total } = context;
  const fit = slot.fit ?? {};
  switch (slot.role) {
    case "title": return clean(semantic.title) || null;
    case "subtitle": return clean(semantic.subtitle) || null;
    case "body": return clean(semantic.body) || bulletBlock(semantic.bullets, fit.maxItems) || null;
    case "bullets": return bulletBlock(semantic.bullets, fit.maxItems) || clean(semantic.body) || null;
    case "statValue": return semantic.statistic ? clean(semantic.statistic.value) : null;
    case "statLabel": return semantic.statistic ? clean(semantic.statistic.label) : null;
    case "quoteText": return semantic.quote ? clean(semantic.quote.text) : null;
    case "quoteAttribution": return semantic.quote ? clean(semantic.quote.attribution) : null;
    case "sources":
      return sources.length
        ? sources.slice(0, fit.maxItems ?? 12).map((source, position) => `${position + 1}. ${clean(source)}`).join("\n")
        : "Manbalar kiritilmagan.";
    case "sectionLabel": return slot.literal ?? (clean(semantic.purpose) || null);
    case "brand": return slot.literal ?? "JAXONGIR AI";
    case "pageNumber": return `${index + 1} / ${total}`;
    default: return slot.literal ?? null;
  }
}

function bulletBlock(bullets: readonly string[], maxItems = 5): string {
  return bullets
    .slice(0, maxItems)
    .map(clean)
    .filter(Boolean)
    .map((item) => `•  ${item}`)
    .join("\n");
}

/** Below this the copy stops being readable, and validateAndRepair rejects it. */
const MIN_FONT = 12;

/**
 * Shrinks the font until the text fits, and never cuts a word: text deleted
 * here is gone from the deck for good, whereas a denser block is something the
 * author can still restyle in the editor.
 *
 * The first pass protects the composition — the drawn line budget at a size the
 * template calls acceptable. Only when the copy is longer than the slot was
 * drawn for does the second pass trade the line budget away and let the block
 * use the frame's full height.
 */
function fitText(value: string, slot: TextSlot, blueprint: Blueprint): { text: string; fontSize: number; maxLines: number } {
  const [, , width, height] = slot.frame;
  const start = blueprint.type[slot.font];
  const design = Math.max(MIN_FONT, slot.fit?.minFont ?? Math.round(start * 0.6));
  const hardLines = slot.fit?.maxLines ?? Math.max(1, Math.floor(height / (start * LINE_HEIGHT_RATIO)));

  const explicitLines = value.split("\n");
  const linesAt = (fontSize: number) => {
    const perLine = Math.max(1, Math.floor(width / (fontSize * AVERAGE_GLYPH_RATIO)));
    return explicitLines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
  };
  const roomAt = (fontSize: number) => Math.max(1, Math.floor(height / (fontSize * LINE_HEIGHT_RATIO)));

  for (let fontSize = start; fontSize >= design; fontSize -= 2) {
    const allowed = Math.min(hardLines, roomAt(fontSize));
    if (linesAt(fontSize) <= allowed) return { text: value, fontSize, maxLines: allowed };
  }
  for (let fontSize = design; fontSize >= MIN_FONT; fontSize -= 1) {
    const allowed = roomAt(fontSize);
    if (linesAt(fontSize) <= allowed) return { text: value, fontSize, maxLines: allowed };
  }
  return { text: value, fontSize: MIN_FONT, maxLines: roomAt(MIN_FONT) };
}

/**
 * Slots whose condition failed leave a hole. Any `grow` slot that sits above a
 * hole and overlaps it horizontally stretches down to reclaim the space, so a
 * slide without an image or chart still reads as a deliberate composition.
 */
function absorbGaps(frame: Frame, dropped: readonly Frame[]): Frame {
  const [x, y, width, height] = frame;
  let bottom = y + height;
  for (const [dx, dy, dw, dh] of dropped) {
    const overlap = Math.max(0, Math.min(x + width, dx + dw) - Math.max(x, dx));
    if (overlap < Math.min(width, dw) * 0.5) continue;
    if (dy + dh <= y) continue;
    bottom = Math.max(bottom, dy + dh);
  }
  return [x, y, width, bottom - y];
}

function baseRow(ids: Ids, type: ElementRow["type"], frame: Frame, z: number, style: Record<string, unknown>, content: Record<string, unknown>, opacity = 1): ElementRow {
  const [x, y, width, height] = frame;
  return {
    id: crypto.randomUUID(),
    slide_id: ids.slideId,
    presentation_id: ids.presentationId,
    owner_id: ids.ownerId,
    type,
    x, y, width, height,
    rotation: 0,
    z_index: z,
    opacity,
    locked: false,
    style,
    content,
  };
}

/** Manrope is the default voice; templates may name other families per role. */
function manrope(weight: number): string {
  if (weight >= 700) return "Manrope_700Bold";
  if (weight >= 600) return "Manrope_600SemiBold";
  if (weight >= 500) return "Manrope_500Medium";
  return "Manrope_400Regular";
}

function fontFamily(slot: TextSlot, blueprint: Blueprint): string {
  const role = slot.family ?? "body";
  const named = blueprint.fonts?.[role];
  if (named) return named;
  return manrope(slot.weight ?? 400);
}

function renderText(slot: TextSlot, frame: Frame, context: SlideContext, template: SlideTemplate, colors: (role: ColorRole) => string): ElementRow | null {
  const value = textForRole(slot, context);
  if (!value) return null;
  const shaped = fitText(slot.transform === "upper" ? value.toLocaleUpperCase("uz") : value, { ...slot, frame }, template.blueprint);
  const weight = slot.weight ?? 400;
  // Script faces need more leading than a grotesque at the same size.
  const lineHeight = Math.round(shaped.fontSize * (slot.family === "script" ? 1.34 : LINE_HEIGHT_RATIO));
  return baseRow(context, "text", frame, slot.z ?? 5, {
    color: colors(slot.color),
    fontSize: shaped.fontSize,
    lineHeight,
    fontWeight: String(weight),
    fontFamily: fontFamily(slot, template.blueprint),
    textAlign: slot.align ?? "left",
    letterSpacing: slot.letterSpacing ?? 0,
  }, { text: shaped.text, maxLines: shaped.maxLines });
}

function renderShape(slot: ShapeSlot, context: SlideContext, template: SlideTemplate, colors: (role: ColorRole) => string): ElementRow {
  const [, , width, height] = slot.frame;
  const radius = slot.round === "full" ? Math.min(width, height) / 2 : slot.round ?? template.blueprint.radius.card;
  return baseRow(context, "shape", slot.frame, slot.z ?? 1, {
    fill: colors(slot.color),
    borderRadius: radius,
    ...(slot.gradientTo ? { gradientTo: colors(slot.gradientTo), gradientAngle: slot.gradientAngle ?? 135 } : {}),
    ...(slot.outline ? { stroke: colors(slot.outline), strokeWidth: slot.outlineWidth ?? 1 } : {}),
    ...(slot.shadow ? { shadow: true } : {}),
  }, {}, slot.opacity ?? 1);
}

function renderImage(slot: ImageSlot, frame: Frame, context: SlideContext, template: SlideTemplate): ElementRow | null {
  if (!context.image) return null;
  const [, , width, height] = frame;
  const radius = slot.mask === "circle" ? Math.min(width, height) / 2 : slot.radius ?? template.blueprint.radius.image;
  return baseRow(context, "image", frame, slot.z ?? 3, { objectFit: "cover", borderRadius: radius }, {
    storageBucket: context.image.bucket,
    storagePath: context.image.path,
  });
}

function renderChart(slot: ChartSlot, frame: Frame, context: SlideContext, palette: PaletteFamily, colors: (role: ColorRole) => string): ElementRow | null {
  const chart = context.semantic.chart;
  if (!chart) return null;
  return baseRow(context, "chart", frame, slot.z ?? 4, {
    color: colors(slot.color),
    trackColor: colors(slot.trackColor ?? "surfaceAlt"),
    labelColor: colors(slot.labelColor ?? "textSecondary"),
    series: palette.tokens.chartSeries,
  }, { chartType: slot.chart, labels: chart.labels, values: chart.values });
}

function renderIcon(slot: IconSlot, context: SlideContext, colors: (role: ColorRole) => string): ElementRow {
  return baseRow(context, "icon", slot.frame, slot.z ?? 4, { color: colors(slot.color) }, { icon: slot.icon });
}

/**
 * Resolves a layout to one concrete recipe. When a layout offers several
 * compositions the slide's position selects among them, giving the deck rhythm
 * instead of repeating one arrangement.
 */
function recipeFor(blueprint: Blueprint, layout: LayoutName, index: number): LayoutRecipe {
  // A closing slide carries one line, which is exactly what a conclusion recipe
  // is drawn for once its bullet slots fall away and the headline absorbs them.
  const named = layout === "thanks" ? blueprint.layouts.thanks ?? blueprint.layouts.conclusion : blueprint.layouts[layout];
  const entry = named ?? blueprint.fallback;
  if (!Array.isArray(entry)) return entry as LayoutRecipe;
  const variants = entry as readonly LayoutRecipe[];
  return variants[index % variants.length] ?? variants[0]!;
}

/** Renders one slide's elements plus its background colour. */
export function renderSlide(template: SlideTemplate, palette: PaletteFamily, context: SlideContext): { background: string; elements: ElementRow[] } {
  const colors = (role: ColorRole) => palette.tokens[role];
  const recipe = recipeFor(template.blueprint, context.semantic.layout, context.index);

  const dropped: Frame[] = [];
  const kept: Slot[] = [];
  for (const slot of recipe.slots) {
    if (conditionHolds(slot.when, context)) kept.push(slot);
    else dropped.push(slot.frame);
  }

  const elements: ElementRow[] = [];
  for (const slot of kept) {
    const frame = "grow" in slot && slot.grow ? absorbGaps(slot.frame, dropped) : slot.frame;
    let row: ElementRow | null = null;
    switch (slot.kind) {
      case "text": row = renderText(slot, frame, context, template, colors); break;
      case "shape": row = renderShape(slot, context, template, colors); break;
      case "image": row = renderImage(slot, frame, context, template); break;
      case "chart": row = renderChart(slot, frame, context, palette, colors); break;
      case "icon": row = renderIcon(slot, context, colors); break;
    }
    if (row) elements.push(row);
  }

  return { background: colors(recipe.background ?? "background"), elements };
}

/**
 * Palette-independent element list used by the mobile picker. Colours stay as
 * role names so the app can recolour a thumbnail without re-running the engine.
 */
export function renderPreview(template: SlideTemplate): { background: ColorRole; elements: Array<Record<string, unknown>> } {
  const placeholder: SemanticSlide = {
    title: "G'oyangizni taqdimotga aylantiring",
    subtitle: "Jaxongir AI tomonidan tayyorlangan",
    purpose: "Namuna",
    layout: template.previewLayout,
    bullets: ["Aniq tuzilma va o'qilishi oson iyerarxiya", "Mavzuga mos vizual yechim", "Amaliy xulosa"],
    body: "Namunaviy matn bloki shablon ritmini ko'rsatadi.",
    quote: { text: "Yaxshi dizayn — ko'rinmaydigan tartib.", attribution: "Dieter Rams" },
    statistic: { value: "68%", label: "auditoriya yaxshi eslab qoladi" },
    chart: { type: "donut", labels: ["A", "B", "C"], values: [48, 32, 20] },
    visualPrompt: null,
  };

  const recipe = recipeFor(template.blueprint, template.previewLayout, 0);
  const identity = (role: ColorRole) => role as unknown as string;
  const context: SlideContext = {
    presentationId: "00000000-0000-4000-8000-000000000000",
    ownerId: "00000000-0000-4000-8000-000000000000",
    slideId: "00000000-0000-4000-8000-000000000000",
    index: 0,
    total: 8,
    semantic: placeholder,
    image: null,
    sources: [],
  };

  const elements: Array<Record<string, unknown>> = [];
  const dropped: Frame[] = [];
  const kept = recipe.slots.filter((slot) => {
    const holds = conditionHolds(slot.when, context);
    if (!holds) dropped.push(slot.frame);
    return holds;
  });

  for (const slot of kept) {
    const frame = "grow" in slot && slot.grow ? absorbGaps(slot.frame, dropped) : slot.frame;
    let row: ElementRow | null = null;
    switch (slot.kind) {
      case "text": row = renderText(slot, frame, context, template, identity); break;
      case "shape": row = renderShape(slot, context, template, identity); break;
      case "chart": row = renderChart(slot, frame, context, { tokens: { chartSeries: ["chartA", "chartB", "chartC", "chartD"] } } as unknown as PaletteFamily, identity); break;
      case "icon": row = renderIcon(slot, context, identity); break;
      case "image": row = null; break;
    }
    if (row) {
      const { id: _id, slide_id: _s, presentation_id: _p, owner_id: _o, ...rest } = row;
      elements.push(rest as Record<string, unknown>);
    }
  }

  return { background: recipe.background ?? "background", elements };
}
