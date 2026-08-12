import { deriveColorFamily } from "./colors.ts";
import type {
  Archetype,
  NamedColorFamily,
  ChartStyle,
  ColorFamily,
  ColorValue,
  DesignMeta,
  FontDeclaration,
  Gradient,
  JslaydDocument,
  JslaydElement,
  SelectionRules,
  Shadow,
} from "./document.ts";
import { DiagnosticBag, nearestName, type Diagnostics } from "./diagnostics.ts";
import { compileElement, type ElementDefaults } from "./elements.ts";
import { findNode, parse, type ParseNode, type ParseSection } from "./parser.ts";
import {
  ARCHETYPE_PURPOSES,
  CANVAS_HEIGHT,
  CANVAS_LABEL,
  CANVAS_WIDTH,
  COLOR_ROLES,
  FONT_FORMATS,
  FONT_ROLES,
  IDENTIFIER_PATTERN,
  IMAGE_SOURCE_STRATEGIES,
  JSLAYD_FORMAT,
  JSLAYD_KIND,
  JSLAYD_VERSION,
  LIMITS,
  REQUIRED_COLOR_ROLES,
  SLUG_PATTERN,
  TIERS,
  type ArchetypePurpose,
  type ColorRole,
  type FontFormat,
  type FontRole,
  type Tier,
} from "./spec.ts";
import {
  coerceColor,
  coerceEnum,
  coerceNumber,
  readBoolean,
  readColor,
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
 * The JSLAYD compiler: prompt text → a compiled document.
 *
 * Deterministic by construction (§6, §101). Nothing here reads a clock, a
 * random source, the network or the filesystem, and there is no LLM anywhere in
 * the path: the same prompt compiles to byte-identical JSON on every machine,
 * which is what makes the content hash a usable version identity.
 *
 * Strictness is the other half of the contract. `rejectUnknownKeys` runs on
 * every block, so a property the compiler does not consume is an ERROR rather
 * than a silent omission (§50) — a design that renders differently from what it
 * says is the failure this whole layer exists to prevent.
 */

export type CompileResult = {
  document: JslaydDocument | null;
  diagnostics: Diagnostics;
};

/** Defaults from `[GLOBAL]`, applied wherever an element stays silent. */
type Globals = ElementDefaults;

const DEFAULT_CHART_STYLE: ChartStyle = {
  showLegend: false,
  showLabels: true,
  showValues: false,
  showGrid: false,
  showAxis: false,
  cornerRadius: 6,
  gap: 12,
  strokeWidth: 4,
};

const KNOWN_SECTIONS = ["DESIGN", "COLOR_FAMILY", "CHART_PALETTE", "FONTS", "GLOBAL", "VISUAL_DNA", "SLIDE"] as const;

export function compile(source: string): CompileResult {
  const bag = new DiagnosticBag();
  const tree = parse(source, bag);

  for (const section of tree.sections) {
    if ((KNOWN_SECTIONS as readonly string[]).includes(section.name)) continue;
    const suggestion = nearestName(section.name, KNOWN_SECTIONS);
    bag.error(
      "unknown_section",
      `Noma'lum bo'lim: [${section.name}].`,
      section.line,
      suggestion ? `Balki [${suggestion}]?` : `Ruxsat etilganlar: ${KNOWN_SECTIONS.map((name) => `[${name}]`).join(", ")}.`,
    );
  }

  const design = compileDesign(sectionOf(tree.sections, "DESIGN"), bag);
  const families = compileColorFamilies(tree.sections.filter((section) => section.name === "COLOR_FAMILY"), bag);
  const colors = families[0]?.colors ?? null;
  const chartPalette = compileChartPalette(sectionOf(tree.sections, "CHART_PALETTE"), colors, bag);
  // A family that named no chart palette of its own inherits the document's,
  // so a design only has to write one unless a family genuinely needs another.
  const colorFamilies = families.map((family) => ({
    ...family,
    chartPalette: family.chartPalette.length ? family.chartPalette : chartPalette,
  }));
  const fonts = compileFonts(sectionOf(tree.sections, "FONTS"), design?.slug ?? "design", bag);
  const globals = compileGlobals(sectionOf(tree.sections, "GLOBAL"), fonts, bag);

  const slideSections = tree.sections.filter((section) => section.name === "SLIDE");
  const archetypes = compileArchetypes(slideSections, fonts, globals, bag);
  const visualDNA = compileVisualDNA(sectionOf(tree.sections, "VISUAL_DNA"), archetypes, bag);

  if (!design || !colors || fonts.length === 0 || archetypes.length === 0) {
    if (archetypes.length === 0 && slideSections.length === 0) {
      bag.error("no_archetypes", "Dizaynda birorta ham `[SLIDE …]` yo'q.", 0, "Kamida bitta slayd arxetipi kerak.");
    }
    return { document: null, diagnostics: bag.collect() };
  }

  const document: JslaydDocument = {
    format: JSLAYD_FORMAT,
    version: JSLAYD_VERSION,
    kind: JSLAYD_KIND,
    design,
    colors,
    colorFamilies,
    chartPalette,
    fonts,
    visualDNA,
    archetypes,
  };

  const diagnostics = bag.collect();
  return { document: diagnostics.errors.length === 0 ? document : null, diagnostics };
}

function sectionOf(sections: readonly ParseSection[], name: string): ParseSection | undefined {
  return sections.find((section) => section.name === name);
}

/* ------------------------------------------------------------------ design */

const DESIGN_KEYS = ["name", "slug", "tier", "description", "canvas", "premium"];

function compileDesign(section: ParseSection | undefined, bag: DiagnosticBag): DesignMeta | null {
  if (!section) {
    bag.error("missing_section", "[DESIGN] bo'limi yo'q.", 0, "Har bir dizayn [DESIGN] bilan boshlanadi.");
    return null;
  }
  return bag.within("[DESIGN]", () => {
    rejectUnknownKeys(section.properties, DESIGN_KEYS, "[DESIGN]", bag);
    rejectDuplicateKeys(section.properties, [], bag);

    const name = readString(section.properties, "name", bag, 120);
    const slugRaw = readString(section.properties, "slug", bag, LIMITS.identifierLength);
    const tier = readEnum(section.properties, "tier", TIERS, bag);
    const description = readString(section.properties, "description", bag, 400) ?? "";
    const premium = readBoolean(section.properties, "premium", bag) ?? false;

    if (!name) bag.error("missing_property", "`name` ko'rsatilmagan.", section.line);
    if (!tier) bag.error("missing_property", "`tier` ko'rsatilmagan.", section.line, `Ruxsat etilganlar: ${TIERS.join(", ")}.`);

    let slug = slugRaw;
    if (slug && !SLUG_PATTERN.test(slug)) {
      bag.error("bad_slug", `\`slug\` noto'g'ri: "${slug}".`, findNode(section.properties, "slug")?.line ?? section.line, "Faqat kichik lotin harflari, raqamlar va chiziqcha: `apelsen-futuristik`.");
      slug = undefined;
    }
    if (!slug) bag.error("missing_property", "`slug` ko'rsatilmagan.", section.line);

    const canvasNode = findNode(section.properties, "canvas");
    if (canvasNode && canvasNode.value.replace(/\s+/g, "").toLowerCase() !== CANVAS_LABEL) {
      bag.error(
        "unsupported_canvas",
        `\`canvas\` faqat ${CANVAS_LABEL} bo'lishi mumkin, "${canvasNode.value}" berilgan.`,
        canvasNode.line,
        "JSLAYD 1.0 kanonik kanvasi 1920x1080 (16:9).",
      );
    }

    if (!name || !slug || !tier) return null;
    return {
      name,
      slug,
      tier: tier as Tier,
      description,
      premium,
      canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    };
  });
}

/* ----------------------------------------------------------- colour family */

/**
 * The design's colour families (§29).
 *
 * `[COLOR_FAMILY]` is the default and is required. `[COLOR_FAMILY kobalt]` adds
 * another the user can choose between, and every family fills the same role
 * set — that sameness is the whole contract, and it is what lets one design
 * carry eight looks without a single element naming a hex.
 */
function compileColorFamilies(sections: readonly ParseSection[], bag: DiagnosticBag): NamedColorFamily[] {
  if (sections.length === 0) {
    bag.error("missing_section", "[COLOR_FAMILY] bo'limi yo'q.", 0);
    return [];
  }
  if (sections.length > LIMITS.colorFamilies) {
    bag.error("too_many_families", `${sections.length} ta rang oilasi e'lon qilingan.`, sections[0]!.line, `Chegara ${LIMITS.colorFamilies} ta.`);
  }

  const seen = new Set<string>();
  const families: NamedColorFamily[] = [];
  for (const [index, section] of sections.slice(0, LIMITS.colorFamilies).entries()) {
    const code = section.arg || "default";
    if (!IDENTIFIER_PATTERN.test(code)) {
      bag.error("bad_family_code", `Rang oilasi nomi noto'g'ri: "${code}".`, section.line, "Faqat kichik harflar, raqamlar va pastki chiziq.");
      continue;
    }
    if (seen.has(code)) {
      bag.error("duplicate_family", `Rang oilasi ikki marta e'lon qilingan: "${code}".`, section.line);
      continue;
    }
    seen.add(code);
    const colors = compileColorFamily(section, bag);
    if (!colors) continue;
    families.push({
      code,
      name: readString(section.properties, "name", bag, 80) ?? (index === 0 ? "Asosiy" : code),
      colors,
      chartPalette: [],
    });
  }
  return families;
}

function compileColorFamily(section: ParseSection, bag: DiagnosticBag): ColorFamily | null {
  return bag.within(`[COLOR_FAMILY${section.arg ? ` ${section.arg}` : ""}]`, () => {
    rejectUnknownKeys(section.properties, [...COLOR_ROLES, "name"], "[COLOR_FAMILY]", bag);
    rejectDuplicateKeys(section.properties, [], bag);

    const authored: Partial<Record<ColorRole, string>> = {};
    for (const node of section.properties) {
      if (!(COLOR_ROLES as readonly string[]).includes(node.key)) continue;
      const color = coerceColor(node.value, node.key, node.line, bag);
      if (!color) continue;
      if ("role" in color) {
        bag.error(
          "role_alias",
          `\`${node.key}\` boshqa rol nomiga ishora qilyapti.`,
          node.line,
          "Rang oilasida faqat aniq qiymat (#RRGGBB) yoziladi.",
        );
        continue;
      }
      authored[node.key as ColorRole] = color.hex;
    }

    let complete = true;
    for (const role of REQUIRED_COLOR_ROLES) {
      if (authored[role]) continue;
      bag.error("missing_color", `Majburiy rang roli yo'q: \`${role}\`.`, section.line);
      complete = false;
    }
    if (!complete) return null;

    const derived = deriveColorFamily(authored);
    for (const role of COLOR_ROLES) {
      if (authored[role]) continue;
      bag.info("derived_color", `\`${role}\` roli avtomatik hisoblandi: ${derived[role]}.`, section.line, "Aniq qiymat berish uchun uni [COLOR_FAMILY] ichida yozing.");
    }
    return derived;
  });
}

function compileChartPalette(section: ParseSection | undefined, family: ColorFamily | null, bag: DiagnosticBag): string[] {
  const fallback = family ? [family.primary, family.accent, family.secondary, family.muted] : ["#111111", "#888888"];
  if (!section) return fallback;
  return bag.within("[CHART_PALETTE]", () => {
    rejectUnknownKeys(section.properties, ["colors"], "[CHART_PALETTE]", bag);
    const node = findNode(section.properties, "colors");
    if (!node) {
      bag.error("missing_property", "`colors` ko'rsatilmagan.", section.line);
      return fallback;
    }
    const parts = splitList(node.value);
    if (parts.length > LIMITS.chartPaletteColors) {
      bag.error("palette_too_long", `Diagramma palitrasida ${parts.length} ta rang bor.`, node.line, `Chegara ${LIMITS.chartPaletteColors} ta.`);
    }
    const colors: string[] = [];
    for (const part of parts.slice(0, LIMITS.chartPaletteColors)) {
      const color = coerceColor(part, "colors", node.line, bag);
      if (!color) continue;
      colors.push("role" in color ? (family ? family[color.role] : "#111111") : color.hex);
    }
    if (colors.length === 0) {
      bag.error("empty_palette", "Diagramma palitrasi bo'sh.", node.line);
      return fallback;
    }
    return colors;
  });
}

/* ------------------------------------------------------------------- fonts */

const FONT_KEYS = ["name", "role", "roles", "asset", "format", "weight", "italic", "fallback"];
const FONT_ID_PATTERN = /^font_([1-4])$/;

/** Bundled faces a design may name as its export/loading fallback (§78). */
const BUNDLED_FALLBACKS = [
  "Manrope", "League Spartan", "Arimo", "Pinyon Script", "Inter", "Caveat Brush",
] as const;

function compileFonts(section: ParseSection | undefined, slug: string, bag: DiagnosticBag): FontDeclaration[] {
  if (!section) {
    bag.error("missing_section", "[FONTS] bo'limi yo'q.", 0, "Kamida bitta shrift e'lon qilinishi kerak.");
    return [];
  }
  return bag.within("[FONTS]", () => {
    // A font is a bare `font_N:` marker owning either indented children or the
    // flat properties that follow it — both spellings appear in the standard,
    // and both mean exactly the same record.
    const records: { id: string; line: number; nodes: ParseNode[] }[] = [];
    for (const node of section.properties) {
      const match = FONT_ID_PATTERN.exec(node.key);
      if (match) {
        if (node.value) {
          bag.error("font_marker_value", `\`${node.key}\` qiymat qabul qilmaydi.`, node.line, "Shrift xossalarini keyingi qatorlarda yozing.");
        }
        records.push({ id: node.key, line: node.line, nodes: [...node.children] });
        continue;
      }
      const current = records[records.length - 1];
      if (!current) {
        bag.error("font_property_without_font", `\`${node.key}\` hech qaysi shriftga tegishli emas.`, node.line, "Avval `font_1:` deb e'lon qiling.");
        continue;
      }
      current.nodes.push(node);
    }

    if (records.length === 0) {
      bag.error("no_fonts", "[FONTS] ichida birorta shrift yo'q.", section.line, "`font_1:` bilan boshlang.");
      return [];
    }
    if (records.length > LIMITS.fonts) {
      bag.error("too_many_fonts", `${records.length} ta shrift e'lon qilingan.`, section.line, `Chegara ${LIMITS.fonts} ta.`);
    }

    const seen = new Set<string>();
    const fonts: FontDeclaration[] = [];
    for (const record of records.slice(0, LIMITS.fonts)) {
      if (seen.has(record.id)) {
        bag.error("duplicate_font", `\`${record.id}\` ikki marta e'lon qilingan.`, record.line);
        continue;
      }
      seen.add(record.id);
      const font = bag.within(record.id, () => compileFont(record.id, record.nodes, record.line, slug, bag));
      if (font) fonts.push(font);
    }

    if (!fonts.some((font) => font.id === "font_1")) {
      bag.error("missing_primary_font", "`font_1` majburiy.", section.line, "Asosiy shrift har doim `font_1` bo'ladi.");
    }
    const covered = new Set(fonts.flatMap((font) => font.roles));
    for (const role of FONT_ROLES) {
      if (covered.has(role)) continue;
      bag.info("uncovered_font_role", `\`${role}\` roli uchun shrift tayinlanmagan.`, section.line, "Element uni so'rasa, `font_1` ishlatiladi.");
    }
    return fonts;
  });
}

function compileFont(id: string, nodes: ParseNode[], line: number, slug: string, bag: DiagnosticBag): FontDeclaration | null {
  rejectUnknownKeys(nodes, FONT_KEYS, `[FONTS] ${id}`, bag);
  rejectDuplicateKeys(nodes, [], bag);

  const roleNode = findNode(nodes, "role") ?? findNode(nodes, "roles");
  const roles: FontRole[] = [];
  if (roleNode) {
    for (const part of splitList(roleNode.value)) {
      const role = coerceEnum(part, "role", FONT_ROLES, roleNode.line, bag);
      if (role && !roles.includes(role)) roles.push(role);
    }
  }
  if (roles.length === 0) {
    bag.error("missing_property", `\`role\` ko'rsatilmagan.`, line, `Ruxsat etilganlar: ${FONT_ROLES.join(", ")}.`);
    return null;
  }

  const asset = readString(nodes, "asset", bag, 200) ?? null;
  let format: FontFormat | null = null;
  if (asset) {
    if (asset.includes("..") || asset.includes("/") || asset.includes("\\")) {
      // A font asset names a file the admin uploaded, never a path. Rejecting
      // separators outright is what keeps a `.jslayd` from reaching anything
      // outside its own bucket prefix (§82).
      bag.error("unsafe_asset", `\`asset\` yo'l ajratuvchisi bo'lishi mumkin emas: "${asset}".`, findNode(nodes, "asset")?.line ?? line, "Faqat fayl nomini yozing: `apelsen-display.ttf`.");
      return null;
    }
    const extension = asset.toLowerCase().split(".").pop() ?? "";
    if ((FONT_FORMATS as readonly string[]).includes(extension)) format = extension as FontFormat;
    else {
      bag.error(
        "unsupported_font_format",
        `Shrift formati qo'llab-quvvatlanmaydi: ".${extension}".`,
        findNode(nodes, "asset")?.line ?? line,
        `Ruxsat etilganlar: ${FONT_FORMATS.map((value) => `.${value}`).join(", ")}. WOFF2 PDF eksportida ishlamaydi.`,
      );
      return null;
    }
  } else {
    bag.warn("font_without_asset", `\`${id}\` uchun shrift fayli biriktirilmagan.`, line, "Fayl yuklanmaguncha zaxira shrift chiziladi.");
  }
  const declaredFormat = readEnum(nodes, "format", FONT_FORMATS, bag);
  if (declaredFormat && format && declaredFormat !== format) {
    bag.warn("format_mismatch", `\`format\` (${declaredFormat}) fayl kengaytmasiga (${format}) mos emas.`, line, "Kengaytma ustun keladi.");
  }

  const fallback = readString(nodes, "fallback", bag, 64) ?? "Manrope";
  if (!(BUNDLED_FALLBACKS as readonly string[]).includes(fallback)) {
    bag.error(
      "unknown_fallback",
      `Noma'lum zaxira shrift: "${fallback}".`,
      findNode(nodes, "fallback")?.line ?? line,
      `Faqat ilova bilan birga keladigan shriftlar: ${BUNDLED_FALLBACKS.join(", ")}.`,
    );
  }

  const weight = readInteger(nodes, "weight", bag, { min: 100, max: 900 }) ?? 400;
  const italic = readBoolean(nodes, "italic", bag) ?? false;
  const name = readString(nodes, "name", bag, 80) ?? (asset ? asset.replace(/\.[^.]+$/, "") : `Shrift ${id.slice(-1)}`);

  return {
    id,
    name,
    roles,
    asset,
    format,
    // Namespacing by slug is what lets two designs ship different files under
    // the same human name without one overwriting the other's registration in
    // a long-lived app process.
    family: `jslayd_${slug.replace(/-/g, "_")}_${id}`,
    fallback: (BUNDLED_FALLBACKS as readonly string[]).includes(fallback) ? fallback : "Manrope",
    weight,
    italic,
  };
}

/* ------------------------------------------------------------------ global */

const GLOBAL_KEYS = [
  "margin", "titleFont", "bodyFont", "accentFont", "headingColor", "textColor", "imageStrategy",
  "showLegend", "showLabels", "showValues", "showGrid", "showAxis", "chartCornerRadius", "chartGap", "chartStrokeWidth",
];

function compileGlobals(section: ParseSection | undefined, fonts: readonly FontDeclaration[], bag: DiagnosticBag): Globals {
  const base: Globals = {
    margin: 96,
    titleFont: null,
    bodyFont: null,
    accentFont: null,
    headingColor: null,
    textColor: null,
    imageStrategy: "internet_search",
    chart: { ...DEFAULT_CHART_STYLE },
  };
  if (!section) return base;

  return bag.within("[GLOBAL]", () => {
    rejectUnknownKeys(section.properties, GLOBAL_KEYS, "[GLOBAL]", bag);
    rejectDuplicateKeys(section.properties, [], bag);
    const fontRef = (key: string) => {
      const node = findNode(section.properties, key);
      if (!node) return null;
      return resolveFontReference(node.value, key, node.line, fonts, bag);
    };
    return {
      margin: readNumber(section.properties, "margin", bag, { min: 0, max: 480 }) ?? base.margin,
      titleFont: fontRef("titleFont"),
      bodyFont: fontRef("bodyFont"),
      accentFont: fontRef("accentFont"),
      headingColor: readColor(section.properties, "headingColor", bag) ?? null,
      textColor: readColor(section.properties, "textColor", bag) ?? null,
      imageStrategy: readEnum(section.properties, "imageStrategy", IMAGE_SOURCE_STRATEGIES, bag) ?? base.imageStrategy,
      chart: {
        showLegend: readBoolean(section.properties, "showLegend", bag) ?? base.chart.showLegend,
        showLabels: readBoolean(section.properties, "showLabels", bag) ?? base.chart.showLabels,
        showValues: readBoolean(section.properties, "showValues", bag) ?? base.chart.showValues,
        showGrid: readBoolean(section.properties, "showGrid", bag) ?? base.chart.showGrid,
        showAxis: readBoolean(section.properties, "showAxis", bag) ?? base.chart.showAxis,
        cornerRadius: readNumber(section.properties, "chartCornerRadius", bag, { min: 0, max: 200 }) ?? base.chart.cornerRadius,
        gap: readNumber(section.properties, "chartGap", bag, { min: 0, max: 200 }) ?? base.chart.gap,
        strokeWidth: readNumber(section.properties, "chartStrokeWidth", bag, { min: 0, max: 40 }) ?? base.chart.strokeWidth,
      },
    };
  });
}

/**
 * A font reference is a declared id (`font_1`) or a role (`heading`). Roles
 * resolve to the first font that claims them, so a design can be written
 * against duties rather than slots and still compile to concrete faces.
 */
function resolveFontReference(raw: string, key: string, line: number, fonts: readonly FontDeclaration[], bag: DiagnosticBag): string | null {
  const value = raw.trim();
  const byId = fonts.find((font) => font.id === value);
  if (byId) return byId.id;
  if ((FONT_ROLES as readonly string[]).includes(value)) {
    const byRole = fonts.find((font) => font.roles.includes(value as FontRole));
    if (byRole) return byRole.id;
    bag.warn("font_role_unassigned", `\`${key}\`: \`${value}\` roliga shrift tayinlanmagan.`, line, "`font_1` ishlatiladi.");
    return fonts[0]?.id ?? null;
  }
  const names = [...fonts.map((font) => font.id), ...FONT_ROLES];
  const suggestion = nearestName(value, names);
  bag.error(
    "unknown_font",
    `\`${key}\`: noma'lum shrift "${value}".`,
    line,
    suggestion ? `Balki "${suggestion}"?` : `Ruxsat etilganlar: ${names.join(", ")}.`,
  );
  return null;
}

/* ------------------------------------------------------------- visual DNA */

const VISUAL_DNA_KEYS = [
  "rotationRange", "cornerRadiusFamily", "shadowFamily", "shadow", "shadows",
  "spacingScale", "titleScale", "bodyScale", "imageTreatment", "decorationDensity",
];
const IMAGE_TREATMENTS = ["photo", "illustration", "render3d", "abstract", "mixed"] as const;
const DECORATION_DENSITIES = ["none", "low", "medium", "high"] as const;

function compileVisualDNA(section: ParseSection | undefined, archetypes: readonly Archetype[], bag: DiagnosticBag) {
  // Undeclared bounds are measured off the design itself rather than guessed.
  // A generator's safe adjustments then stay inside what the author actually
  // drew, which is the honest reading of "do not break the visual DNA" (§46).
  const observed = observeVisualDNA(archetypes);
  if (!section) return observed;

  return bag.within("[VISUAL_DNA]", () => {
    rejectUnknownKeys(section.properties, VISUAL_DNA_KEYS, "[VISUAL_DNA]", bag);
    const range = (key: string, fallback: { min: number; max: number }) => {
      const node = findNode(section.properties, key);
      if (!node) return fallback;
      const parts = node.value.split(/\.\.|\s*,\s*|\s+/).filter(Boolean);
      if (parts.length !== 2) {
        bag.error("bad_range", `\`${key}\` ikkita son kutadi: "${node.value}".`, node.line, "Format: `-6..6`.");
        return fallback;
      }
      const min = coerceNumber(parts[0]!, key, node.line, bag);
      const max = coerceNumber(parts[1]!, key, node.line, bag);
      if (min === undefined || max === undefined) return fallback;
      return { min: Math.min(min, max), max: Math.max(min, max) };
    };
    const numbers = (key: string, fallback: readonly number[]) => {
      const node = findNode(section.properties, key);
      if (!node) return fallback;
      const values = splitList(node.value)
        .map((part) => coerceNumber(part, key, node.line, bag))
        .filter((value): value is number => value !== undefined);
      return values.length ? [...new Set(values)].sort((first, second) => first - second) : fallback;
    };
    const declaredShadows = readShadows(section.properties.filter((node) => node.key !== "shadowFamily"), bag);
    const familyNode = findNode(section.properties, "shadowFamily");
    const familyShadows = familyNode ? readShadows([{ ...familyNode, key: "shadow" }], bag) : [];

    return {
      rotationRange: range("rotationRange", observed.rotationRange),
      cornerRadiusFamily: numbers("cornerRadiusFamily", observed.cornerRadiusFamily),
      shadowFamily: [...familyShadows, ...declaredShadows].length ? [...familyShadows, ...declaredShadows] : observed.shadowFamily,
      spacingScale: numbers("spacingScale", observed.spacingScale),
      titleScale: range("titleScale", observed.titleScale),
      bodyScale: range("bodyScale", observed.bodyScale),
      imageTreatment: readEnum(section.properties, "imageTreatment", IMAGE_TREATMENTS, bag) ?? observed.imageTreatment,
      decorationDensity: readEnum(section.properties, "decorationDensity", DECORATION_DENSITIES, bag) ?? observed.decorationDensity,
    };
  });
}

function observeVisualDNA(archetypes: readonly Archetype[]) {
  const rotations: number[] = [];
  const radii = new Set<number>();
  const fontSizes: number[] = [];
  const shadows: Shadow[] = [];
  let decorative = 0;
  let elements = 0;
  let images = 0;

  const visit = (list: readonly JslaydElement[]) => {
    for (const element of list) {
      elements += 1;
      rotations.push(element.geometry.rotation);
      if ("corners" in element && element.corners) {
        for (const value of Object.values(element.corners)) radii.add(value);
      }
      if ("shadows" in element && element.shadows) shadows.push(...element.shadows);
      if ("text" in element) fontSizes.push(element.text.fontSize);
      if (element.type === "decorative" || element.type === "divider") decorative += 1;
      if (element.type === "image" || element.type === "frame") images += 1;
      if (element.type === "group") visit(element.children);
    }
  };
  for (const archetype of archetypes) visit(archetype.elements);

  const sorted = [...fontSizes].sort((first, second) => first - second);
  const density = elements === 0 ? "none" : decorative / elements;
  return {
    rotationRange: rotations.length
      ? { min: Math.min(...rotations), max: Math.max(...rotations) }
      : { min: 0, max: 0 },
    cornerRadiusFamily: radii.size ? [...radii].sort((first, second) => first - second) : [0],
    shadowFamily: dedupeShadows(shadows),
    spacingScale: [8, 16, 24, 32, 48, 64, 96],
    titleScale: sorted.length ? { min: sorted[Math.floor(sorted.length * 0.7)]!, max: sorted[sorted.length - 1]! } : { min: 48, max: 140 },
    bodyScale: sorted.length ? { min: sorted[0]!, max: sorted[Math.floor(sorted.length * 0.4)]! } : { min: 20, max: 40 },
    imageTreatment: (images > 0 ? "photo" : "abstract") as "photo" | "abstract",
    decorationDensity: (typeof density === "string" ? "none" : density > 0.35 ? "high" : density > 0.15 ? "medium" : density > 0 ? "low" : "none") as "none" | "low" | "medium" | "high",
  };
}

function dedupeShadows(shadows: readonly Shadow[]): Shadow[] {
  const seen = new Map<string, Shadow>();
  for (const shadow of shadows) seen.set(JSON.stringify(shadow), shadow);
  return [...seen.values()];
}

/* -------------------------------------------------------------- archetypes */

const SLIDE_KEYS = [
  "purpose", "background", "backgroundGradient",
  "minText", "maxText", "priority",
  "supportsImage", "supportsChart", "supportsTable", "supportsStats", "supportsQuote",
];

function compileArchetypes(
  sections: readonly ParseSection[],
  fonts: readonly FontDeclaration[],
  globals: Globals,
  bag: DiagnosticBag,
): Archetype[] {
  if (sections.length > LIMITS.archetypes) {
    bag.error("too_many_archetypes", `${sections.length} ta arxetip e'lon qilingan.`, sections[0]?.line ?? 0, `Chegara ${LIMITS.archetypes} ta.`);
  }
  const seen = new Set<string>();
  const archetypes: Archetype[] = [];
  let total = 0;

  for (const section of sections.slice(0, LIMITS.archetypes)) {
    const id = section.arg;
    if (!id) {
      bag.error("missing_archetype_id", "[SLIDE] nomsiz.", section.line, "Format: `[SLIDE cover_01]`.");
      continue;
    }
    if (!IDENTIFIER_PATTERN.test(id) || id.length > LIMITS.identifierLength) {
      bag.error("bad_archetype_id", `Arxetip nomi noto'g'ri: "${id}".`, section.line, "Faqat kichik harflar, raqamlar va pastki chiziq: `text_image_02`.");
      continue;
    }
    if (seen.has(id)) {
      bag.error("duplicate_archetype", `Arxetip ikki marta e'lon qilingan: "${id}".`, section.line);
      continue;
    }
    seen.add(id);

    const archetype = bag.within(`[SLIDE ${id}]`, () => compileArchetype(id, section, fonts, globals, bag));
    if (!archetype) continue;
    total += archetype.elements.length;
    if (total > LIMITS.elementsPerDocument) {
      bag.error("too_many_elements", `Dizaynda ${total} dan ortiq element bor.`, section.line, `Chegara ${LIMITS.elementsPerDocument} ta.`);
      break;
    }
    archetypes.push(archetype);
  }
  return archetypes;
}

function compileArchetype(
  id: string,
  section: ParseSection,
  fonts: readonly FontDeclaration[],
  globals: Globals,
  bag: DiagnosticBag,
): Archetype | null {
  rejectUnknownKeys(section.properties, SLIDE_KEYS, `[SLIDE ${id}]`, bag);
  rejectDuplicateKeys(section.properties, [], bag);

  const purpose = readEnum(section.properties, "purpose", ARCHETYPE_PURPOSES, bag);
  if (!purpose) {
    bag.error("missing_property", "`purpose` ko'rsatilmagan.", section.line, `Ruxsat etilganlar: ${ARCHETYPE_PURPOSES.join(", ")}.`);
    return null;
  }

  const gradient = readGradient(section.properties, "backgroundGradient", bag);
  const background: ColorValue | Gradient = gradient ?? readColor(section.properties, "background", bag) ?? { role: "background" };

  if (section.sections.length > LIMITS.elementsPerArchetype) {
    bag.error("too_many_elements", `Arxetipda ${section.sections.length} ta element bor.`, section.line, `Chegara ${LIMITS.elementsPerArchetype} ta.`);
  }

  const flat: { element: JslaydElement; parent: string | null }[] = [];
  const ids = new Set<string>();
  for (const elementSection of section.sections.slice(0, LIMITS.elementsPerArchetype)) {
    const elementId = elementSection.arg;
    if (!elementId || !IDENTIFIER_PATTERN.test(elementId)) {
      bag.error("bad_element_id", `Element nomi noto'g'ri: "${elementId}".`, elementSection.line, "Format: `[ELEMENT title]`.");
      continue;
    }
    if (ids.has(elementId)) {
      bag.error("duplicate_element", `Element ikki marta e'lon qilingan: "${elementId}".`, elementSection.line);
      continue;
    }
    ids.add(elementId);
    const compiled = bag.within(`[ELEMENT ${elementId}]`, () => compileElement(elementId, elementSection, fonts, globals, bag));
    if (compiled) flat.push(compiled);
  }

  const elements = nest(flat, ids, bag, section.line);
  if (elements.length === 0) {
    bag.error("empty_archetype", `Arxetipda birorta element yo'q: "${id}".`, section.line);
    return null;
  }

  const selection: SelectionRules = {
    minText: readInteger(section.properties, "minText", bag, { min: 0, max: 20000 }) ?? 0,
    maxText: readInteger(section.properties, "maxText", bag, { min: 0, max: 20000 }) ?? 20000,
    supportsImage: readBoolean(section.properties, "supportsImage", bag) ?? elements.some((element) => element.type === "image" || element.type === "frame"),
    supportsChart: readBoolean(section.properties, "supportsChart", bag) ?? elements.some((element) => element.type === "chart"),
    supportsTable: readBoolean(section.properties, "supportsTable", bag) ?? elements.some((element) => element.type === "table"),
    supportsStats: readBoolean(section.properties, "supportsStats", bag) ?? elements.some((element) => element.type === "stat"),
    supportsQuote: readBoolean(section.properties, "supportsQuote", bag) ?? elements.some((element) => element.type === "quote"),
    priority: readInteger(section.properties, "priority", bag, { min: 0, max: 100 }) ?? 50,
  };
  if (selection.minText > selection.maxText) {
    bag.error("bad_text_range", `\`minText\` (${selection.minText}) \`maxText\` (${selection.maxText}) dan katta.`, section.line);
  }

  return { id, purpose: purpose as ArchetypePurpose, background, selection, elements };
}

/**
 * Folds `parent:` references into real group children.
 *
 * Groups are declared flat and linked by name rather than by nesting brackets:
 * one bracket form is easier to write correctly, and a cycle is impossible
 * because a child may only name a group declared before it.
 */
function nest(
  flat: readonly { element: JslaydElement; parent: string | null }[],
  ids: ReadonlySet<string>,
  bag: DiagnosticBag,
  line: number,
): JslaydElement[] {
  const groups = new Map<string, { origin: JslaydElement; children: JslaydElement[] }>();
  for (const entry of flat) {
    if (entry.element.type === "group") groups.set(entry.element.id, { origin: entry.element, children: [] });
  }

  const roots: JslaydElement[] = [];
  for (const entry of flat) {
    if (!entry.parent) {
      roots.push(entry.element);
      continue;
    }
    const group = groups.get(entry.parent);
    if (!group) {
      bag.error(
        "unknown_parent",
        `\`parent: ${entry.parent}\` — bunday guruh yo'q.`,
        line,
        ids.has(entry.parent) ? "Ko'rsatilgan element `type: group` emas." : "Guruh element o'zidan oldin e'lon qilinishi kerak.",
      );
      roots.push(entry.element);
      continue;
    }
    if (entry.parent === entry.element.id) {
      bag.error("self_parent", `\`${entry.element.id}\` o'zini o'ziga bog'ladi.`, line);
      roots.push(entry.element);
      continue;
    }
    // A group's box becomes its children's origin, so joining a group is also a
    // translation: move the group and everything inside it follows (§20).
    group.children.push({
      ...entry.element,
      geometry: {
        ...entry.element.geometry,
        x: Math.round((entry.element.geometry.x - group.origin.geometry.x) * 100) / 100,
        y: Math.round((entry.element.geometry.y - group.origin.geometry.y) * 100) / 100,
      },
    });
  }

  const attach = (element: JslaydElement): JslaydElement =>
    element.type === "group"
      ? { ...element, children: (groups.get(element.id)?.children ?? []).map(attach) }
      : element;

  return roots.map(attach).sort((first, second) => first.geometry.zIndex - second.geometry.zIndex);
}
