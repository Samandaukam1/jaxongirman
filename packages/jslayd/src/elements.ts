import type {
  ChartElement,
  ChartStyle,
  ColorValue,
  FontDeclaration,
  Geometry,
  Gradient,
  GroupElement,
  IconElement,
  ImageElement,
  JslaydElement,
  ListElement,
  ShapeElement,
  StatElement,
  TableElement,
  TableStyle,
  TextElement,
  TextSource,
  TextStyle,
} from "./document.ts";
import { DiagnosticBag, nearestName } from "./diagnostics.ts";
import { findNode, type ParseNode, type ParseSection } from "./parser.ts";
import {
  ANCHORS,
  CHART_FALLBACKS,
  CHART_KINDS,
  CONDITIONS,
  COORDINATE_MAX,
  COORDINATE_MIN,
  ELEMENT_TYPES,
  FONT_ROLES,
  FONT_STYLES,
  IMAGE_FITS,
  IMAGE_ORIENTATIONS,
  IMAGE_QUERY_SOURCES,
  IMAGE_SOURCE_STRATEGIES,
  LIMITS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  OVERFLOW_MODES,
  SHAPE_KINDS,
  TEXT_ALIGNMENTS,
  TEXT_EFFECTS,
  TEXT_TRANSFORMS,
  VERTICAL_ALIGNMENTS,
  type Anchor,
  type ChartKind,
  type Condition,
  type ElementType,
  type FontRole,
} from "./spec.ts";
import {
  clampUnit,
  coerceBinding,
  coerceEnum,
  readBoolean,
  readBorder,
  readColor,
  readCorners,
  readEnum,
  readGradient,
  readInteger,
  readNumber,
  readShadows,
  readString,
  rejectDuplicateKeys,
  rejectUnknownKeys,
  splitList,
} from "./values.ts";

/**
 * Element compilation.
 *
 * One reader per element type, each declaring the exact key set it consumes.
 * The union of those keys and the geometry keys is what `rejectUnknownKeys`
 * checks against, so adding a property to the language is a two-line change
 * here and impossible to forget: an unlisted key is an error at the next
 * compile of any design that uses it.
 */

/** What every element reader receives before its own properties are read. */
type ElementBaseInput = { id: string; geometry: Geometry; when: Condition; opacity: number; grow: boolean };

/** Defaults handed down from `[GLOBAL]`. */
export type ElementDefaults = {
  margin: number;
  titleFont: string | null;
  bodyFont: string | null;
  accentFont: string | null;
  headingColor: ColorValue | null;
  textColor: ColorValue | null;
  imageStrategy: (typeof IMAGE_SOURCE_STRATEGIES)[number];
  chart: ChartStyle;
};

const GEOMETRY_KEYS = ["type", "x", "y", "width", "height", "rotation", "zIndex", "anchor", "opacity", "when", "parent", "grow"];

const TEXT_STYLE_KEYS = [
  "font", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
  "align", "verticalAlign", "textTransform", "color", "maxLines", "overflow", "minFontSize",
  "effect", "shadow", "shadows", "strokeWidth", "strokeColor", "highlight", "gradientText", "blur",
];

const BOX_KEYS = [
  "borderRadius", "topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius",
  "borderWidth", "borderColor", "borderStyle", "borderOpacity",
];

export function compileElement(
  id: string,
  section: ParseSection,
  fonts: readonly FontDeclaration[],
  defaults: ElementDefaults,
  bag: DiagnosticBag,
): { element: JslaydElement; parent: string | null } | null {
  const nodes = section.properties;
  rejectDuplicateKeys(nodes, ["shadow", "shadows"], bag);

  const typeNode = findNode(nodes, "type");
  if (!typeNode) {
    bag.error("missing_property", "`type` ko'rsatilmagan.", section.line, `Ruxsat etilganlar: ${ELEMENT_TYPES.join(", ")}.`);
    return null;
  }
  const type = coerceEnum(typeNode.value, "type", ELEMENT_TYPES, typeNode.line, bag);
  if (!type) return null;

  const geometry = readGeometry(nodes, section.line, bag);
  const when = readEnum(nodes, "when", CONDITIONS, bag) ?? "always";
  const opacity = clampUnit(readNumber(nodes, "opacity", bag, { min: 0, max: 1 }) ?? 1);
  const parent = readString(nodes, "parent", bag, LIMITS.identifierLength) ?? null;
  const grow = readBoolean(nodes, "grow", bag) ?? false;
  const base = { id, geometry, when: when as Condition, opacity, grow };

  const element = buildElement(type, base, nodes, section, fonts, defaults, bag);
  return element ? { element, parent } : null;
}

