import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";
import { buildJslayd } from "../../packages/jslayd/tests/build.mjs";

const edge = buildEdgeModules();
const pkg = buildJslayd();

const { buildJslaydSlides, readDesign } = await import(`${edge}/jslayd-layout.js`);
const { buildSlides } = await import(`${edge}/layout.js`);
const { resolveTemplate } = await import(`${edge}/templates/index.js`);
const { resolvePalette } = await import(`${edge}/palettes.js`);
const { compile } = await import(`${pkg}/compile.js`);
const { convert } = await import("../scripts/migrate-designs-to-jslayd.mjs");
const { SAMPLE_PROMPT } = await import(`${pkg}/standard.js`);

const { document: DOCUMENT, diagnostics } = compile(SAMPLE_PROMPT);
assert.deepEqual(diagnostics.errors, [], "the sample design must compile");

const DESIGN_ROW = { id: "11110000-0000-4000-8000-000000000001", slug: "apelsen-futuristik", version: 3, compiled_config: DOCUMENT };
const PRESENTATION = "22220000-0000-4000-8000-000000000002";
const OWNER = "33330000-0000-4000-8000-000000000003";

/** The deck shape the pipeline assembles: cover, agenda, body, references, thanks. */
function deck() {
  const slide = (title, layout, extra = {}) => ({
    title, subtitle: null, purpose: "Namuna", layout,
    bullets: [], body: null, quote: null, statistic: null, chart: null, table: null, visualPrompt: null,
    ...extra,
  });
  return [
    slide("Alisher Navoiy", "cover", { subtitle: "Bajardi: Jahongir" }),
    slide("Mavzular rejasi", "agenda", { bullets: ["Birinchi", "Ikkinchi"] }),
    slide("Hayoti va ijodi", "title_body", {
      body: "Mavzu aniq tuzilma orqali yoritiladi.",
      bullets: ["Asosiy tushuncha", "Muhim bog'liqlik", "Amaliy xulosa"],
    }),
    slide("Raqamlarda", "statistic", { statistic: { value: "68%", label: "auditoriya eslab qoladi" } }),
    slide("Taqsimot", "chart", { chart: { type: "donut", labels: ["A", "B", "C"], values: [48, 32, 20] } }),
    slide("Taqqoslash jadvali", "table", {
      table: {
        columns: ["Ko'rsatkich", "2023", "2024"],
        rows: [["Foydalanuvchi", "12 400", "31 900"], ["Taqdimot", "48 200", "126 700"]],
      },
    }),
    slide("Foydalanilgan adabiyotlar", "references"),
    slide("E'tiboringiz uchun rahmat", "thanks"),
  ];
}

const SOURCES = ["Jaxongir AI ichki tahlili, 2025", "Statistika qo'mitasi — stat.uz"];

function build(overrides = {}) {
  return buildJslaydSlides({
    presentationId: PRESENTATION,
    ownerId: OWNER,
    design: readDesign(DESIGN_ROW).design,
    slides: deck(),
    sources: SOURCES,
    generatedImages: [],
    uploadedImages: [],
    authorName: "Jahongir",
    teacherName: "O'qituvchi",
    paletteCode: null,
    ...overrides,
  });
}

/* ------------------------------------------------------------ readDesign */

test("a valid design row is accepted", () => {
  const { design, reason } = readDesign(DESIGN_ROW);
  assert.equal(reason, null);
  assert.equal(design.slug, "apelsen-futuristik");
  assert.equal(design.version, 3);
});

test("a malformed design is refused with a reason instead of throwing", () => {
  for (const config of [null, {}, { format: "PPTX" }, "not json", { format: "JSLAYD", version: "9.9", kind: "design" }]) {
    const { design, reason } = readDesign({ ...DESIGN_ROW, compiled_config: config });
    assert.equal(design, null, `${JSON.stringify(config)} should be refused`);
    assert.ok(reason && reason.length > 0, "a refusal must say why");
  }
  assert.equal(readDesign(null).design, null);
});

test("a tampered document is refused at the boundary, not rendered", () => {
  const tampered = JSON.parse(JSON.stringify(DOCUMENT));
  tampered.fonts[0].asset = "../../secret.ttf";
  assert.equal(readDesign({ ...DESIGN_ROW, compiled_config: tampered }).design, null);
});

/* ------------------------------------------------------------------ rows */

