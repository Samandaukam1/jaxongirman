import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildEdgeModules, repoRoot } from "./build-edge.mjs";
import { buildJslayd } from "../../packages/jslayd/tests/build.mjs";

/**
 * Translates every built-in blueprint into a JSLAYD 1.0 document (§69, §70).
 *
 *   node supabase/scripts/migrate-designs-to-jslayd.mjs           # emit SQL
 *   node supabase/scripts/migrate-designs-to-jslayd.mjs --json    # inspect one
 *
 * The blueprints are already structured data, so this is a translation rather
 * than a rewrite: every frame, colour role, font step, rotation and condition
 * is carried across arithmetically. Hand-authoring fifteen prompts would have
 * been fifteen chances to get a coordinate wrong; a converter gets them all
 * right or all wrong, and the regression test in
 * `supabase/tests/jslayd-migration.test.mjs` is what decides which.
 *
 * What the converter cannot invent, it does not: a blueprint is
 * palette-independent and a JSLAYD 1.0 design carries one colour family, so
 * each design is emitted against the family its art direction was drawn for.
 * The built-in catalogue stays live and unchanged either way (§72) — these rows
 * are additions, and nothing selects them until an admin publishes one.
 */

const edge = buildEdgeModules();
const pkg = buildJslayd();

const { slideTemplates } = await import(`${edge}/templates/index.js`);
const { paletteFamilies } = await import(`${edge}/palettes.js`);
const { serialize, readDocument, contentHash } = await import(`${pkg}/serialize.js`);
const { renderPreview } = await import(`${pkg}/render.js`);
const { CANVAS_WIDTH, RENDER_WIDTH, LEGACY_LAYOUT_TO_PURPOSE } = await import(`${pkg}/spec.js`);

/** Model units → canonical canvas units. Exactly the inverse of RENDER_SCALE. */
const UP = CANVAS_WIDTH / RENDER_WIDTH;
const up = (value) => Math.round(value * UP * 100) / 100;

/** The colour family each design's art direction was drawn against. */
const PALETTE_FOR = {
  toza_osmon: "toza_osmon",
  eski_klassika: "eski_klassika",
  klassik: "limon_tun",
};
const DEFAULT_PALETTE = "limon_tun";

/** Old role names → JSLAYD's. Only two moved; the rest are identical. */
const COLOR_ROLE = { textPrimary: "text" };
const role = (name) => COLOR_ROLE[name] ?? name;

/** A bundled family file name → the display name JSLAYD declares as fallback. */
const FALLBACK_FOR = {
  Manrope: "Manrope",
  LeagueSpartan: "League Spartan",
  Arimo: "Arimo",
  PinyonScript: "Pinyon Script",
  Inter: "Inter",
  CaveatBrush: "Caveat Brush",
};

const WEIGHT_IN_NAME = /_(\d{3})/;

function fontFromFamily(family) {
  const stem = family.split("_")[0];
  return {
    fallback: FALLBACK_FOR[stem] ?? "Manrope",
    weight: Number(WEIGHT_IN_NAME.exec(family)?.[1] ?? 400),
  };
}

/**
 * A blueprint's typographic voices as JSLAYD font declarations.
 *
 * A blueprint names families rather than files, and every family it can name is
 * bundled — so the migrated design declares no asset and leans entirely on its
 * fallback. That is the truthful translation: these designs never shipped a
 * font file, and inventing one would be the migration lying about the design.
 */
function fontsOf(template) {
  const voices = template.blueprint.fonts ?? {};
  const declared = [];
  const roleFor = { display: ["display", "heading"], body: ["body", "caption", "quote", "number"], script: ["subheading"] };

  for (const voice of ["display", "body", "script"]) {
    const family = voices[voice];
    if (!family) continue;
    const { fallback, weight } = fontFromFamily(family);
    declared.push({ voice, fallback, weight, roles: roleFor[voice] });
  }
  if (declared.length === 0) {
    declared.push({ voice: "body", fallback: "Manrope", weight: 400, roles: ["display", "heading", "body", "caption", "quote", "number", "subheading"] });
  }
  // Whatever the blueprint left uncovered goes to the first font, so no element
  // can ask for a role that resolves to nothing.
  const covered = new Set(declared.flatMap((entry) => entry.roles));
  for (const missing of ["display", "heading", "subheading", "body", "caption", "number", "quote"]) {
    if (!covered.has(missing)) declared[0].roles.push(missing);
  }

  const slug = template.code.replace(/-/g, "_");
  return declared.slice(0, 4).map((entry, index) => ({
    id: `font_${index + 1}`,
    name: entry.fallback,
    roles: entry.roles,
    asset: null,
    format: null,
    family: `jslayd_${slug}_font_${index + 1}`,
    fallback: entry.fallback,
    weight: entry.weight,
    italic: false,
  }));
}