function buildElement(
  type: ElementType,
  base: ElementBaseInput,
  nodes: readonly ParseNode[],
  section: ParseSection,
  fonts: readonly FontDeclaration[],
  defaults: ElementDefaults,
  bag: DiagnosticBag,
): JslaydElement | null {
  switch (type) {
    case "text":
    case "quote":
    case "number":
    case "badge":
      return textElement(type, base, nodes, section, fonts, defaults, bag);
    case "image":
    case "frame":
      return imageElement(type, base, nodes, section, defaults, bag);
    case "shape":
    case "divider":
    case "decorative":
    case "line":
      return shapeElement(type, base, nodes, section, bag);
    case "icon":
      return iconElement(base, nodes, section.line, bag);
    case "chart":
      return chartElement(base, nodes, section, fonts, defaults, bag);
    case "table":
      return tableElement(base, nodes, section, fonts, defaults, bag);
    case "stat":
      return statElement(base, nodes, section, fonts, defaults, bag);
    case "list":
      return listElement(base, nodes, section, fonts, defaults, bag);
    case "group":
      return groupElement(base, nodes, bag);
  }
}

/* ---------------------------------------------------------------- geometry */

/**
 * Canonical geometry.
 *
 * `anchor` is resolved away here (§20): the author may measure from a centre or
 * a corner, but everything downstream — renderer, exporter, overflow analyzer —
 * sees one absolute top-left box in canvas units.
 */
function readGeometry(nodes: readonly ParseNode[], line: number, bag: DiagnosticBag): Geometry {
  const bounds = { min: COORDINATE_MIN, max: COORDINATE_MAX };
  const required = (key: string, fallback: number) => {
    const value = readNumber(nodes, key, bag, bounds);
    if (value === undefined && !findNode(nodes, key)) {
      bag.error("missing_property", `\`${key}\` ko'rsatilmagan.`, line, "Har bir element x, y, width va height talab qiladi.");
    }
    return value ?? fallback;
  };
  const width = Math.max(1, required("width", 100));
  const height = Math.max(1, required("height", 100));
  const anchor = (readEnum(nodes, "anchor", ANCHORS, bag) ?? "top-left") as Anchor;
  const x = required("x", 0);
  const y = required("y", 0);
  const [horizontal, vertical] = anchorOffsets(anchor);

  return {
    x: round(x - width * horizontal),
    y: round(y - height * vertical),
    width: round(width),
    height: round(height),
    rotation: round(readNumber(nodes, "rotation", bag, { min: -360, max: 360 }) ?? 0),
    zIndex: readInteger(nodes, "zIndex", bag, { min: -1000, max: 1000 }) ?? 1,
    anchor,
  };
}

/** Fractions of width and height to subtract to reach the top-left corner. */
function anchorOffsets(anchor: Anchor): [number, number] {
  // Bare `center` is the one anchor with no hyphen; it means centred in both.
  if (anchor === "center") return [0.5, 0.5];
  const [vertical, horizontal] = anchor.split("-") as [string, string];
  const scale = (part: string) => (part === "center" ? 0.5 : part === "right" || part === "bottom" ? 1 : 0);
  return [scale(horizontal), scale(vertical)];
}

/** Two decimals. Enough for sub-pixel placement, few enough to hash stably. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/* -------------------------------------------------------------------- text */

const TEXT_KEYS = [...GEOMETRY_KEYS, ...TEXT_STYLE_KEYS, ...BOX_KEYS, "bind", "text", "background", "backgroundGradient", "padding"];

function textElement(
  type: "text" | "quote" | "number" | "badge",
  base: ElementBaseInput,
  nodes: readonly ParseNode[],
  section: ParseSection,
  fonts: readonly FontDeclaration[],
  defaults: ElementDefaults,
  bag: DiagnosticBag,
): TextElement | null {
  rejectUnknownKeys(nodes, TEXT_KEYS, `\`${type}\` element`, bag);
  const source = readTextSource(nodes, section.line, bag);
  if (!source) return null;

  const gradient = readGradient(nodes, "backgroundGradient", bag);
  const background: ColorValue | Gradient | null = gradient ?? readColor(nodes, "background", bag) ?? null;

  return {
    ...base,
    type,
    source,
    text: readTextStyle(nodes, "", fonts, section.line, bag, defaultsForType(type, defaults)),
    background,
    corners: readCorners(nodes, bag) ?? null,
    border: readBorder(nodes, bag) ?? null,
    padding: readNumber(nodes, "padding", bag, { min: 0, max: 400 }) ?? (type === "badge" ? 16 : 0),
  };
}