test("a JSLAYD deck produces one slide row per semantic slide", () => {
  const built = build();
  assert.equal(built.slides.length, 8);
  assert.deepEqual(built.slides.map((slide) => slide.position), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(built.elements.length > 0);
});

test("every element row is shaped for the database columns it lands in", () => {
  const built = build();
  const slideIds = new Set(built.slides.map((slide) => slide.id));
  const allowed = new Set(["text", "image", "shape", "icon", "chart", "table", "line", "group"]);
  for (const element of built.elements) {
    assert.ok(slideIds.has(element.slide_id), "an element must belong to a slide of this deck");
    assert.equal(element.presentation_id, PRESENTATION);
    assert.equal(element.owner_id, OWNER);
    assert.ok(allowed.has(element.type), `unknown element type ${element.type}`);
    // `z_index` is an integer column, so a fractional stacking step would be
    // rejected by the insert rather than by anything in the renderer.
    assert.ok(Number.isInteger(element.z_index), `z_index ${element.z_index} is not an integer`);
    for (const key of ["x", "y", "width", "height", "rotation", "opacity"]) {
      assert.ok(Number.isFinite(element[key]), `${key} is not finite`);
    }
    assert.ok(element.opacity >= 0 && element.opacity <= 1);
    assert.equal(typeof element.style, "object");
    assert.equal(typeof element.content, "object");
  }
});

test("geometry satisfies the slide_elements check constraint", () => {
  for (const element of build().elements) {
    assert.ok(element.width > 0 && element.height > 0, "width and height must be positive");
    assert.ok(element.x >= -2000 && element.x <= 3000, `x ${element.x} is outside the stored bound`);
    assert.ok(element.y >= -2000 && element.y <= 3000, `y ${element.y} is outside the stored bound`);
  }
});

test("each slide records which archetype laid it out", () => {
  for (const slide of build().slides) {
    assert.equal(slide.quality_report.engine, "jslayd");
    assert.equal(slide.quality_report.design, "apelsen-futuristik");
    assert.equal(slide.quality_report.design_version, 3);
    assert.ok(typeof slide.quality_report.archetype === "string");
    assert.equal(typeof slide.quality_report.substituted, "boolean");
  }
});

test("the background travels as the payload the canvas reads", () => {
  for (const slide of build().slides) {
    assert.equal(typeof slide.background.color, "string");
    assert.match(slide.background.color, /^#[0-9A-F]{6,8}$/);
  }
});

/* -------------------------------------------------------------- content */

test("the deck's real text reaches the rows", () => {
  const texts = build().elements.filter((element) => element.type === "text").map((element) => element.content.text);
  assert.ok(texts.includes("Alisher Navoiy"), "the cover title must render");
  assert.ok(texts.some((text) => text.includes("68%")), "the statistic must render");
});

test("the bibliography is the only slide that lists sources", () => {
  const built = build();
  const listing = built.slides.filter((slide) => {
    const ids = new Set(built.elements.filter((element) => element.slide_id === slide.id).map((element) => String(element.content.text ?? "")));
    return [...ids].some((text) => text.includes("stat.uz"));
  });
  assert.ok(listing.length <= 1, "sources must not be repeated across the deck");
});

test("a generated image is bound into every image slot the archetype declares", () => {
  const built = build({ generatedImages: [{ slideIndex: 0, bucket: "generated-images", path: "a/b.png", provider: "openai", costUsd: 0 }] });
  const cover = built.slides[0];
  const images = built.elements.filter((element) => element.slide_id === cover.id && element.type === "image");
  assert.ok(images.length >= 1, "the cover archetype draws a picture");
  for (const image of images) {
    assert.equal(image.content.storageBucket, "generated-images");
    assert.equal(image.content.storagePath, "a/b.png");
  }
});

test("researched table data reaches a design's table archetype", () => {
  const built = build();
  const table = built.elements.find((element) => element.type === "table");
  assert.ok(table, "the deck's table slide must render a table");
  assert.deepEqual(table.content.columns, ["Ko'rsatkich", "2023", "2024"]);
  assert.equal(table.content.rows.length, 2);
  assert.equal(table.content.truncated, false);
  // Header and cell faces travel separately, so a design can set them apart.
  assert.ok(typeof table.style.headerFontFamily === "string");
  assert.ok(typeof table.style.cellFontFamily === "string");
});

test("a text row names the face it is set in and the fallback it may need", () => {
  const text = build().elements.find((element) => element.type === "text");
  assert.ok(text.style.fontFamily);
  assert.ok(text.style.fontFallback, "every row must name a bundled fallback for export and load-time");
  assert.match(String(text.style.fontFallback), /^[A-Za-z]+_/);
});

/* ------------------------------------------------------- determinism ---- */

test("building the same deck twice produces the same layout", () => {
  const strip = (built) => ({
    slides: built.slides.map(({ id: _id, ...rest }) => rest),
    elements: built.elements.map(({ id: _id, slide_id: _slide, ...rest }) => rest),
  });
  assert.deepEqual(strip(build()), strip(build()));
});

/* ----------------------------------------------- authored geometry ------ */

test("a deliberately bleeding image is not dragged back onto the slide", () => {
  // Reproduces the live failure that stopped a real deck: `toza_osmon` composes
  // its comparison slide around two photographs that hang off both edges. The
  // generic repair pass clamped them inward and scored the slide down for it,
  // even though the design placed them there on purpose.
  const template = resolveTemplate("toza_osmon", "super_professional");
  const document = convert(template);
  const archetype = document.archetypes.find((entry) => entry.purpose === "comparison");
  assert.ok(archetype, "toza osmon draws a comparison slide");

  const bleeding = archetype.elements.filter(
    (element) => element.type === "image" &&
      (element.geometry.x < 0 || element.geometry.x + element.geometry.width > 1920),
  );
  assert.ok(bleeding.length >= 2, "the composition really does bleed its photographs");

  const built = buildJslaydSlides({
    presentationId: PRESENTATION,
    ownerId: OWNER,
    design: readDesign({ ...DESIGN_ROW, compiled_config: document }).design,
    slides: [{
      title: "Taqqoslash", subtitle: null, purpose: "Namuna", layout: "comparison",
      bullets: ["Birinchi", "Ikkinchi"], body: "Qisqa izoh.", quote: null,
      statistic: null, chart: null, table: null, visualPrompt: null,
    }],
    sources: [],
    generatedImages: [{ slideIndex: 0, bucket: "generated-images", path: "a/b.png", provider: "openai", costUsd: 0 }],
    uploadedImages: [],
    authorName: null,
    teacherName: null,
    paletteCode: "toza_osmon",
  });

  const slide = built.slides[0];
  assert.deepEqual(slide.quality_report.issues, [], "authored geometry must not be reported as damage");
  assert.equal(slide.quality_score, 100);

  const images = built.elements.filter((element) => element.type === "image");
  assert.ok(images.some((image) => image.x < 0 || image.x + image.width > 1000),
    "and the photograph must still hang off the edge where the design put it");
});

test("text is still repaired, because only text moves with the content", () => {
  const template = resolveTemplate("toza_osmon", "super_professional");
  const document = convert(template);
  const archetype = document.archetypes.find((entry) => entry.purpose === "comparison");
  const design = readDesign({ ...DESIGN_ROW, compiled_config: document }).design;

  const built = buildJslaydSlides({
    presentationId: PRESENTATION, ownerId: OWNER, design,
    slides: [{
      title: "Taqqoslash", subtitle: null, purpose: "Namuna", layout: "comparison",
      bullets: [], body: "Juda uzun matn. ".repeat(120), quote: null,
      statistic: null, chart: null, table: null, visualPrompt: null,
    }],
    sources: [], generatedImages: [], uploadedImages: [],
    authorName: null, teacherName: null, paletteCode: null,
  });
  void archetype;

  // Whatever the copy does, the engine never emits type the apps would resize.
  for (const element of built.elements.filter((row) => row.type === "text")) {
    assert.ok(Number(element.style.fontSize) >= 12,
      `font ${element.style.fontSize} is below what every renderer keeps`);
  }
});

/* -------------------------------------------- the built-in path is intact */

test("the built-in blueprint path still builds the same deck it always did", () => {
  const built = buildSlides({
    presentationId: PRESENTATION,
    ownerId: OWNER,
    template: resolveTemplate("toza_osmon", "super_professional"),
    palette: resolvePalette("toza_osmon"),
    slides: deck(),
    sources: SOURCES,
    generatedImages: [],
    uploadedImages: [],
  });
  assert.equal(built.slides.length, 8);
  assert.ok(built.elements.length > 0);
  // The legacy path records no JSLAYD provenance, which is how a reader tells
  // the two apart without guessing.
  assert.equal(built.slides[0].quality_report.engine, undefined);
  assert.equal(built.slides[0].quality_report.template, "toza_osmon");
});
