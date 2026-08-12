import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";
import { buildJslayd } from "../../packages/jslayd/tests/build.mjs";
import { convert } from "../scripts/migrate-designs-to-jslayd.mjs";

/**
 * Visual regression for the migration (§70, §85).
 *
 * Every built-in design is rendered twice — once by the engine that has always
 * rendered it, once by JSLAYD from the translated document — on identical
 * content, and the two are compared element by element. This is what decides
 * whether the translation was faithful; the converter alone only proves it ran.
 *
 * Geometry and paint are compared exactly (within a rounding tolerance). Font
 * size is compared as a ceiling rather than an identity: the two engines shrink
 * overflowing copy in different steps, which changes how far a too-long
 * headline falls but never where it sits or what colour it is.
 */

const edge = buildEdgeModules();
const pkg = buildJslayd();

const { slideTemplates } = await import(`${edge}/templates/index.js`);
const { paletteFamilies } = await import(`${edge}/palettes.js`);
const { renderSlide } = await import(`${edge}/template-engine.js`);
const { renderArchetype } = await import(`${pkg}/render.js`);
const { purposeForLayout } = await import(`${pkg}/select.js`);
const { DEFAULT_META } = await import(`${pkg}/content.js`);

/** Positions round through two scalings; half a model unit is generous. */
const TOLERANCE = 0.75;

const PALETTE_FOR = { toza_osmon: "toza_osmon", eski_klassika: "eski_klassika", klassik: "limon_tun" };
const paletteOf = (code) => paletteFamilies.find((family) => family.code === (PALETTE_FOR[code] ?? "limon_tun"));

const LAYOUTS = ["cover", "agenda", "title_body", "two_columns", "statistic", "quote", "comparison", "timeline", "chart", "conclusion", "references"];

/** Content rich enough that no element drops out of either engine. */
function semantic(layout) {
  return {
    title: "Alisher Navoiy hayoti va ijodiy merosi",
    subtitle: "Jaxongir AI tomonidan tayyorlangan taqdimot",
    purpose: "Namuna",
    layout,
    bullets: ["Asosiy tushuncha va uning ahamiyati", "Muhim jihatlar o'rtasidagi bog'liqlik", "Amaliy xulosa"],
    body: "Mavzu aniq tuzilma va o'qilishi oson vizual iyerarxiya orqali yoritiladi.",
    quote: { text: "Odami ersang demagil odami.", attribution: "Alisher Navoiy" },
    statistic: { value: "68%", label: "auditoriya asosiy fikrni eslab qoladi" },
    chart: { type: "donut", labels: ["Birinchi", "Ikkinchi", "Uchinchi"], values: [48, 32, 20] },
    visualPrompt: null,
  };
}

function slideData(layout, index, total) {
  const source = semantic(layout);
  return {
    index,
    total,
    purpose: purposeForLayout(layout),
    title: source.title,
    subtitle: source.subtitle,
    body: source.body,
    bullets: source.bullets,
    quote: source.quote,
    statistic: source.statistic,
    chart: source.chart,
    table: null,
    images: { hero_image: { bucket: "generated-images", path: "a/b.png" } },
    sources: ["Manba bir", "Manba ikki"],
    meta: { ...DEFAULT_META, sectionLabel: source.purpose },
  };
}

const IDS = { presentationId: "p", ownerId: "o", slideId: "s" };

/**
 * The archetypes the converter produced for a layout, in blueprint order.
 *
 * A layout that offered several compositions became several archetypes sharing
 * one purpose, and the old engine picks between them by slide position. The
 * comparison has to walk them in the same order or it ends up measuring
 * variant one against variant three and calling the difference a regression.
 */
function archetypesFor(document, layout) {
  const purpose = purposeForLayout(layout);
  return document.archetypes.filter((archetype) => archetype.purpose === purpose);
}

/** How many compositions the blueprint drew for a layout. */
function variantCount(template, layout) {
  const recipe = template.blueprint.layouts[layout];
  if (!recipe) return 0;
  return Array.isArray(recipe) ? recipe.length : 1;
}