function defaultsForType(type: string, defaults: ElementDefaults): { font: string | null; color: ColorValue | null } {
  if (type === "text" || type === "number") return { font: defaults.titleFont, color: defaults.headingColor };
  return { font: defaults.bodyFont, color: defaults.textColor };
}

/** `bind: {{title}}` or `text: literal`. Exactly one of the two (§38). */
function readTextSource(nodes: readonly ParseNode[], line: number, bag: DiagnosticBag): TextSource | null {
  const bindNode = findNode(nodes, "bind");
  const literalNode = findNode(nodes, "text");
  if (bindNode && literalNode) {
    bag.error("conflicting_source", "`bind` va `text` bir vaqtda berilgan.", literalNode.line, "Faqat bittasini qoldiring.");
    return null;
  }
  if (bindNode) {
    const binding = coerceBinding(bindNode.value, "bind", bindNode.line, bag);
    return binding ? { bind: binding } : null;
  }
  if (literalNode) {
    if (!literalNode.value) {
      bag.error("empty_value", "`text` bo'sh.", literalNode.line);
      return null;
    }
    if (literalNode.value.length > LIMITS.textLength) {
      bag.error("value_too_long", `\`text\` juda uzun (${literalNode.value.length} belgi).`, literalNode.line, `Chegara ${LIMITS.textLength}.`);
      return { literal: literalNode.value.slice(0, LIMITS.textLength) };
    }
    return { literal: literalNode.value };
  }
  bag.error("missing_property", "`bind` yoki `text` ko'rsatilmagan.", line, "Matn elementi qayerdan matn olishini bildirishi kerak.");
  return null;
}

/**
 * A text style block, optionally prefixed (`valueFontSize`, `labelColor`) so a
 * stat card can carry two complete styles in one element without a nested
 * grammar the author has to learn.
 */
function readTextStyle(
  nodes: readonly ParseNode[],
  prefix: string,
  fonts: readonly FontDeclaration[],
  line: number,
  bag: DiagnosticBag,
  seed: { font: string | null; color: ColorValue | null },
  fontSizeFallback?: number,
): TextStyle {
  const key = (name: string) => (prefix ? prefix + name[0]!.toUpperCase() + name.slice(1) : name);

  const fontNode = findNode(nodes, key("font"));
  const font = fontNode
    ? resolveFont(fontNode.value, key("font"), fontNode.line, fonts, bag)
    : seed.font ?? fonts[0]?.id ?? "font_1";

  let fontSize = readNumber(nodes, key("fontSize"), bag, { min: MIN_FONT_SIZE, max: MAX_FONT_SIZE });
  if (fontSize === undefined && !findNode(nodes, key("fontSize"))) {
    if (fontSizeFallback === undefined) {
      bag.error("missing_property", `\`${key("fontSize")}\` ko'rsatilmagan.`, line, "Matn o'lchami aniq yozilishi kerak.");
      fontSize = 40;
    } else {
      fontSize = fontSizeFallback;
    }
  }
  const size = fontSize ?? fontSizeFallback ?? 40;

  const effect = (readEnum(nodes, key("effect"), TEXT_EFFECTS, bag) ?? "none");
  const shadows = readShadows(nodes.filter((node) => node.key === key("shadow") || node.key === key("shadows")), bag);
  const gradient = readGradient(nodes, key("gradientText"), bag) ?? null;
  const strokeColor = readColor(nodes, key("strokeColor"), bag) ?? null;
  const highlight = readColor(nodes, key("highlight"), bag) ?? null;
  const blur = readNumber(nodes, key("blur"), bag, { min: 0, max: 100 }) ?? 0;

  // An effect that names no supporting value draws nothing, and a value with no
  // effect is dead weight. Saying both out loud is §11's whole requirement.
  if (effect === "stroke" || effect === "outline") {
    if (!strokeColor) bag.warn("effect_without_value", `\`${key("effect")}: ${effect}\` uchun \`${key("strokeColor")}\` yo'q.`, line, "Kontur chizilmaydi.");
  }
  if (effect === "highlight" && !highlight) {
    bag.warn("effect_without_value", `\`${key("effect")}: highlight\` uchun \`${key("highlight")}\` rangi yo'q.`, line);
  }
  if (effect === "gradientText" && !gradient) {
    bag.warn("effect_without_value", `\`${key("effect")}: gradientText\` uchun \`${key("gradientText")}\` yo'q.`, line);
  }
  if (effect === "shadow" && shadows.length === 0) {
    bag.warn("effect_without_value", `\`${key("effect")}: shadow\` uchun \`${key("shadow")}\` yo'q.`, line);
  }
  if (effect === "gradientText") {
    bag.warn(
      "export_degradation",
      "Gradient matn PPTX eksportida bir rangga aylanadi.",
      line,
      "PowerPoint matn gradientini bu eksport yo'lida tashiy olmaydi.",
    );
  }

  const minFontSize = readNumber(nodes, key("minFontSize"), bag, { min: MIN_FONT_SIZE, max: MAX_FONT_SIZE });
  if (minFontSize !== undefined && minFontSize > size) {
    bag.error("bad_min_font", `\`${key("minFontSize")}\` (${minFontSize}) \`${key("fontSize")}\` (${size}) dan katta.`, line);
  }

  return {
    font,
    fontSize: round(size),
    fontWeight: readInteger(nodes, key("fontWeight"), bag, { min: 100, max: 900 }) ?? 400,
    fontStyle: readEnum(nodes, key("fontStyle"), FONT_STYLES, bag) ?? "normal",
    letterSpacing: round(readNumber(nodes, key("letterSpacing"), bag, { min: -20, max: 60 }) ?? 0),
    lineHeight: round(readNumber(nodes, key("lineHeight"), bag, { min: 0.6, max: 4 }) ?? 1.2),
    align: readEnum(nodes, key("align"), TEXT_ALIGNMENTS, bag) ?? "left",
    verticalAlign: readEnum(nodes, key("verticalAlign"), VERTICAL_ALIGNMENTS, bag) ?? "top",
    transform: readEnum(nodes, key("textTransform"), TEXT_TRANSFORMS, bag) ?? "none",
    color: readColor(nodes, key("color"), bag) ?? seed.color ?? { role: "text" },
    maxLines: readInteger(nodes, key("maxLines"), bag, { min: 1, max: 60 }) ?? null,
    overflow: readEnum(nodes, key("overflow"), OVERFLOW_MODES, bag) ?? "shrink",
    minFontSize: round(Math.min(minFontSize ?? Math.max(MIN_FONT_SIZE, size * 0.6), size)),
    effect,
    shadows,
    strokeWidth: round(readNumber(nodes, key("strokeWidth"), bag, { min: 0, max: 40 }) ?? 0),
    strokeColor,
    highlight,
    gradient,
    blur: round(blur),
  };
}