/** The font id whose voice a slot asked for. */
function fontIdFor(fonts, template, slot) {
  const voice = slot.family ?? "body";
  const family = template.blueprint.fonts?.[voice];
  if (!family) return fonts[0].id;
  const { fallback } = fontFromFamily(family);
  return (fonts.find((font) => font.fallback === fallback) ?? fonts[0]).id;
}

const TEXT_ROLE_BINDING = {
  title: "title",
  subtitle: "subtitle",
  body: "body",
  statValue: "stat_value",
  statLabel: "stat_label",
  quoteText: "quote_text",
  quoteAttribution: "quote_attribution",
  sources: "sources",
  sectionLabel: "section_label",
  pageNumber: "page_number",
};

function geometry(frame, z, index) {
  const [x, y, width, height] = frame;
  return {
    x: up(x),
    y: up(y),
    width: Math.max(1, up(width)),
    height: Math.max(1, up(height)),
    rotation: 0,
    zIndex: z ?? index,
    anchor: "top-left",
  };
}

function textStyle(template, fonts, slot) {
  const size = up(template.blueprint.type[slot.font]);
  const leading = slot.leading ?? (slot.family === "script" ? 1.34 : 1.22);
  const minimum = slot.fit?.minFont ? up(slot.fit.minFont) : Math.max(8, Math.round(size * 0.6));
  return {
    font: fontIdFor(fonts, template, slot),
    fontSize: size,
    fontWeight: slot.weight ?? 400,
    fontStyle: "normal",
    letterSpacing: up(slot.letterSpacing ?? 0),
    lineHeight: leading,
    align: slot.align ?? "left",
    verticalAlign: "top",
    transform: slot.transform === "upper" ? "uppercase" : "none",
    color: { role: role(slot.color) },
    maxLines: slot.fit?.maxLines ?? null,
    overflow: "shrink",
    minFontSize: Math.min(minimum, size),
    effect: "none",
    shadows: [],
    strokeWidth: 0,
    strokeColor: null,
    highlight: null,
    gradient: null,
    blur: 0,
  };
}

function corners(value) {
  const radius = up(value);
  return { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius };
}

/** One blueprint slot → one JSLAYD element. */
function elementOf(template, fonts, slot, index) {
  const id = `el_${index + 1}`;
  const common = {
    id,
    geometry: geometry(slot.frame, slot.z, index),
    when: slot.when ?? "always",
    opacity: slot.opacity ?? 1,
    grow: Boolean(slot.grow),
  };

  if (slot.kind === "text") {
    const binding = TEXT_ROLE_BINDING[slot.role];
    // `bullets` is a list in JSLAYD, which is what gives it its markers back.
    if (slot.role === "bullets") {
      return {
        ...common,
        type: "list",
        source: { bind: "bullets" },
        marker: "bullet",
        markerColor: { role: role(slot.color) },
        maxItems: slot.fit?.maxItems ?? 5,
        itemSpacing: 0,
        text: textStyle(template, fonts, slot),
      };
    }
    const source = binding
      ? { bind: binding }
      : { literal: slot.literal ?? (slot.role === "brand" ? "JAXONGIR AI" : "") };
    return {
      ...common,
      type: "text",
      source,
      text: textStyle(template, fonts, slot),
      background: null,
      corners: null,
      border: null,
      padding: 0,
    };
  }

  if (slot.kind === "image") {
    return {
      ...common,
      type: "image",
      slot: "hero_image",
      source: { bind: "image_1" },
      strategy: "ai_generated",
      required: false,
      queryFrom: [],
      orientation: "landscape",
      stylePreference: template.artDirection.imageStyle.slice(0, 200),
      fit: "cover",
      focus: { x: 0.5, y: 0.5 },
      corners: corners(slot.mask === "circle" ? Math.min(slot.frame[2], slot.frame[3]) / 2 : slot.radius ?? template.blueprint.radius.image),
      border: null,
      shadows: [],
      overlay: null,
      overlayOpacity: 0.35,
    };
  }

  if (slot.kind === "shape") {
    const [, , width, height] = slot.frame;
    const round = slot.round === "full" ? Math.min(width, height) / 2 : slot.round ?? template.blueprint.radius.card;
    const circle = slot.round === "full" && Math.abs(width - height) < 1;
    return {
      ...common,
      type: "shape",
      shape: circle ? "circle" : "rectangle",
      fill: slot.gradientTo
        ? {
            type: "linear",
            angle: slot.gradientAngle ?? 135,
            stops: [
              { offset: 0, color: { role: role(slot.color) } },
              { offset: 100, color: { role: role(slot.gradientTo) } },
            ],
          }
        : { role: role(slot.color) },
      corners: circle ? null : corners(round),
      border: slot.outline ? { width: up(slot.outlineWidth ?? 1), color: { role: role(slot.outline) }, style: "solid", opacity: 1 } : null,
      // The blueprint's boolean shadow, written out as the object the design
      // was actually drawn against by every renderer that honoured it.
      shadows: slot.shadow ? [{ offsetX: 0, offsetY: up(10), blur: up(22), spread: 0, opacity: 0.16, color: { hex: "#1A1030" } }] : [],
      sides: null,
      thickness: 0,
    };
  }

  if (slot.kind === "chart") {
    return {
      ...common,
      type: "chart",
      chart: slot.chart === "donut" ? "doughnut" : slot.chart,
      source: { bind: "chart_data" },
      palette: null,
      color: { role: role(slot.color) },
      trackColor: { role: role(slot.trackColor ?? "surfaceAlt") },
      labelColor: { role: role(slot.labelColor ?? "textSecondary") },
      axisColor: { role: "border" },
      style: { showLegend: false, showLabels: true, showValues: false, showGrid: false, showAxis: false, cornerRadius: up(6), gap: up(4), strokeWidth: up(slot.chart === "donut" ? 18 : 4) },
      font: fonts[0].id,
      labelSize: up(11),
    };
  }

  return {
    ...common,
    type: "icon",
    icon: slot.icon,
    color: { role: role(slot.color) },
    strokeWidth: 1.85,
  };
}