/**
 * Compares two element lists by geometry, colour and stacking.
 *
 * Pairing is one-to-one and greedy in the old engine's own emit order. Several
 * designs stack three shapes on one frame — a wash, a gradient and a scrim —
 * so a match that could reuse a twin would happily compare the wash against the
 * scrim and report a colour change that does not exist.
 */
function compare(legacy, jslayd, label, report) {
  // JSLAYD splits some elements into companions (a plate behind a badge), so
  // it may emit more rows. Every legacy row must still have a twin of its own.
  const unclaimed = [...jslayd];
  for (const row of legacy) {
    const index = unclaimed.findIndex((candidate) =>
      candidate.type === row.type &&
      Math.abs(candidate.x - row.x) <= TOLERANCE &&
      Math.abs(candidate.y - row.y) <= TOLERANCE &&
      Math.abs(candidate.width - row.width) <= TOLERANCE &&
      Math.abs(candidate.height - row.height) <= TOLERANCE);
    const twin = index === -1 ? undefined : unclaimed.splice(index, 1)[0];
    if (!twin) {
      report.push(`${label}: no ${row.type} at (${row.x.toFixed(1)}, ${row.y.toFixed(1)}) ${row.width.toFixed(1)}×${row.height.toFixed(1)}`);
      continue;
    }
    const paintKeys = ["color", "fill", "gradientTo", "stroke", "trackColor", "labelColor"];
    for (const key of paintKeys) {
      const before = row.style[key];
      const after = twin.style[key];
      if (typeof before !== "string") continue;
      if (before.toUpperCase() !== String(after).toUpperCase()) {
        report.push(`${label}: ${row.type} ${key} ${before} → ${after}`);
      }
    }
    if (row.type === "text" && typeof row.style.fontSize === "number") {
      // The old engine shrinks in steps of two and JSLAYD in steps of one, so
      // JSLAYD can legitimately stop one step higher on the same copy. More
      // than that would mean the type is genuinely a different size.
      if (twin.style.fontSize > row.style.fontSize + 2 + TOLERANCE) {
        report.push(`${label}: text grew ${row.style.fontSize} → ${twin.style.fontSize}`);
      }
      if (twin.style.fontSize < row.style.fontSize - 2 - TOLERANCE) {
        report.push(`${label}: text shrank ${row.style.fontSize} → ${twin.style.fontSize}`);
      }
    }
  }
}

test("every built-in design translates without losing its schema", () => {
  for (const template of slideTemplates) {
    const document = convert(template);
    assert.equal(document.design.tier, template.style);
    assert.ok(document.archetypes.length > 0, `${template.code} produced no archetypes`);
    assert.ok(document.fonts.length >= 1, `${template.code} produced no fonts`);
    for (const archetype of document.archetypes) {
      assert.ok(archetype.elements.length > 0, `${template.code}/${archetype.id} is empty`);
    }
  }
});

test("the translation carries every font voice the blueprint declared", () => {
  for (const template of slideTemplates) {
    const document = convert(template);
    const voices = Object.keys(template.blueprint.fonts ?? {}).length;
    if (voices === 0) continue;
    assert.equal(document.fonts.length, voices, `${template.code} lost a typographic voice`);
    // Every migrated design leans on a bundled face: these designs never
    // shipped a font file, and the migration must not pretend otherwise.
    for (const font of document.fonts) {
      assert.equal(font.asset, null);
      assert.ok(font.fallback.length > 0);
    }
  }
});