function resolveFont(raw: string, key: string, line: number, fonts: readonly FontDeclaration[], bag: DiagnosticBag): string {
  const value = raw.trim();
  const byId = fonts.find((font) => font.id === value);
  if (byId) return byId.id;
  if ((FONT_ROLES as readonly string[]).includes(value)) {
    const byRole = fonts.find((font) => font.roles.includes(value as FontRole));
    if (byRole) return byRole.id;
    bag.warn("font_role_unassigned", `\`${key}\`: \`${value}\` roliga shrift tayinlanmagan.`, line, "`font_1` ishlatiladi.");
    return fonts[0]?.id ?? "font_1";
  }
  const names = [...fonts.map((font) => font.id), ...FONT_ROLES];
  const suggestion = nearestName(value, names);
  bag.error("unknown_font", `\`${key}\`: noma'lum shrift "${value}".`, line, suggestion ? `Balki "${suggestion}"?` : `Ruxsat etilganlar: ${names.join(", ")}.`);
  return fonts[0]?.id ?? "font_1";
}

/* ------------------------------------------------------------------- image */

const IMAGE_KEYS = [
  ...GEOMETRY_KEYS, ...BOX_KEYS, "shadow", "shadows",
  "slot", "bind", "sourceStrategy", "imageRequired", "queryFrom", "queryStrategy",
  "orientation", "stylePreference", "fit", "focusX", "focusY", "overlay", "overlayGradient", "overlayOpacity",
];

