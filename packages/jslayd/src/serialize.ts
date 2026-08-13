import type { JslaydDocument } from "./document.ts";
import { DiagnosticBag, type Diagnostics } from "./diagnostics.ts";
import {
  ANCHORS,
  ARCHETYPE_PURPOSES,
  BINDINGS,
  CHART_KINDS,
  COLOR_ROLES,
  CONDITIONS,
  ELEMENT_TYPES,
  FONT_FORMATS,
  FONT_ROLES,
  HEX_COLOR_PATTERN,
  IDENTIFIER_PATTERN,
  IMAGE_SOURCE_STRATEGIES,
  JSLAYD_FORMAT,
  JSLAYD_KIND,
  LIMITS,
  SHAPE_KINDS,
  SLUG_PATTERN,
  SUPPORTED_VERSIONS,
  TEXT_EFFECTS,
  TIERS,
} from "./spec.ts";

/**
 * `.jslayd` serialisation and the untrusted-input reader.
 *
 * A file that arrives through the admin's import button (§81) has been nowhere
 * near this build's compiler, so `readDocument` re-checks the whole structure
 * before anything renders it (§56, §82). It answers with diagnostics rather
 * than throwing: a malformed design must never be able to take an app down —
 * it is excluded from the picker and the rest of the catalogue keeps working
 * (§99).
 */

/**
 * Canonical JSON: keys sorted at every depth, no incidental whitespace.
 *
 * Two compiles of one prompt must produce identical bytes, or the content hash
 * stops identifying a version and every publish looks like a change.
 */
export function serialize(document: JslaydDocument): string {
  return JSON.stringify(canonical(document));
}

/** Same shape, pretty-printed — what the admin's download button writes out. */
export function serializePretty(document: JslaydDocument): string {
  return `${JSON.stringify(canonical(document), null, 2)}\n`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0));
    return Object.fromEntries(entries.map(([key, item]) => [key, canonical(item)]));
  }
  // -0 and 0 serialise differently; folding them keeps the hash stable.
  if (typeof value === "number" && Object.is(value, -0)) return 0;
  return value;
}

/**
 * The two host globals this package needs, declared at module scope rather than
 * pulled in with `lib: DOM`.
 *
 * They exist in every runtime that compiles a design — browser, Deno, Node 18+
 * — and declaring them here keeps the package from claiming a DOM it does not
 * have and must never touch. Module-scoped `declare` shadows rather than
 * augments, so a consumer that does ship lib.dom sees no conflict.
 */
declare const crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
declare const TextEncoder: { new (): { encode(input: string): Uint8Array } };

/**
 * SHA-256 of the canonical bytes, hex. This is the design's version identity:
 * the cache key the apps invalidate on (§68) and the fingerprint a version row
 * records (§59).
 */