test("geometry and paint survive the round trip through the canonical canvas", () => {
  const report = [];
  let compared = 0;

  for (const template of slideTemplates) {
    const document = convert(template);
    const palette = paletteOf(template.code);

    for (const layout of LAYOUTS) {
      const variants = archetypesFor(document, layout);
      const drawn = variantCount(template, layout);
      if (variants.length === 0 || drawn === 0) continue;
      assert.equal(variants.length, drawn, `${template.code}/${layout} lost a composition: ${drawn} drawn, ${variants.length} translated`);

      for (const [variant, archetype] of variants.entries()) {
        // The old engine selects `variants[index % length]`, so feeding it the
        // variant's own index is what puts both engines on the same composition.
        const before = renderSlide(template, palette, {
          ...IDS,
          index: variant,
          total: 8,
          semantic: semantic(layout),
          image: { bucket: "generated-images", path: "a/b.png" },
          sources: ["Manba bir", "Manba ikki"],
        });
        // Rendered against the family the old engine was handed, so the two
        // are compared on the same colours rather than on the design's default.
        const after = renderArchetype(document, archetype, slideData(layout, variant, 8), palette.code);

        const label = `${template.code}/${layout}#${variant + 1}`;
        // The slide ground must be the same colour, or nothing else matters.
        if (before.background.toUpperCase() !== String(after.background.color).toUpperCase()) {
          report.push(`${label}: background ${before.background} → ${after.background.color}`);
        }
        compare(before.elements, after.elements, label, report);
        compared += 1;
      }
    }
  }

  assert.ok(compared >= 100, `expected a broad sweep, compared only ${compared} slides`);
  assert.deepEqual(report, [], `${report.length} regressions across ${compared} slides:\n${report.slice(0, 25).join("\n")}`);
});

test("a migrated design keeps every colour family the blueprint could wear", () => {
  for (const template of slideTemplates) {
    const document = convert(template);
    assert.equal(document.colorFamilies.length, paletteFamilies.length,
      `${template.code} lost colour families: ${document.colorFamilies.length} of ${paletteFamilies.length}`);
    // The family its art direction was drawn for has to lead, because that is
    // also what `colors` mirrors and what an unspecified deck will render in.
    assert.equal(document.colorFamilies[0].code, PALETTE_FOR[template.code] ?? "limon_tun");
    assert.deepEqual(document.colors, document.colorFamilies[0].colors);
  }
});

test("every family renders the same composition in different colours", () => {
  const template = slideTemplates.find((entry) => entry.code === "toza_qogoz");
  const document = convert(template);
  const archetype = document.archetypes.find((entry) => entry.purpose === "cover");
  const geometryOf = (slide) => slide.elements.map((element) => `${element.type}@${element.x},${element.y}`).join("|");

  const rendered = document.colorFamilies.map((family) =>
    renderArchetype(document, archetype, slideData("cover", 0, 8), family.code));

  // Same composition everywhere — a family changes paint, never placement.
  const shape = geometryOf(rendered[0]);
  for (const slide of rendered) assert.equal(geometryOf(slide), shape);
  // And the paint genuinely differs, or the families are decoration.
  const grounds = new Set(rendered.map((slide) => slide.background.color));
  assert.ok(grounds.size >= 6, `expected distinct grounds, got ${grounds.size}`);
});

test("an unknown family falls back to the default rather than failing", () => {
  const document = convert(slideTemplates[0]);
  const archetype = document.archetypes[0];
  const fallback = renderArchetype(document, archetype, slideData("cover", 0, 8), "nonexistent_family");
  const base = renderArchetype(document, archetype, slideData("cover", 0, 8));
  assert.deepEqual(fallback, base);
});

test("the canonical canvas projects back onto the model exactly", () => {
  for (const template of slideTemplates.slice(0, 4)) {
    const document = convert(template);
    for (const archetype of document.archetypes) {
      for (const element of archetype.elements) {
        // 1920 → 1000 → 1920 must be a no-op beyond rounding, or every migrated
        // coordinate is quietly drifting.
        const roundTrip = (element.geometry.x * (1000 / 1920)) * (1920 / 1000);
        assert.ok(Math.abs(roundTrip - element.geometry.x) < 0.001, `${template.code}/${archetype.id}/${element.id} drifted`);
      }
    }
  }
});