function imageElement(
  type: "image" | "frame",
  base: ElementBaseInput,
  nodes: readonly ParseNode[],
  section: ParseSection,
  defaults: ElementDefaults,
  bag: DiagnosticBag,
): ImageElement {
  rejectUnknownKeys(nodes, IMAGE_KEYS, `\`${type}\` element`, bag);

  const bindNode = findNode(nodes, "bind");
  const binding = bindNode ? coerceBinding(bindNode.value, "bind", bindNode.line, bag) : undefined;
  const strategy = readEnum(nodes, "sourceStrategy", IMAGE_SOURCE_STRATEGIES, bag) ?? defaults.imageStrategy;

  const queryNode = findNode(nodes, "queryFrom") ?? findNode(nodes, "queryStrategy");
  const queryFrom: string[] = [];
  if (queryNode) {
    // `queryFrom` also accepts an indented list, which is how §26 writes it.
    const parts = queryNode.children.length
      ? queryNode.children.map((child) => child.key)
      : splitList(queryNode.value.replace(/^-\s*/gm, ""));
    for (const part of parts) {
      const value = coerceEnum(part.replace(/^-\s*/, ""), "queryFrom", IMAGE_QUERY_SOURCES, queryNode.line, bag);
      if (value && !queryFrom.includes(value)) queryFrom.push(value);
    }
  }
  if (strategy === "internet_search" && queryFrom.length === 0) {
    bag.info("default_query", "`queryFrom` berilmagan; qidiruv slayd sarlavhasidan tuziladi.", section.line);
    queryFrom.push("slide_title");
  }
  if (strategy === "none" && binding) {
    bag.warn("unused_binding", "`sourceStrategy: none` bo'lgani uchun `bind` ishlatilmaydi.", bindNode?.line ?? section.line);
  }

  const slot = readString(nodes, "slot", bag, LIMITS.identifierLength) ?? base.id;
  const gradient = readGradient(nodes, "overlayGradient", bag);

  return {
    ...base,
    type,
    slot,
    source: binding ? { bind: binding } : null,
    strategy,
    required: readBoolean(nodes, "imageRequired", bag) ?? false,
    queryFrom,
    orientation: readEnum(nodes, "orientation", IMAGE_ORIENTATIONS, bag) ?? "landscape",
    stylePreference: readString(nodes, "stylePreference", bag, 200) ?? null,
    fit: readEnum(nodes, "fit", IMAGE_FITS, bag) ?? "cover",
    focus: {
      x: clampUnit(readNumber(nodes, "focusX", bag, { min: 0, max: 1 }) ?? 0.5),
      y: clampUnit(readNumber(nodes, "focusY", bag, { min: 0, max: 1 }) ?? 0.5),
    },
    corners: readCorners(nodes, bag) ?? null,
    border: readBorder(nodes, bag) ?? null,
    shadows: readShadows(nodes, bag),
    overlay: gradient ?? readColor(nodes, "overlay", bag) ?? null,
    overlayOpacity: clampUnit(readNumber(nodes, "overlayOpacity", bag, { min: 0, max: 1 }) ?? 0.35),
  };
}

/* ------------------------------------------------------------------ shapes */

const SHAPE_KEYS = [...GEOMETRY_KEYS, ...BOX_KEYS, "shadow", "shadows", "shape", "fill", "gradient", "sides", "thickness"];

function shapeElement(
  type: "shape" | "divider" | "decorative" | "line",
  base: ElementBaseInput,
  nodes: readonly ParseNode[],
  section: ParseSection,
  bag: DiagnosticBag,
): ShapeElement {
  rejectUnknownKeys(nodes, SHAPE_KEYS, `\`${type}\` element`, bag);

  const declared = readEnum(nodes, "shape", SHAPE_KINDS, bag);
  const shape = declared ?? (type === "line" || type === "divider" ? "line" : "rectangle");
  const gradient = readGradient(nodes, "gradient", bag);
  const fill = gradient ?? readColor(nodes, "fill", bag) ?? null;

  let sides: number | null = null;
  const sidesNode = findNode(nodes, "sides");
  if (sidesNode) {
    sides = readInteger(nodes, "sides", bag, { min: 3, max: 24 }) ?? null;
    if (shape !== "polygon") bag.warn("unused_property", "`sides` faqat `shape: polygon` uchun ishlaydi.", sidesNode.line);
  } else if (shape === "polygon") {
    bag.error("missing_property", "`shape: polygon` uchun `sides` ko'rsatilmagan.", section.line);
  }

  if (!fill && shape !== "line") {
    bag.warn("shape_without_fill", "`fill` yo'q — shakl ko'rinmaydi.", section.line, "Rang yoki `gradient` bering.");
  }

  return {
    ...base,
    type,
    shape,
    fill,
    corners: readCorners(nodes, bag) ?? null,
    border: readBorder(nodes, bag) ?? null,
    shadows: readShadows(nodes, bag),
    sides,
    thickness: round(readNumber(nodes, "thickness", bag, { min: 0.5, max: 200 }) ?? (type === "divider" || type === "line" ? 2 : 0)),
  };
}

/* ------------------------------------------------------------------- icons */

const ICON_KEYS = [...GEOMETRY_KEYS, "icon", "color", "strokeWidth"];

function iconElement(
  base: ElementBaseInput,
  nodes: readonly ParseNode[],
  line: number,
  bag: DiagnosticBag,
): IconElement | null {
  rejectUnknownKeys(nodes, ICON_KEYS, "`icon` element", bag);
  const icon = readString(nodes, "icon", bag, 64);
  if (!icon) {
    bag.error("missing_property", "`icon` ko'rsatilmagan.", line, "Lucide ikonka nomini yozing, masalan `Target`.");
    return null;
  }
  if (!/^[A-Z][A-Za-z0-9]*$/.test(icon)) {
    bag.error("bad_icon", `Ikonka nomi noto'g'ri: "${icon}".`, findNode(nodes, "icon")?.line ?? line, "Lucide nomlari PascalCase: `ArrowRight`.");
    return null;
  }
  return {
    ...base,
    type: "icon",
    icon,
    color: readColor(nodes, "color", bag) ?? { role: "text" },
    strokeWidth: round(readNumber(nodes, "strokeWidth", bag, { min: 0.5, max: 8 }) ?? 1.85),
  };
}

