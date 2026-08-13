import type {
  Archetype,
  Border,
  ColorValue,
  Corners,
  Gradient,
  JslaydDocument,
  JslaydElement,
  Shadow,
  TextSource,
  TextStyle,
} from "./document.ts";
import { CANVAS_LABEL, JSLAYD_HEADER, MIN_FONT_SIZE, type Anchor } from "./spec.ts";

/**
 * A compiled document, written back out as the prompt that produces it.
 *
 * Not every design arrives with a prompt. The built-in designs were translated
 * from TypeScript, and an imported `.jslayd` was compiled on someone else's
 * machine — both would otherwise open in the editor with nothing to edit, or
 * worse, with somebody else's prompt in the box.
 *
 * So this is the inverse of the compiler, and it is meant to be exact:
 * `compile(decompile(document))` must give back the same document, byte for
 * byte. `decompile.test.mjs` holds it to that over every built-in design. What
 * an author edits is therefore never an approximation of their design — it is
 * their design, in the form the language is written in.
 */

/** Values the compiler would supply anyway, left out so the prompt stays legible. */
const DEFAULT_TEXT: Omit<TextStyle, "font" | "fontSize" | "color"> = {
  fontWeight: 400,
  fontStyle: "normal",
  letterSpacing: 0,
  lineHeight: 1.2,
  align: "left",
  verticalAlign: "top",
  transform: "none",
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

export function decompile(document: JslaydDocument): string {
  const out: string[] = [JSLAYD_HEADER, ""];

  out.push("[DESIGN]");
  out.push(`name: ${document.design.name}`);
  out.push(`slug: ${document.design.slug}`);
  out.push(`tier: ${document.design.tier}`);
  if (document.design.description) out.push(`description: ${document.design.description}`);
  out.push(`canvas: ${CANVAS_LABEL}`);
  out.push(`premium: ${document.design.premium}`);
  out.push("");

  // Every role is written out, not just the seven that are required: a family
  // the compiler would derive is a family an author cannot see to change.
  const families = document.colorFamilies?.length
    ? document.colorFamilies
    : [{ code: "default", name: "Asosiy", colors: document.colors, chartPalette: document.chartPalette }];

  for (const family of families) {
    // The first family names itself too: the compiler calls an unnamed one
    // `default`, which would rename a design's own family on a round trip.
    out.push(family.code === "default" ? "[COLOR_FAMILY]" : `[COLOR_FAMILY ${family.code}]`);
    out.push(`name: ${family.name}`);
    for (const [role, value] of Object.entries(family.colors)) out.push(`${role}: ${value}`);
    if (family.chartPalette.join() !== document.chartPalette.join()) {
      out.push(`chartPalette: ${family.chartPalette.join(", ")}`);
    }
    out.push("");
  }

  out.push("[CHART_PALETTE]");
  out.push(`colors: ${document.chartPalette.join(", ")}`);
  out.push("");

  out.push("[FONTS]");
  for (const font of document.fonts) {
    out.push(`${font.id}:`);
    out.push(`  name: ${font.name}`);
    out.push(`  role: ${font.roles.join(", ")}`);
    // One line per file, always in the `face:` form. A prompt written with the
    // older single-file spelling still compiles, but what comes back out is the
    // spelling that can express a whole family.
    for (const face of font.faces) {
      out.push(`  face: ${face.asset} ${face.weight}${face.italic ? " italic" : ""}`);
    }
    out.push(`  fallback: ${font.fallback}`);
  }
  out.push("");

  const dna = document.visualDNA;
  out.push("[VISUAL_DNA]");
  out.push(`rotationRange: ${dna.rotationRange.min}..${dna.rotationRange.max}`);
  out.push(`cornerRadiusFamily: ${dna.cornerRadiusFamily.join(", ") || "none"}`);
  out.push(`spacingScale: ${dna.spacingScale.join(", ") || "none"}`);
  out.push(`titleScale: ${dna.titleScale.min}..${dna.titleScale.max}`);
  out.push(`bodyScale: ${dna.bodyScale.min}..${dna.bodyScale.max}`);
  out.push(`imageTreatment: ${dna.imageTreatment}`);
  out.push(`decorationDensity: ${dna.decorationDensity}`);
  if (dna.shadowFamily.length) {
    for (const shadow of dna.shadowFamily) out.push(`shadow: ${shorthandShadow(shadow)}`);
  } else {
    out.push("shadowFamily: none");
  }
  out.push("");

  for (const archetype of document.archetypes) out.push(...archetypeLines(archetype));
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function archetypeLines(archetype: Archetype): string[] {
  const out = [`[SLIDE ${archetype.id}]`, `purpose: ${archetype.purpose}`];
  if ("stops" in archetype.background) out.push(...block("backgroundGradient", archetype.background));
  else out.push(`background: ${colorOf(archetype.background)}`);

  const rules = archetype.selection;
  if (rules.minText !== 0) out.push(`minText: ${rules.minText}`);
  if (rules.maxText !== 20000) out.push(`maxText: ${rules.maxText}`);
  out.push(`priority: ${rules.priority}`);
  // Written out rather than left to be inferred from the elements: an archetype
  // that may hold a chart it does not currently draw is a real thing to say.
  out.push(`supportsImage: ${rules.supportsImage}`);
  out.push(`supportsChart: ${rules.supportsChart}`);
  out.push(`supportsTable: ${rules.supportsTable}`);
  out.push(`supportsStats: ${rules.supportsStats}`);
  out.push(`supportsQuote: ${rules.supportsQuote}`);
  out.push("");

  for (const element of archetype.elements) out.push(...elementLines(element, null, { x: 0, y: 0 }));
  return out;
}

function elementLines(element: JslaydElement, parent: string | null, origin: { x: number; y: number }): string[] {
  const out = [`[ELEMENT ${element.id}]`, `type: ${element.type}`];
  const geometry = element.geometry;

  // The compiler resolves an anchor away by shifting x and y; writing the shift
  // back means an author sees the anchor they chose rather than a corner.
  const [horizontal, vertical] = anchorOffsets(geometry.anchor);
  out.push(`x: ${round(geometry.x + origin.x + geometry.width * horizontal)}`);
  out.push(`y: ${round(geometry.y + origin.y + geometry.height * vertical)}`);
  out.push(`width: ${round(geometry.width)}`);
  out.push(`height: ${round(geometry.height)}`);
  if (geometry.anchor !== "top-left") out.push(`anchor: ${geometry.anchor}`);
  if (geometry.rotation !== 0) out.push(`rotation: ${geometry.rotation}`);
  out.push(`zIndex: ${geometry.zIndex}`);
  if (element.opacity !== 1) out.push(`opacity: ${element.opacity}`);
  if (element.when !== "always") out.push(`when: ${element.when}`);
  if (element.grow) out.push("grow: true");
  if (parent) out.push(`parent: ${parent}`);

  switch (element.type) {
    case "text": case "quote": case "number": case "badge":
      out.push(...sourceLines(element.source));
      out.push(...textLines(element.text, ""));
      if (element.background) out.push(...paintLines("background", element.background));
      out.push(...cornerLines(element.corners), ...borderLines(element.border));
      if (element.padding !== (element.type === "badge" ? 16 : 0)) out.push(`padding: ${element.padding}`);
      break;
    case "list":
      out.push(`bind: {{${element.source.bind}}}`);
      if (element.marker !== "bullet") out.push(`marker: ${element.marker}`);
      out.push(`markerColor: ${colorOf(element.markerColor)}`);
      if (element.maxItems !== 5) out.push(`maxItems: ${element.maxItems}`);
      if (element.itemSpacing !== 12) out.push(`itemSpacing: ${element.itemSpacing}`);
      out.push(...textLines(element.text, ""));
      break;
    case "stat":
      out.push(...valueLines("value", element.value));
      if (element.label) out.push(...valueLines("label", element.label));
      if (element.prefix) out.push(`prefix: ${element.prefix}`);
      if (element.suffix) out.push(`suffix: ${element.suffix}`);
      out.push(...textLines(element.valueStyle, "value"));
      out.push(...textLines(element.labelStyle, "label"));
      if (element.spacing !== 12) out.push(`spacing: ${element.spacing}`);
      if (element.padding !== 0) out.push(`padding: ${element.padding}`);
      if (element.background) out.push(...paintLines("background", element.background));
      out.push(...cornerLines(element.corners), ...borderLines(element.border), ...shadowLines(element.shadows));
      break;
    case "image": case "frame":
      out.push(`slot: ${element.slot}`);
      if (element.source) out.push(`bind: {{${element.source.bind}}}`);
      out.push(`sourceStrategy: ${element.strategy}`);
      if (element.required) out.push("imageRequired: true");
      if (element.queryFrom.length) out.push(`queryFrom: ${element.queryFrom.join(", ")}`);
      if (element.orientation !== "landscape") out.push(`orientation: ${element.orientation}`);
      if (element.stylePreference) out.push(`stylePreference: ${element.stylePreference}`);
      if (element.fit !== "cover") out.push(`fit: ${element.fit}`);
      if (element.focus.x !== 0.5) out.push(`focusX: ${element.focus.x}`);
      if (element.focus.y !== 0.5) out.push(`focusY: ${element.focus.y}`);
      out.push(...cornerLines(element.corners), ...borderLines(element.border), ...shadowLines(element.shadows));
      if (element.overlay) {
        out.push(...paintLines("overlay", element.overlay));
        if (element.overlayOpacity !== 0.35) out.push(`overlayOpacity: ${element.overlayOpacity}`);
      }
      break;
    case "shape": case "divider": case "decorative": case "line":
      out.push(`shape: ${element.shape}`);
      if (element.fill) out.push(...paintLines("fill", element.fill));
      if (element.sides !== null) out.push(`sides: ${element.sides}`);
      if (element.thickness !== (element.type === "divider" || element.type === "line" ? 2 : 0)) {
        out.push(`thickness: ${element.thickness}`);
      }
      out.push(...cornerLines(element.corners), ...borderLines(element.border), ...shadowLines(element.shadows));
      break;
    case "icon":
      out.push(`icon: ${element.icon}`);
      out.push(`color: ${colorOf(element.color)}`);
      if (element.strokeWidth !== 1.85) out.push(`strokeWidth: ${element.strokeWidth}`);
      break;
    case "chart":
      out.push(`chart: ${element.chart}`);
      out.push(`bind: {{${element.source.bind}}}`);
      if (element.palette) out.push(`chartPalette: ${element.palette.map(colorOf).join(", ")}`);
      out.push(`color: ${colorOf(element.color)}`);
      out.push(`trackColor: ${colorOf(element.trackColor)}`);
      out.push(`labelColor: ${colorOf(element.labelColor)}`);
      out.push(`axisColor: ${colorOf(element.axisColor)}`);
      out.push(`font: ${element.font}`);
      out.push(`labelSize: ${element.labelSize}`);
      out.push(`showLegend: ${element.style.showLegend}`);
      out.push(`showLabels: ${element.style.showLabels}`);
      out.push(`showValues: ${element.style.showValues}`);
      out.push(`showGrid: ${element.style.showGrid}`);
      out.push(`showAxis: ${element.style.showAxis}`);
      out.push(`cornerRadius: ${element.style.cornerRadius}`);
      out.push(`gap: ${element.style.gap}`);
      out.push(`strokeWidth: ${element.style.strokeWidth}`);
      break;
    case "table":
      out.push(`bind: {{${element.source.bind}}}`);
      out.push(`columns: ${element.columns}`);
      out.push(`rows: ${element.rows}`);
      out.push(`header: ${element.header}`);
      if (element.table.headerBackground) out.push(`headerBackground: ${colorOf(element.table.headerBackground)}`);
      out.push(`headerColor: ${colorOf(element.table.headerColor)}`);
      out.push(`headerFont: ${element.table.headerFont}`);
      out.push(`headerSize: ${element.table.headerSize}`);
      if (element.table.cellBackground) out.push(`cellBackground: ${colorOf(element.table.cellBackground)}`);
      if (element.table.cellAltBackground) out.push(`cellAltBackground: ${colorOf(element.table.cellAltBackground)}`);
      out.push(`cellColor: ${colorOf(element.table.cellColor)}`);
      out.push(`cellFont: ${element.table.cellFont}`);
      out.push(`cellSize: ${element.table.cellSize}`);
      out.push(`padding: ${element.table.padding}`);
      out.push(`align: ${element.table.align}`);
      if (element.table.columnWidths.length) out.push(`columnWidths: ${element.table.columnWidths.join(", ")}`);
      out.push(...borderLines(element.table.border), ...cornerLines(element.corners));
      break;
    case "group":
      break;
  }

  out.push("");
  if (element.type === "group") {
    // Children are stored relative to their group; the prompt places every box
    // on the canvas and links it with `parent`, which is the one bracket form.
    const inside = { x: geometry.x + origin.x, y: geometry.y + origin.y };
    for (const child of element.children) out.push(...elementLines(child, element.id, inside));
  }
  return out;
}

/* ----------------------------------------------------------------- pieces */

function sourceLines(source: TextSource): string[] {
  return "literal" in source ? [`text: ${source.literal}`] : [`bind: {{${source.bind}}}`];
}

function valueLines(key: string, source: TextSource): string[] {
  return "literal" in source ? [`${key}: ${source.literal}`] : [`${key}: {{${source.bind}}}`];
}

function textLines(style: TextStyle, prefix: string): string[] {
  const key = (name: string) => (prefix ? prefix + name[0]!.toUpperCase() + name.slice(1) : name);
  const out = [`${key("font")}: ${style.font}`, `${key("fontSize")}: ${style.fontSize}`, `${key("color")}: ${colorOf(style.color)}`];

  const emit = <K extends keyof typeof DEFAULT_TEXT>(name: K, format = (value: unknown) => String(value)) => {
    if (style[name] !== DEFAULT_TEXT[name]) out.push(`${key(name)}: ${format(style[name])}`);
  };
  emit("fontWeight");
  emit("fontStyle");
  emit("letterSpacing");
  emit("lineHeight");
  emit("align");
  emit("verticalAlign");
  if (style.transform !== "none") out.push(`${key("textTransform")}: ${style.transform}`);
  if (style.maxLines !== null) out.push(`${key("maxLines")}: ${style.maxLines}`);
  emit("overflow");
  out.push(`${key("minFontSize")}: ${style.minFontSize}`);
  if (style.effect !== "none") out.push(`${key("effect")}: ${style.effect}`);
  for (const shadow of style.shadows) out.push(`${key("shadow")}: ${shorthandShadow(shadow)}`);
  if (style.strokeWidth !== 0) out.push(`${key("strokeWidth")}: ${style.strokeWidth}`);
  if (style.strokeColor) out.push(`${key("strokeColor")}: ${colorOf(style.strokeColor)}`);
  if (style.highlight) out.push(`${key("highlight")}: ${colorOf(style.highlight)}`);
  if (style.gradient) out.push(...block(key("gradientText"), style.gradient));
  if (style.blur !== 0) out.push(`${key("blur")}: ${style.blur}`);
  return out;
}

function paintLines(key: string, paint: ColorValue | Gradient): string[] {
  if ("stops" in paint) return block(key === "fill" ? "gradient" : `${key}Gradient`, paint);
  return [`${key}: ${colorOf(paint)}`];
}

/** A gradient always takes the block form: it round-trips its stops exactly. */
function block(key: string, gradient: Gradient): string[] {
  const out = [`${key}:`, `  type: ${gradient.type}`, `  angle: ${gradient.angle}`, "  stops:"];
  for (const stop of gradient.stops) out.push(`    ${stop.offset}: ${colorOf(stop.color)}`);
  return out;
}

function cornerLines(corners: Corners | null): string[] {
  if (!corners) return [];
  const { topLeft, topRight, bottomRight, bottomLeft } = corners;
  if (topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft) {
    return [`borderRadius: ${topLeft}`];
  }
  return [`borderRadius: ${topLeft} ${topRight} ${bottomRight} ${bottomLeft}`];
}

function borderLines(border: Border | null): string[] {
  if (!border) return [];
  const out = [`borderWidth: ${border.width}`, `borderColor: ${colorOf(border.color)}`];
  if (border.style !== "solid") out.push(`borderStyle: ${border.style}`);
  if (border.opacity !== 1) out.push(`borderOpacity: ${border.opacity}`);
  return out;
}

function shadowLines(shadows: readonly Shadow[]): string[] {
  return shadows.map((shadow) => `shadow: ${shorthandShadow(shadow)}`);
}

function shorthandShadow(shadow: Shadow): string {
  return `${shadow.offsetX} ${shadow.offsetY} ${shadow.blur} ${shadow.spread} ${shadow.opacity} ${colorOf(shadow.color)}`;
}

function colorOf(color: ColorValue): string {
  return "role" in color ? color.role : color.hex;
}

function anchorOffsets(anchor: Anchor): [number, number] {
  if (anchor === "center") return [0.5, 0.5];
  const [vertical, horizontal] = anchor.split("-") as [string, string];
  const scale = (part: string) => (part === "center" ? 0.5 : part === "right" || part === "bottom" ? 1 : 0);
  return [scale(horizontal), scale(vertical)];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