export async function contentHash(document: JslaydDocument): Promise<string> {
  const bytes = new TextEncoder().encode(serialize(document));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export type ReadResult = { document: JslaydDocument | null; diagnostics: Diagnostics };

export function readDocument(input: string | unknown): ReadResult {
  const bag = new DiagnosticBag();
  let value: unknown = input;

  if (typeof input === "string") {
    if (input.length > LIMITS.documentBytes) {
      bag.error("document_too_large", `Fayl juda katta (${Math.round(input.length / 1024)} KB).`, 0, `Chegara ${Math.round(LIMITS.documentBytes / 1024)} KB.`);
      return { document: null, diagnostics: bag.collect() };
    }
    try {
      value = JSON.parse(input);
    } catch {
      bag.error("invalid_json", "Fayl JSLAYD hujjati emas.", 0, "JSON tuzilishi buzilgan.");
      return { document: null, diagnostics: bag.collect() };
    }
  }

  const root = record(value);
  if (!root) {
    bag.error("invalid_document", "Hujjat obyekt emas.", 0);
    return { document: null, diagnostics: bag.collect() };
  }
  if (root.format !== JSLAYD_FORMAT) {
    bag.error("not_jslayd", "Bu JSLAYD fayli emas.", 0, `\`format\` maydoni "${JSLAYD_FORMAT}" bo'lishi kerak.`);
    return { document: null, diagnostics: bag.collect() };
  }
  if (root.kind !== JSLAYD_KIND) {
    bag.error("wrong_kind", `Noma'lum hujjat turi: "${String(root.kind)}".`, 0, `Kutilgan: "${JSLAYD_KIND}".`);
    return { document: null, diagnostics: bag.collect() };
  }
  if (typeof root.version !== "string" || !SUPPORTED_VERSIONS.includes(root.version)) {
    bag.error(
      "unsupported_version",
      "Bu dizayn JSLAYD rendererning ushbu versiyasi bilan mos emas.",
      0,
      `Hujjat versiyasi: ${String(root.version)}. Qo'llab-quvvatlanadigan: ${SUPPORTED_VERSIONS.join(", ")}.`,
    );
    return { document: null, diagnostics: bag.collect() };
  }

  checkDesign(root.design, bag);
  checkColors(root.colors, bag);
  checkColorFamilies(root, bag);
  checkChartPalette(root.chartPalette, bag);
  const fontIds = checkFonts(root.fonts, bag);
  checkVisualDNA(root.visualDNA, bag);
  checkArchetypes(root.archetypes, fontIds, bag);

  const diagnostics = bag.collect();
  return { document: diagnostics.errors.length === 0 ? (root as unknown as JslaydDocument) : null, diagnostics };
}

/* ------------------------------------------------------------------ guards */

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function oneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

function checkDesign(value: unknown, bag: DiagnosticBag): void {
  const design = record(value);
  if (!design) return bag.error("invalid_design", "`design` bo'limi yo'q.", 0);
  if (typeof design.name !== "string" || !design.name) bag.error("invalid_design", "`design.name` yo'q.", 0);
  if (typeof design.slug !== "string" || !SLUG_PATTERN.test(design.slug)) bag.error("invalid_design", "`design.slug` noto'g'ri.", 0);
  if (!oneOf(design.tier, TIERS)) bag.error("invalid_design", `\`design.tier\` noto'g'ri: "${String(design.tier)}".`, 0);
  const canvas = record(design.canvas);
  if (!canvas || !isFiniteNumber(canvas.width) || !isFiniteNumber(canvas.height)) {
    bag.error("invalid_design", "`design.canvas` noto'g'ri.", 0);
  }
}

function checkColors(value: unknown, bag: DiagnosticBag): void {
  const colors = record(value);
  if (!colors) return bag.error("invalid_colors", "`colors` bo'limi yo'q.", 0);
  for (const role of COLOR_ROLES) {
    const entry = colors[role];
    if (typeof entry !== "string" || !HEX_COLOR_PATTERN.test(entry)) {
      bag.error("invalid_colors", `\`colors.${role}\` noto'g'ri rang.`, 0);
    }
  }
}

/**
 * Families, normalised.
 *
 * A document written before families existed carries none, so one is
 * synthesised from `colors` in place — which means every downstream reader can
 * assume the list is there and non-empty without a second code path (§54).
 */
function checkColorFamilies(root: Record<string, unknown>, bag: DiagnosticBag): void {
  const families = root.colorFamilies;
  if (families === undefined) {
    root.colorFamilies = [{ code: "default", name: "Asosiy", colors: root.colors, chartPalette: root.chartPalette }];
    return;
  }
  if (!Array.isArray(families) || families.length === 0) {
    return bag.error("invalid_families", "`colorFamilies` bo'sh.", 0);
  }
  if (families.length > LIMITS.colorFamilies) {
    return bag.error("invalid_families", "`colorFamilies` juda ko'p.", 0);
  }
  const seen = new Set<string>();
  for (const entry of families) {
    const family = record(entry);
    if (!family || typeof family.code !== "string" || !IDENTIFIER_PATTERN.test(family.code)) {
      bag.error("invalid_families", "Rang oilasi identifikatori noto'g'ri.", 0);
      continue;
    }
    if (seen.has(family.code)) bag.error("invalid_families", `Rang oilasi takrorlangan: "${family.code}".`, 0);
    seen.add(family.code);
    checkColors(family.colors, bag);
    checkChartPalette(family.chartPalette, bag);
  }
}

function checkChartPalette(value: unknown, bag: DiagnosticBag): void {
  if (!Array.isArray(value) || value.length === 0) return bag.error("invalid_palette", "`chartPalette` bo'sh.", 0);
  if (value.length > LIMITS.chartPaletteColors) return bag.error("invalid_palette", "`chartPalette` juda uzun.", 0);
  for (const entry of value) {
    if (typeof entry !== "string" || !HEX_COLOR_PATTERN.test(entry)) {
      bag.error("invalid_palette", `\`chartPalette\` ichida noto'g'ri rang: "${String(entry)}".`, 0);
    }
  }
}

function checkFonts(value: unknown, bag: DiagnosticBag): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(value) || value.length === 0) {
    bag.error("invalid_fonts", "`fonts` bo'sh.", 0);
    return ids;
  }
  if (value.length > LIMITS.fonts) bag.error("invalid_fonts", "`fonts` juda uzun.", 0);
  for (const entry of value.slice(0, LIMITS.fonts)) {
    const font = record(entry);
    if (!font || typeof font.id !== "string" || !/^font_[1-4]$/.test(font.id)) {
      bag.error("invalid_fonts", "Shrift identifikatori noto'g'ri.", 0);
      continue;
    }
    if (!Array.isArray(font.roles) || font.roles.some((role) => !oneOf(role, FONT_ROLES))) {
      bag.error("invalid_fonts", `\`${font.id}.roles\` noto'g'ri.`, 0);
    }
    if (typeof font.family !== "string" || !font.family) bag.error("invalid_fonts", `\`${font.id}.family\` yo'q.`, 0);

    // A design saved before a font slot could hold more than one file carries
    // its single face at the top level. Reading it as a one-face package keeps
    // every published design opening, rather than making a model change into a
    // day when nothing renders (§69).
    const faces: unknown[] = Array.isArray(font.faces) ? font.faces : [];
    if (!Array.isArray(font.faces)) {
      font.faces = font.asset
        ? [{ asset: font.asset, format: font.format, weight: font.weight ?? 400, italic: font.italic === true }]
        : [];
      faces.push(...(font.faces as unknown[]));
    }

    if (faces.length > LIMITS.fontFaces) {
      bag.error("invalid_fonts", `\`${font.id}\` paketida ${LIMITS.fontFaces} tadan ko'p fayl bor.`, 0);
    }
    for (const raw of faces.slice(0, LIMITS.fontFaces)) {
      const face = record(raw);
      if (!face) { bag.error("invalid_fonts", `\`${font.id}.faces\` noto'g'ri.`, 0); continue; }
      // An asset that could climb out of its bucket prefix is the one thing an
      // imported file must never be allowed to carry (§82).
      if (typeof face.asset !== "string" || !face.asset || /[\\/]|\.\./.test(face.asset)) {
        bag.error("unsafe_asset", `\`${font.id}\` faylining nomi xavfsiz emas.`, 0, "Fayl nomida yo'l ajratuvchi bo'lishi mumkin emas.");
      }
      if (!oneOf(face.format, FONT_FORMATS)) bag.error("invalid_fonts", `\`${font.id}\` fayl formati noto'g'ri.`, 0);
      if (typeof face.weight !== "number" || face.weight < 100 || face.weight > 900) {
        bag.error("invalid_fonts", `\`${font.id}\` fayl qalinligi noto'g'ri.`, 0);
      }
    }
    ids.add(font.id);
  }
  if (!ids.has("font_1")) bag.error("invalid_fonts", "`font_1` yo'q.", 0);
  return ids;
}