/* ------------------------------------------------------------------ charts */

const CHART_KEYS = [
  ...GEOMETRY_KEYS, "chart", "bind", "chartPalette", "color", "trackColor", "labelColor", "axisColor", "font", "labelSize",
  "showLegend", "showLabels", "showValues", "showGrid", "showAxis", "cornerRadius", "gap", "strokeWidth",
];

function chartElement(
  base: ElementBaseInput,
  nodes: readonly ParseNode[],
  section: ParseSection,
  fonts: readonly FontDeclaration[],
  defaults: ElementDefaults,
  bag: DiagnosticBag,
): ChartElement | null {
  rejectUnknownKeys(nodes, CHART_KEYS, "`chart` element", bag);

  const chart = readEnum(nodes, "chart", CHART_KINDS, bag);
  if (!chart) {
    bag.error("missing_property", "`chart` turi ko'rsatilmagan.", section.line, `Ruxsat etilganlar: ${CHART_KINDS.join(", ")}.`);
    return null;
  }
  const drawn = CHART_FALLBACKS[chart as ChartKind];
  if (drawn && !["bar", "line", "donut"].includes(chart)) {
    bag.warn(
      "chart_degraded",
      `\`${chart}\` diagrammasi hozircha \`${drawn}\` ko'rinishida chiziladi.`,
      section.line,
      "Renderer bu turni to'liq qo'llagach, avtomatik to'g'ri chiziladi.",
    );
  }

  const bindNode = findNode(nodes, "bind");
  const binding = bindNode ? coerceBinding(bindNode.value, "bind", bindNode.line, bag) : undefined;
  if (!binding) {
    bag.error("missing_property", "`bind` ko'rsatilmagan.", section.line, "Diagramma `{{chart_data}}` ga bog'lanishi kerak.");
    return null;
  }

  const paletteNode = findNode(nodes, "chartPalette");
  let palette: ColorValue[] | null = null;
  if (paletteNode) {
    palette = [];
    for (const part of splitList(paletteNode.value)) {
      const color = readColorLiteral(part, "chartPalette", paletteNode.line, bag);
      if (color) palette.push(color);
    }
    if (palette.length === 0) palette = null;
  }

  const fontNode = findNode(nodes, "font");
  return {
    ...base,
    type: "chart",
    chart,
    source: { bind: binding },
    palette,
    color: readColor(nodes, "color", bag) ?? { role: "primary" },
    trackColor: readColor(nodes, "trackColor", bag) ?? { role: "surfaceAlt" },
    labelColor: readColor(nodes, "labelColor", bag) ?? { role: "textSecondary" },
    axisColor: readColor(nodes, "axisColor", bag) ?? { role: "border" },
    style: {
      showLegend: readBoolean(nodes, "showLegend", bag) ?? defaults.chart.showLegend,
      showLabels: readBoolean(nodes, "showLabels", bag) ?? defaults.chart.showLabels,
      showValues: readBoolean(nodes, "showValues", bag) ?? defaults.chart.showValues,
      showGrid: readBoolean(nodes, "showGrid", bag) ?? defaults.chart.showGrid,
      showAxis: readBoolean(nodes, "showAxis", bag) ?? defaults.chart.showAxis,
      cornerRadius: round(readNumber(nodes, "cornerRadius", bag, { min: 0, max: 200 }) ?? defaults.chart.cornerRadius),
      gap: round(readNumber(nodes, "gap", bag, { min: 0, max: 200 }) ?? defaults.chart.gap),
      // On a doughnut this is the ring thickness, not a hairline, so the
      // ceiling has to clear a chunky ring on the 1920-wide canvas.
      strokeWidth: round(readNumber(nodes, "strokeWidth", bag, { min: 0, max: 240 }) ?? defaults.chart.strokeWidth),
    },
    font: fontNode ? resolveFont(fontNode.value, "font", fontNode.line, fonts, bag) : defaults.bodyFont ?? fonts[0]?.id ?? "font_1",
    labelSize: round(readNumber(nodes, "labelSize", bag, { min: MIN_FONT_SIZE, max: 120 }) ?? 22),
  };
}

