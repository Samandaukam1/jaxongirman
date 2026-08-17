import { DiagnosticBag, parse, type ParseNode, type ParseSection } from "@jaxongirman/jslayd";

import type {
  Box, Component, ElementAppearance, ElementGeometry, ElementSemantics, ElementUsage,
  FamilyMeta, FamilySearch, JElement, JElementFamily, TransformRules, VisualDNA,
} from "./document.ts";
import {
  ANCHORS, COLOR_TOKENS, FACINGS, JELEMENT_HEADER, JELEMENT_KEYWORD, LIMITS,
  OBJECT_CLASSES, SHAPE_PRIMITIVES, SLIDE_ROLES, SUPPORTED_VERSIONS,
  normalizeTerm, toSlug,
  type ColorToken, type Facing, type ObjectClass, type ShapePrimitive, type SlideRole,
} from "./spec.ts";

/**
 * A JElement family specification, read.
 *
 * The lexer is JSLAYD's — the two languages have the same shape, and a second
 * copy would mean two places to fix an indentation bug. What is different is
 * the vocabulary, and that is entirely here.
 *
 * The compiler refuses rather than repairs. An analyzer that returned a hex
 * colour where a token belongs has produced an element that cannot be
 * recoloured, and quietly accepting it puts an object in the library that
 * breaks the moment somebody changes the family accent. Better to say so at
 * import, when it is one paste away from being fixed.
 */

export type CompileResult = {
  family: JElementFamily | null;
  diagnostics: { errors: Diagnostic[]; warnings: Diagnostic[] };
};

type Diagnostic = { code: string; message: string; line: number; hint?: string; scope?: string };

const DIALECT = {
  header: JELEMENT_HEADER,
  keyword: JELEMENT_KEYWORD,
  supportedVersions: SUPPORTED_VERSIONS,
  childSections: new Set(["ELEMENT"]),
  parentSection: "FAMILY",
};

/* ------------------------------------------------------------- reading */

function propertyMap(nodes: readonly ParseNode[]): Map<string, ParseNode> {
  const map = new Map<string, ParseNode>();
  for (const node of nodes) map.set(node.key, node);
  return map;
}

function text(nodes: Map<string, ParseNode>, key: string, fallback = ""): string {
  return nodes.get(key)?.value.trim() || fallback;
}