function checkVisualDNA(value: unknown, bag: DiagnosticBag): void {
  const dna = record(value);
  if (!dna) return bag.error("invalid_visual_dna", "`visualDNA` yo'q.", 0);
  for (const key of ["rotationRange", "titleScale", "bodyScale"]) {
    const range = record(dna[key]);
    if (!range || !isFiniteNumber(range.min) || !isFiniteNumber(range.max)) {
      bag.error("invalid_visual_dna", `\`visualDNA.${key}\` noto'g'ri.`, 0);
    }
  }
  for (const key of ["cornerRadiusFamily", "spacingScale"]) {
    if (!Array.isArray(dna[key]) || (dna[key] as unknown[]).some((entry) => !isFiniteNumber(entry))) {
      bag.error("invalid_visual_dna", `\`visualDNA.${key}\` noto'g'ri.`, 0);
    }
  }
}

function checkArchetypes(value: unknown, fontIds: ReadonlySet<string>, bag: DiagnosticBag): void {
  if (!Array.isArray(value) || value.length === 0) return bag.error("invalid_archetypes", "`archetypes` bo'sh.", 0);
  if (value.length > LIMITS.archetypes) return bag.error("invalid_archetypes", "`archetypes` juda ko'p.", 0);

  let total = 0;
  const seen = new Set<string>();
  for (const entry of value) {
    const archetype = record(entry);
    if (!archetype || typeof archetype.id !== "string" || !IDENTIFIER_PATTERN.test(archetype.id)) {
      bag.error("invalid_archetypes", "Arxetip identifikatori noto'g'ri.", 0);
      continue;
    }
    if (seen.has(archetype.id)) bag.error("invalid_archetypes", `Arxetip takrorlangan: "${archetype.id}".`, 0);
    seen.add(archetype.id);
    if (!oneOf(archetype.purpose, ARCHETYPE_PURPOSES)) {
      bag.error("invalid_archetypes", `\`${archetype.id}.purpose\` noto'g'ri.`, 0);
    }
    if (!checkPaint(archetype.background)) bag.error("invalid_archetypes", `\`${archetype.id}.background\` noto'g'ri.`, 0);
    if (!record(archetype.selection)) bag.error("invalid_archetypes", `\`${archetype.id}.selection\` yo'q.`, 0);

    const elements = archetype.elements;
    if (!Array.isArray(elements) || elements.length === 0) {
      bag.error("invalid_archetypes", `\`${archetype.id}\` bo'sh.`, 0);
      continue;
    }
    total += elements.length;
    if (total > LIMITS.elementsPerDocument) {
      bag.error("invalid_archetypes", "Hujjatda elementlar soni chegaradan oshdi.", 0);
      return;
    }
    bag.within(archetype.id, () => {
      for (const element of elements) checkElement(element, fontIds, bag, 0);
    });
  }
}