function readColorLiteral(raw: string, key: string, line: number, bag: DiagnosticBag): ColorValue | null {
  const nodes: ParseNode[] = [{ key, value: raw, line, indent: 0, children: [] }];
  return readColor(nodes, key, bag) ?? null;
}

/* ------------------------------------------------------------------ tables */

const TABLE_KEYS = [
  ...GEOMETRY_KEYS, ...BOX_KEYS, "bind", "columns", "rows", "header",
  "headerBackground", "headerColor", "headerFont", "headerSize",
  "cellBackground", "cellAltBackground", "cellColor", "cellFont", "cellSize",
  "padding", "align", "columnWidths",
];

function tableElement(
  base: ElementBaseInput,
  nodes: readonly ParseNode[],
  section: ParseSection,
  fonts: readonly FontDeclaration[],
  defaults: ElementDefaults,
  bag: DiagnosticBag,
): TableElement | null {
  rejectUnknownKeys(nodes, TABLE_KEYS, "`table` element", bag);

  const bindNode = findNode(nodes, "bind");
  const binding = bindNode ? coerceBinding(bindNode.value, "bind", bindNode.line, bag) : undefined;
  if (!binding) {
    bag.error("missing_property", "`bind` ko'rsatilmagan.", section.line, "Jadval `{{table_data}}` ga bog'lanishi kerak.");
    return null;
  }

  const columns = readInteger(nodes, "columns", bag, { min: 1, max: LIMITS.tableColumns }) ?? 3;
  const rows = readInteger(nodes, "rows", bag, { min: 1, max: LIMITS.tableRows }) ?? 5;

  const widthsNode = findNode(nodes, "columnWidths");
  let columnWidths: number[] = [];
  if (widthsNode) {
    const parts = splitList(widthsNode.value).map(Number);
    if (parts.length !== columns || parts.some((value) => !Number.isFinite(value) || value <= 0)) {
      bag.error("bad_column_widths", `\`columnWidths\` ${columns} ta musbat son kutadi.`, widthsNode.line);
    } else {
      const total = parts.reduce((sum, value) => sum + value, 0);
      columnWidths = parts.map((value) => round(value / total));
    }
  }

  const fontOf = (key: string, fallback: string | null) => {
    const node = findNode(nodes, key);
    return node ? resolveFont(node.value, key, node.line, fonts, bag) : fallback ?? fonts[0]?.id ?? "font_1";
  };
  const header = readBoolean(nodes, "header", bag) ?? true;
  const cellSize = round(readNumber(nodes, "cellSize", bag, { min: MIN_FONT_SIZE, max: 120 }) ?? 24);

  const table: TableStyle = {
    headerBackground: readColor(nodes, "headerBackground", bag) ?? null,
    headerColor: readColor(nodes, "headerColor", bag) ?? { role: "text" },
    headerFont: fontOf("headerFont", defaults.titleFont),
    headerSize: round(readNumber(nodes, "headerSize", bag, { min: MIN_FONT_SIZE, max: 120 }) ?? cellSize * 1.05),
    cellBackground: readColor(nodes, "cellBackground", bag) ?? null,
    cellAltBackground: readColor(nodes, "cellAltBackground", bag) ?? null,
    cellColor: readColor(nodes, "cellColor", bag) ?? { role: "text" },
    cellFont: fontOf("cellFont", defaults.bodyFont),
    cellSize,
    border: readBorder(nodes, bag) ?? null,
    padding: round(readNumber(nodes, "padding", bag, { min: 0, max: 120 }) ?? 12),
    align: readEnum(nodes, "align", ["left", "center", "right"] as const, bag) ?? "left",
    columnWidths,
  };

  // The row budget the geometry can honour at the declared type size. Warning
  // here is far cheaper than discovering it as clipped text in an export (§31).
  const rowHeight = table.cellSize * 1.4 + table.padding * 2;
  const capacity = Math.floor(base.geometry.height / rowHeight);
  if (capacity < rows) {
    bag.warn(
      "table_overflow",
      `Jadval balandligi ${rows} qatorga yetmaydi (taxminan ${Math.max(0, capacity)} ta sig'adi).`,
      section.line,
      "Balandlikni oshiring, `cellSize` yoki `padding` ni kamaytiring.",
    );
  }

  return {
    ...base,
    type: "table",
    source: { bind: binding },
    columns,
    rows,
    header,
    table,
    corners: readCorners(nodes, bag) ?? null,
  };
}

/* ------------------------------------------------------------------- stats */