/**
 * Blueprint layouts → archetypes.
 *
 * A layout that offers several compositions becomes several archetypes sharing
 * one purpose, which is exactly what §41 asks a design to provide and exactly
 * what the engine already rotates between.
 */
function archetypesOf(template, fonts) {
  const archetypes = [];
  const entries = Object.entries(template.blueprint.layouts);

  for (const [layout, recipe] of entries) {
    const variants = Array.isArray(recipe) ? recipe : [recipe];
    const purpose = LEGACY_LAYOUT_TO_PURPOSE[layout] ?? "custom";
    variants.forEach((variant, index) => {
      archetypes.push(buildArchetype(template, fonts, `${purpose}_${String(index + 1).padStart(2, "0")}`, purpose, variant));
    });
  }

  // The fallback recipe is what a layout the blueprint never drew resolves to,
  // so it becomes the design's `title_content` of last resort.
  const fallback = Array.isArray(template.blueprint.fallback) ? template.blueprint.fallback[0] : template.blueprint.fallback;
  if (!archetypes.some((archetype) => archetype.purpose === "title_content")) {
    archetypes.push(buildArchetype(template, fonts, "title_content_fallback", "title_content", fallback));
  }
  return archetypes;
}

function buildArchetype(template, fonts, id, purpose, recipe) {
  const elements = recipe.slots.map((slot, index) => elementOf(template, fonts, slot, index));
  return {
    id,
    purpose,
    background: { role: role(recipe.background ?? "background") },
    selection: {
      minText: 0,
      maxText: 20000,
      supportsImage: elements.some((element) => element.type === "image"),
      supportsChart: elements.some((element) => element.type === "chart"),
      supportsTable: false,
      supportsStats: recipe.slots.some((slot) => slot.kind === "text" && (slot.role === "statValue" || slot.role === "statLabel")),
      supportsQuote: recipe.slots.some((slot) => slot.kind === "text" && slot.role === "quoteText"),
      priority: 50,
    },
    elements: elements.sort((first, second) => first.geometry.zIndex - second.geometry.zIndex),
  };
}

function colorsOf(palette) {
  const { chartSeries: _series, ...tokens } = palette.tokens;
  const mapped = {};
  for (const [name, value] of Object.entries(tokens)) mapped[role(name)] = value;
  // `muted` has no blueprint equivalent; secondary text is what it always meant.
  mapped.muted = mapped.textSecondary;
  return mapped;
}

function visualDnaOf(template, archetypes) {
  const radii = new Set();
  const sizes = [];
  for (const archetype of archetypes) {
    for (const element of archetype.elements) {
      if (element.corners) for (const value of Object.values(element.corners)) radii.add(value);
      if (element.text) sizes.push(element.text.fontSize);
    }
  }
  const sorted = sizes.sort((a, b) => a - b);
  return {
    rotationRange: { min: 0, max: 0 },
    cornerRadiusFamily: radii.size ? [...radii].sort((a, b) => a - b) : [0],
    shadowFamily: [],
    spacingScale: [up(8), up(16), up(24), up(32), up(48), up(72)],
    titleScale: { min: sorted[Math.floor(sorted.length * 0.7)] ?? 48, max: sorted[sorted.length - 1] ?? 140 },
    bodyScale: { min: sorted[0] ?? 20, max: sorted[Math.floor(sorted.length * 0.4)] ?? 40 },
    imageTreatment: template.artDirection.imagePolicy === "none" ? "abstract" : "photo",
    decorationDensity: "medium",
  };
}