function number(nodes: Map<string, ParseNode>, key: string, fallback: number): number {
  const raw = nodes.get(key)?.value.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function boolean(nodes: Map<string, ParseNode>, key: string, fallback: boolean): boolean {
  const raw = nodes.get(key)?.value.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "yes" || raw === "1";
}

/** `a, b, c` or an indented child list — both read the same. */
function list(nodes: Map<string, ParseNode>, key: string): string[] {
  const node = nodes.get(key);
  if (!node) return [];
  if (node.children.length > 0) {
    return node.children.map((child) => (child.value.trim() || child.key.trim())).filter(Boolean);
  }
  return node.value.split(",").map((part) => part.trim()).filter(Boolean);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function oneOf<T extends string>(
  value: string, allowed: readonly T[], fallback: T,
  bag: DiagnosticBag, key: string, line: number,
): T {
  if (!value) return fallback;
  const found = allowed.find((entry) => entry.toLowerCase() === value.toLowerCase());
  if (found) return found;
  bag.warn("unknown_value", `\`${key}\`: "${value}" tanilmadi.`, line, `Mavjud qiymatlar: ${allowed.join(", ")}.`);
  return fallback;
}

/** `0.1 0.2 0.6 0.7` or `x: … y: …` children. */
function box(nodes: Map<string, ParseNode>, key: string, fallback: Box): Box {
  const node = nodes.get(key);
  if (!node) return fallback;

  if (node.children.length > 0) {
    const child = propertyMap(node.children);
    return {
      x: number(child, "x", fallback.x),
      y: number(child, "y", fallback.y),
      width: number(child, "width", fallback.width),
      height: number(child, "height", fallback.height),
    };
  }

  const parts = node.value.split(/[\s,]+/).map(Number).filter(Number.isFinite);
  if (parts.length !== 4) return fallback;
  return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! };
}

const HEX = /^#[0-9a-f]{6}$/i;

/* ----------------------------------------------------------- the family */

function readVisualDNA(section: ParseSection | undefined): VisualDNA {
  const map = propertyMap(section?.properties ?? []);
  return {
    material: text(map, "material"),
    lighting: text(map, "lighting"),
    edgeStyle: text(map, "edgeStyle"),
    depthStyle: text(map, "depthStyle"),
    perspective: text(map, "perspective"),
    camera: text(map, "camera"),
    shadowStyle: text(map, "shadowStyle"),
    highlightStyle: text(map, "highlightStyle"),
    detailDensity: clamp(number(map, "detailDensity", 5), 1, 10),
    realism: text(map, "realism"),
    geometryLanguage: text(map, "geometryLanguage"),
  };
}

function readColorTokens(section: ParseSection | undefined, bag: DiagnosticBag): Partial<Record<ColorToken, string>> {
  const tokens: Partial<Record<ColorToken, string>> = {};
  for (const node of section?.properties ?? []) {
    const name = COLOR_TOKENS.find((token) => token === node.key);
    if (!name) {
      bag.warn("unknown_color_token", `\`${node.key}\` tanilgan rang roli emas.`, node.line,
        `Mavjud rollar: ${COLOR_TOKENS.join(", ")}.`);
      continue;
    }
    const value = node.value.trim();
    if (!HEX.test(value)) {
      bag.error("bad_color", `\`${node.key}\` uchun "${value}" HEX rang emas.`, node.line, "Masalan: #A8FF00.");
      continue;
    }
    tokens[name] = value.toUpperCase();
  }
  return tokens;
}

function readFamilyMeta(section: ParseSection | undefined, bag: DiagnosticBag): FamilyMeta {
  const map = propertyMap(section?.properties ?? []);
  const name = text(map, "name");
  if (!name) bag.error("missing_family_name", "Oilaning nomi ko'rsatilmagan.", section?.line ?? 0);

  return {
    name: name.slice(0, LIMITS.nameLength),
    slug: toSlug(text(map, "slug") || name),
    category: text(map, "category"),
    subcategory: text(map, "subcategory"),
    style: text(map, "style"),
    description: text(map, "description"),
  };
}

function readFamilySearch(section: ParseSection | undefined): FamilySearch {
  const map = propertyMap(section?.properties ?? []);
  return {
    keywords: list(map, "keywords"),
    industries: list(map, "industries"),
    concepts: list(map, "concepts"),
  };
}

/* ---------------------------------------------------------- an element */

function readSemantics(map: Map<string, ParseNode>, bag: DiagnosticBag, line: number): ElementSemantics {
  const nested = map.get("semantic");
  const source = nested && nested.children.length > 0 ? propertyMap(nested.children) : map;

  const semantics: ElementSemantics = {
    aliases: list(source, "aliases").slice(0, LIMITS.aliasesPerElement),
    uzbekTerms: list(source, "uzbekTerms").slice(0, LIMITS.aliasesPerElement),
    englishTerms: list(source, "englishTerms").slice(0, LIMITS.aliasesPerElement),
    russianTerms: list(source, "russianTerms").slice(0, LIMITS.aliasesPerElement),
    industries: list(source, "industries"),
    concepts: list(source, "concepts"),
    actions: list(source, "actions"),
    contexts: list(source, "contexts"),
  };

  // An element with no Uzbek terms is invisible to most of the people using
  // this product. A warning rather than an error: the family can be imported
  // and the terms filled in, and refusing the whole paste over it would be
  // worse than saying so.
  if (semantics.uzbekTerms.length === 0) {
    bag.warn("no_uzbek_terms", "O'zbekcha atamalar yo'q — bu element o'zbekcha qidiruvda topilmaydi.", line);
  }
  if (semantics.concepts.length === 0 && semantics.contexts.length === 0) {
    bag.warn("no_concepts", "Kontekst atamalari yo'q — element faqat o'z nomi bilan topiladi.", line);
  }

  return semantics;
}

const UNIT_BOX: Box = { x: 0, y: 0, width: 1, height: 1 };

function readComponents(node: ParseNode | undefined, bag: DiagnosticBag): Component[] {
  if (!node) return [];
  const components: Component[] = [];

  for (const child of node.children.slice(0, LIMITS.componentsPerElement)) {
    const map = propertyMap(child.children);
    const id = child.key.trim() || `c${components.length + 1}`;

    const fillRaw = text(map, "fill");
    let fill: ColorToken | null = null;
    if (fillRaw) {
      const token = fillRaw.replace(/^\{\{|\}\}$/g, "").trim();
      const known = COLOR_TOKENS.find((entry) => entry === token);
      if (known) {
        fill = known;
      } else if (HEX.test(fillRaw)) {
        // The whole recolouring contract: a literal here cannot follow a family
        // whose accent changed, and the element silently keeps the old colour.
        bag.error("literal_color", `\`${id}\` qattiq HEX rang ishlatadi (${fillRaw}).`, child.line,
          `Rang roli ishlating: ${COLOR_TOKENS.slice(0, 4).map((entry) => `{{${entry}}}`).join(", ")} …`);
      } else {
        bag.warn("unknown_fill", `\`${id}\`: "${fillRaw}" tanilgan rang roli emas.`, child.line);
      }
    }

    const strokeRaw = text(map, "stroke").replace(/^\{\{|\}\}$/g, "").trim();
    const stroke = COLOR_TOKENS.find((entry) => entry === strokeRaw) ?? null;

    components.push({
      id,
      label: text(map, "label", id),
      parent: text(map, "parent") || null,
      shape: oneOf<ShapePrimitive>(text(map, "shape"), SHAPE_PRIMITIVES, "rect", bag, "shape", child.line),
      box: box(map, "box", UNIT_BOX),
      rotation: number(map, "rotation", 0),
      zIndex: Math.round(number(map, "zIndex", components.length)),
      fill,
      stroke,
      strokeWidth: number(map, "strokeWidth", 0),
      opacity: clamp(number(map, "opacity", 1), 0, 1),
      recolorable: boolean(map, "recolorable", fill !== null),
      path: text(map, "path") || null,
    });
  }

  return components;
}

function readGeometry(map: Map<string, ParseNode>, bag: DiagnosticBag, line: number): ElementGeometry {
  const nested = map.get("geometry");
  const source = nested && nested.children.length > 0 ? propertyMap(nested.children) : map;

  const bounds = box(source, "bounds", UNIT_BOX);
  const visualBounds = box(source, "visualBounds", bounds);
  const aspect = number(source, "aspectRatio", 0);

  const anchors: ElementGeometry["anchors"] = {};
  const anchorNode = source.get("anchors");
  for (const child of anchorNode?.children ?? []) {
    const name = ANCHORS.find((entry) => entry === child.key);
    if (!name) continue;
    const parts = child.value.split(/[\s,]+/).map(Number).filter(Number.isFinite);
    if (parts.length >= 2) anchors[name] = { x: parts[0]!, y: parts[1]! };
  }

  const components = readComponents(source.get("components"), bag);
  if (components.length === 0) {
    // Not fatal: an element may ship as an asset rather than as geometry. But a
    // spec with neither is a description of a thing nobody can draw.
    bag.warn("no_components", "Geometriya komponentlari yo'q — bu element faqat asset bilan chiziladi.", line);
  }

  return {
    aspectRatio: aspect > 0 ? aspect : (bounds.width || 1) / (bounds.height || 1),
    bounds,
    visualBounds,
    safeBounds: box(source, "safeBounds", visualBounds),
    visualCenter: (() => {
      const parts = text(source, "visualCenter").split(/[\s,]+/).map(Number).filter(Number.isFinite);
      if (parts.length >= 2) return { x: parts[0]!, y: parts[1]! };
      return { x: visualBounds.x + visualBounds.width / 2, y: visualBounds.y + visualBounds.height / 2 };
    })(),
    dominantAxis: oneOf(text(source, "dominantAxis"), ["horizontal", "vertical", "balanced"] as const, "balanced", bag, "dominantAxis", line),
    originalRotation: number(source, "originalRotation", 0),
    naturalFacing: oneOf<Facing>(text(source, "naturalFacing"), FACINGS, "neutral", bag, "naturalFacing", line),
    anchors,
    components,
  };
}

function readAppearance(map: Map<string, ParseNode>): ElementAppearance {
  const nested = map.get("appearance");
  const source = nested && nested.children.length > 0 ? propertyMap(nested.children) : map;
  return {
    materials: list(source, "materials"),
    roughness: clamp(number(source, "roughness", 0.5), 0, 1),
    metalness: clamp(number(source, "metalness", 0.5), 0, 1),
    edgeSoftness: clamp(number(source, "edgeSoftness", 0.3), 0, 1),
    shadowDirection: text(source, "shadowDirection"),
    shadowSoftness: clamp(number(source, "shadowSoftness", 0.5), 0, 1),
    highlightDirection: text(source, "highlightDirection"),
    emissiveAreas: list(source, "emissiveAreas"),
  };
}

function readUsage(map: Map<string, ParseNode>, bag: DiagnosticBag, line: number): ElementUsage {
  const nested = map.get("usage");
  const source = nested && nested.children.length > 0 ? propertyMap(nested.children) : map;

  const roles = list(source, "slideRoles")
    .map((role) => SLIDE_ROLES.find((entry) => entry.toLowerCase() === role.toLowerCase()))
    .filter((role): role is SlideRole => role !== undefined);

  if (roles.length === 0) {
    bag.warn("no_slide_roles", "Slayd rollari ko'rsatilmagan — rejalashtiruvchi bu elementni tanlay olmaydi.", line);
  }

  return {
    slideRoles: roles,
    bestFor: list(source, "bestFor"),
    avoidFor: list(source, "avoidFor"),
    visualWeight: clamp(number(source, "visualWeight", 5), 1, 10),
    detailDensity: clamp(number(source, "detailDensity", 5), 1, 10),
    recommendedMaxSlideCoverage: clamp(number(source, "recommendedMaxSlideCoverage", 0.45), 0.05, 1),
  };
}

function readTransform(map: Map<string, ParseNode>): TransformRules {
  const nested = map.get("transform");
  const source = nested && nested.children.length > 0 ? propertyMap(nested.children) : map;
  return {
    scalable: boolean(source, "scalable", true),
    rotatable: boolean(source, "rotatable", true),
    recolorable: boolean(source, "recolorable", true),
    opacityEditable: boolean(source, "opacityEditable", true),
    flipHorizontal: boolean(source, "flipHorizontal", true),
    flipVertical: boolean(source, "flipVertical", false),
    // Locked by default: an element stretched out of proportion stops looking
    // like the thing it is, and nobody asks for that on purpose.
    freeTransform: boolean(source, "freeTransform", false),
  };
}

function readElement(section: ParseSection, index: number, bag: DiagnosticBag): JElement | null {
  const map = propertyMap(section.properties);
  const canonicalName = text(map, "canonicalName");

  if (!canonicalName) {
    bag.error("missing_canonical_name", `[ELEMENT ${section.arg || index + 1}] nomsiz.`, section.line,
      "`canonicalName` majburiy — qidiruv shu nom bilan ishlaydi.");
    return null;
  }

  // "green machine" tells a search nothing and stops being true the moment the
  // family is recoloured.
  const looksLikeColour = /^(qora|oq|yashil|ko'k|qizil|black|white|green|blue|red|dark|light)\b/i.test(canonicalName);
  if (looksLikeColour) {
    bag.warn("appearance_name", `"${canonicalName}" ko'rinishga qarab nomlangan.`, section.line,
      "Nom obyekt NIMA ekanini aytsin — rangi oilaning ishi.");
  }

  return {
    index,
    canonicalName: canonicalName.slice(0, LIMITS.nameLength),
    displayName: text(map, "displayName", canonicalName).slice(0, LIMITS.nameLength),
    objectClass: oneOf<ObjectClass>(text(map, "objectClass"), OBJECT_CLASSES, "other", bag, "objectClass", section.line),
    category: text(map, "category"),
    subcategory: text(map, "subcategory"),
    semantic: readSemantics(map, bag, section.line),
    geometry: readGeometry(map, bag, section.line),
    appearance: readAppearance(map),
    usage: readUsage(map, bag, section.line),
    transform: readTransform(map),
  };
}

/* ------------------------------------------------------------- compile */

export function compile(source: string): CompileResult {
  const bag = new DiagnosticBag();
  const parsed = parse(source, bag, DIALECT);

  const sectionsBy = (name: string) => parsed.sections.filter((section) => section.name === name);
  const familySection = sectionsBy("FAMILY")[0];

  if (!familySection) {
    bag.error("missing_family", "[FAMILY] bo'limi topilmadi.", 0, "Har bir spetsifikatsiya `[FAMILY]` bilan boshlanadi.");
  }

  const meta = readFamilyMeta(familySection, bag);
  const colorTokens = readColorTokens(sectionsBy("COLOR_TOKENS")[0], bag);
  const visualDNA = readVisualDNA(sectionsBy("VISUAL_DNA")[0]);
  const search = readFamilySearch(sectionsBy("SEARCH")[0]);

  const elementSections = familySection?.sections ?? [];
  const elements: JElement[] = [];
  const seen = new Map<string, number>();

  for (const [position, section] of elementSections.slice(0, LIMITS.elementsPerFamily).entries()) {
    const element = readElement(section, position, bag);
    if (!element) continue;

    // Two elements with the same name make the library unsearchable: a query
    // matches both and neither is the answer.
    const key = normalizeTerm(element.canonicalName);
    const first = seen.get(key);
    if (first !== undefined) {
      bag.error("duplicate_element", `"${element.canonicalName}" ikki marta uchraydi (${first + 1} va ${position + 1}).`,
        section.line, "Har bir elementning nomi oila ichida yagona bo'lsin.");
      continue;
    }
    seen.set(key, position);
    elements.push(element);
  }

  if (elements.length === 0) bag.error("no_elements", "Birorta element topilmadi.", 0);

  // Every token an element binds to has to exist, or the renderer has nothing
  // to fill the shape with.
  for (const element of elements) {
    for (const component of element.geometry.components) {
      for (const token of [component.fill, component.stroke]) {
        if (token && colorTokens[token] === undefined) {
          bag.error("undefined_token", `\`${element.canonicalName}\` \`{{${token}}}\` roliga bog'langan, lekin oila uni belgilamagan.`,
            0, `[COLOR_TOKENS] ichida \`${token}\` ni belgilang.`);
        }
      }
    }
  }

  const errors = bag.items.filter((item) => item.severity === "error");
  const warnings = bag.items.filter((item) => item.severity === "warning");

  const family: JElementFamily | null = errors.length > 0 ? null : {
    format: "JELEMENT",
    version: parsed.header?.version ?? "1.0",
    family: meta,
    visualDNA,
    colorTokens,
    search,
    elements,
  };

  return {
    family,
    diagnostics: {
      errors: errors.map((item) => ({ code: item.code, message: item.message, line: item.line, hint: item.hint, scope: item.scope })),
      warnings: warnings.map((item) => ({ code: item.code, message: item.message, line: item.line, hint: item.hint, scope: item.scope })),
    },
  };
}