const STAT_KEYS = [
  ...GEOMETRY_KEYS, ...BOX_KEYS, "shadow", "shadows",
  "value", "label", "prefix", "suffix", "spacing", "padding", "background", "backgroundGradient",
  ...TEXT_STYLE_KEYS.map((key) => `value${key[0]!.toUpperCase()}${key.slice(1)}`),
  ...TEXT_STYLE_KEYS.map((key) => `label${key[0]!.toUpperCase()}${key.slice(1)}`),
];

function statElement(
  base: ElementBaseInput,
  nodes: readonly ParseNode[],
  section: ParseSection,
  fonts: readonly FontDeclaration[],
  defaults: ElementDefaults,
  bag: DiagnosticBag,
): StatElement | null {
  rejectUnknownKeys(nodes, STAT_KEYS, "`stat` element", bag);

  const valueNode = findNode(nodes, "value");
  if (!valueNode) {
    bag.error("missing_property", "`value` ko'rsatilmagan.", section.line, "Masalan: `value: {{stat_value}}`.");
    return null;
  }
  const value = sourceFrom(valueNode, "value", bag);
  if (!value) return null;
  const labelNode = findNode(nodes, "label");
  const label = labelNode ? sourceFrom(labelNode, "label", bag) : null;

  const valueStyle = readTextStyle(nodes, "value", fonts, section.line, bag, {
    font: defaults.accentFont ?? defaults.titleFont,
    color: defaults.headingColor,
  });
  const labelStyle = readTextStyle(nodes, "label", fonts, section.line, bag, {
    font: defaults.bodyFont,
    color: defaults.textColor ?? { role: "muted" },
  }, round(valueStyle.fontSize * 0.28));

  return {
    ...base,
    type: "stat",
    value,
    label,
    prefix: readString(nodes, "prefix", bag, 16) ?? "",
    suffix: readString(nodes, "suffix", bag, 16) ?? "",
    valueStyle,
    labelStyle,
    spacing: round(readNumber(nodes, "spacing", bag, { min: 0, max: 200 }) ?? 12),
    background: readGradient(nodes, "backgroundGradient", bag) ?? readColor(nodes, "background", bag) ?? null,
    corners: readCorners(nodes, bag) ?? null,
    border: readBorder(nodes, bag) ?? null,
    shadows: readShadows(nodes, bag),
    padding: round(readNumber(nodes, "padding", bag, { min: 0, max: 200 }) ?? 0),
  };
}

/** `{{binding}}` when it looks like one, a literal otherwise. */
function sourceFrom(node: ParseNode, key: string, bag: DiagnosticBag): TextSource | null {
  if (node.value.trim().startsWith("{{")) {
    const binding = coerceBinding(node.value, key, node.line, bag);
    return binding ? { bind: binding } : null;
  }
  if (!node.value) {
    bag.error("empty_value", `\`${key}\` bo'sh.`, node.line);
    return null;
  }
  return { literal: node.value };
}

/* -------------------------------------------------------------------- list */

const LIST_KEYS = [...GEOMETRY_KEYS, ...TEXT_STYLE_KEYS, "bind", "marker", "markerColor", "maxItems", "itemSpacing"];
const LIST_MARKERS = ["bullet", "number", "dash", "none"] as const;

function listElement(
  base: ElementBaseInput,
  nodes: readonly ParseNode[],
  section: ParseSection,
  fonts: readonly FontDeclaration[],
  defaults: ElementDefaults,
  bag: DiagnosticBag,
): ListElement | null {
  rejectUnknownKeys(nodes, LIST_KEYS, "`list` element", bag);
  const bindNode = findNode(nodes, "bind");
  const binding = bindNode ? coerceBinding(bindNode.value, "bind", bindNode.line, bag) : undefined;
  if (!binding) {
    bag.error("missing_property", "`bind` ko'rsatilmagan.", section.line, "Ro'yxat `{{bullets}}` ga bog'lanadi.");
    return null;
  }
  return {
    ...base,
    type: "list",
    source: { bind: binding },
    marker: readEnum(nodes, "marker", LIST_MARKERS, bag) ?? "bullet",
    markerColor: readColor(nodes, "markerColor", bag) ?? { role: "accent" },
    maxItems: readInteger(nodes, "maxItems", bag, { min: 1, max: 20 }) ?? 5,
    itemSpacing: round(readNumber(nodes, "itemSpacing", bag, { min: 0, max: 200 }) ?? 12),
    text: readTextStyle(nodes, "", fonts, section.line, bag, { font: defaults.bodyFont, color: defaults.textColor }),
  };
}

/* ------------------------------------------------------------------- group */

function groupElement(
  base: ElementBaseInput,
  nodes: readonly ParseNode[],
  bag: DiagnosticBag,
): GroupElement {
  rejectUnknownKeys(nodes, GEOMETRY_KEYS, "`group` element", bag);
  return { ...base, type: "group", children: [] };
}