/** A colour value or a gradient — the two things any surface can be painted with. */
function checkPaint(value: unknown): boolean {
  if (value === null) return true;
  const paint = record(value);
  if (!paint) return false;
  if (typeof paint.role === "string") return (COLOR_ROLES as readonly string[]).includes(paint.role);
  if (typeof paint.hex === "string") return HEX_COLOR_PATTERN.test(paint.hex);
  if (paint.type === "linear" || paint.type === "radial") {
    if (!isFiniteNumber(paint.angle)) return false;
    const stops = paint.stops;
    if (!Array.isArray(stops) || stops.length < 2 || stops.length > LIMITS.gradientStops) return false;
    return stops.every((entry) => {
      const stop = record(entry);
      return Boolean(stop && isFiniteNumber(stop.offset) && checkPaint(stop.color));
    });
  }
  return false;
}

function checkElement(value: unknown, fontIds: ReadonlySet<string>, bag: DiagnosticBag, depth: number): void {
  if (depth > 4) return bag.error("invalid_element", "Guruhlar juda chuqur joylashgan.", 0);
  const element = record(value);
  if (!element || typeof element.id !== "string" || !IDENTIFIER_PATTERN.test(element.id)) {
    return bag.error("invalid_element", "Element identifikatori noto'g'ri.", 0);
  }
  if (!oneOf(element.type, ELEMENT_TYPES)) {
    return bag.error("invalid_element", `\`${element.id}.type\` noma'lum: "${String(element.type)}".`, 0);
  }
  if (!oneOf(element.when, CONDITIONS)) bag.error("invalid_element", `\`${element.id}.when\` noto'g'ri.`, 0);
  if (!isFiniteNumber(element.opacity)) bag.error("invalid_element", `\`${element.id}.opacity\` noto'g'ri.`, 0);

  const geometry = record(element.geometry);
  if (!geometry) return bag.error("invalid_element", `\`${element.id}.geometry\` yo'q.`, 0);
  for (const key of ["x", "y", "width", "height", "rotation", "zIndex"]) {
    if (!isFiniteNumber(geometry[key])) bag.error("invalid_element", `\`${element.id}.geometry.${key}\` son emas.`, 0);
  }
  if (!oneOf(geometry.anchor, ANCHORS)) bag.error("invalid_element", `\`${element.id}.geometry.anchor\` noto'g'ri.`, 0);

  const bind = (holder: unknown, label: string) => {
    const source = record(holder);
    if (!source) return bag.error("invalid_element", `\`${element.id}.${label}\` yo'q.`, 0);
    if (typeof source.literal === "string") return;
    if (typeof source.bind === "string" && (BINDINGS as readonly string[]).includes(source.bind)) return;
    bag.error("invalid_binding", `\`${element.id}.${label}\` noma'lum bog'lanish.`, 0);
  };
  const textStyle = (holder: unknown, label: string) => {
    const style = record(holder);
    if (!style) return bag.error("invalid_element", `\`${element.id}.${label}\` yo'q.`, 0);
    if (typeof style.font !== "string" || (fontIds.size > 0 && !fontIds.has(style.font))) {
      bag.error("invalid_element", `\`${element.id}.${label}.font\` e'lon qilinmagan shriftga ishora qilyapti.`, 0);
    }
    if (!isFiniteNumber(style.fontSize) || style.fontSize <= 0) bag.error("invalid_element", `\`${element.id}.${label}.fontSize\` noto'g'ri.`, 0);
    if (!checkPaint(style.color)) bag.error("invalid_element", `\`${element.id}.${label}.color\` noto'g'ri.`, 0);
    if (!oneOf(style.effect, TEXT_EFFECTS)) bag.error("invalid_element", `\`${element.id}.${label}.effect\` noto'g'ri.`, 0);
  };

  switch (element.type) {
    case "text": case "quote": case "number": case "badge":
      bind(element.source, "source");
      textStyle(element.text, "text");
      break;
    case "image": case "frame":
      if (typeof element.slot !== "string" || !IDENTIFIER_PATTERN.test(element.slot)) {
        bag.error("invalid_element", `\`${element.id}.slot\` noto'g'ri.`, 0);
      }
      if (!oneOf(element.strategy, IMAGE_SOURCE_STRATEGIES)) bag.error("invalid_element", `\`${element.id}.strategy\` noto'g'ri.`, 0);
      break;
    case "shape": case "divider": case "decorative": case "line":
      if (!oneOf(element.shape, SHAPE_KINDS)) bag.error("invalid_element", `\`${element.id}.shape\` noto'g'ri.`, 0);
      if (!checkPaint(element.fill)) bag.error("invalid_element", `\`${element.id}.fill\` noto'g'ri.`, 0);
      break;
    case "icon":
      if (typeof element.icon !== "string" || !/^[A-Z][A-Za-z0-9]*$/.test(element.icon)) {
        bag.error("invalid_element", `\`${element.id}.icon\` noto'g'ri.`, 0);
      }
      break;
    case "chart":
      if (!oneOf(element.chart, CHART_KINDS)) bag.error("invalid_element", `\`${element.id}.chart\` noto'g'ri.`, 0);
      bind(element.source, "source");
      break;
    case "table":
      bind(element.source, "source");
      if (!isFiniteNumber(element.columns) || element.columns < 1 || element.columns > LIMITS.tableColumns) {
        bag.error("invalid_element", `\`${element.id}.columns\` noto'g'ri.`, 0);
      }
      if (!isFiniteNumber(element.rows) || element.rows < 1 || element.rows > LIMITS.tableRows) {
        bag.error("invalid_element", `\`${element.id}.rows\` noto'g'ri.`, 0);
      }
      break;
    case "stat":
      bind(element.value, "value");
      textStyle(element.valueStyle, "valueStyle");
      textStyle(element.labelStyle, "labelStyle");
      break;
    case "list":
      bind(element.source, "source");
      textStyle(element.text, "text");
      break;
    case "group": {
      const children = element.children;
      if (!Array.isArray(children)) return bag.error("invalid_element", `\`${element.id}.children\` yo'q.`, 0);
      for (const child of children) checkElement(child, fontIds, bag, depth + 1);
      break;
    }
  }
}