export function convert(template) {
  const paletteCode = PALETTE_FOR[template.code] ?? DEFAULT_PALETTE;
  const fonts = fontsOf(template);
  const archetypes = archetypesOf(template, fonts);

  // A blueprint was palette-independent: one design, every family. Carrying all
  // of them across is what keeps migration from costing a design seven-eighths
  // of its range (§29). The family its art direction was drawn for leads, and
  // is therefore also the design's default.
  const ordered = [
    paletteFamilies.find((family) => family.code === paletteCode),
    ...paletteFamilies.filter((family) => family.code !== paletteCode),
  ].filter(Boolean);

  const colorFamilies = ordered.map((family) => ({
    code: family.code,
    name: family.name,
    colors: colorsOf(family),
    chartPalette: [...family.tokens.chartSeries],
  }));

  return {
    format: "JSLAYD",
    version: "1.0",
    kind: "design",
    design: {
      name: template.name,
      slug: template.code.replace(/_/g, "-"),
      tier: template.style,
      description: template.tagline,
      premium: template.style === "super_professional",
      canvas: { width: 1920, height: 1080 },
    },
    colors: colorFamilies[0].colors,
    colorFamilies,
    chartPalette: colorFamilies[0].chartPalette,
    fonts,
    visualDNA: visualDnaOf(template, archetypes),
    archetypes,
  };
}

/* --------------------------------------------------------------------- run */

// The regression test imports `convert` from this module, so nothing below may
// run on import: a test that rewrites a migration as a side effect of loading
// its own subject is a test you cannot trust.
const invoked = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (invoked) await emit();

async function emit() {
const converted = slideTemplates.map((template) => {
  const document = convert(template);
  const read = readDocument(document);
  if (!read.document) {
    throw new Error(`${template.code} did not survive the schema: ${read.diagnostics.errors.map((item) => item.message).join("; ")}`);
  }
  return { template, document };
});

if (process.argv.includes("--json")) {
  const wanted = process.argv[process.argv.indexOf("--json") + 1];
  const hit = converted.find((entry) => entry.template.code === wanted) ?? converted[0];
  console.log(JSON.stringify(hit.document, null, 2));
} else {
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const json = (value) => `${quote(JSON.stringify(value))}::jsonb`;

  // The hash is computed here so a migrated design is publishable the moment an
  // admin opens it — the publish RPC refuses a row that carries no identity.
  const rows = (await Promise.all(converted.map(async ({ template, document }) => {
    const preview = renderPreview(document);
    const hash = await contentHash(document);
    return "  (" + [
      quote(document.design.slug),
      quote(document.design.name),
      quote(template.style),
      quote(document.design.description),
      String(document.design.premium),
      String(template.sortOrder),
      json(document),
      json(preview),
      "'draft'",
      "'1.0'",
      quote(hash),
    ].join(", ") + ")";
  }))).join(",\n");

  const sql = `-- GENERATED FILE — do not edit by hand.
-- Source: supabase/functions/_shared/templates/*.ts, translated by
--   node supabase/scripts/migrate-designs-to-jslayd.mjs
--
-- The built-in designs, expressed as JSLAYD 1.0 documents (§69).
--
-- These rows are ADDITIONS. They arrive as drafts, so nothing selects them and
-- no existing presentation changes; \`slide_templates\` stays the live
-- catalogue until each design has passed visual regression and an admin
-- publishes it deliberately (§72).

insert into public.presentation_designs (
  slug, name, tier, description, is_premium, sort_order, compiled_config, preview,
  status, format_version, content_hash
) values
${rows}
on conflict (slug) do update set
  name = excluded.name,
  tier = excluded.tier,
  description = excluded.description,
  is_premium = excluded.is_premium,
  sort_order = excluded.sort_order,
  compiled_config = excluded.compiled_config,
  preview = excluded.preview,
  content_hash = excluded.content_hash,
  updated_at = now();
`;

  const target = path.join(repoRoot, "supabase", "migrations", "202608120005_jslayd_builtin_designs.sql");
  writeFileSync(target, sql);
  console.log(`✓ ${converted.length} designs translated → ${path.relative(repoRoot, target)}`);
  for (const { template, document } of converted) {
    console.log(`  · ${template.code.padEnd(22)} ${String(document.archetypes.length).padStart(2)} archetypes, ${document.fonts.length} fonts, ${serialize(document).length} bytes`);
  }
}
}
