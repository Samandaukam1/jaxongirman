import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";
import { buildJslayd } from "../../packages/jslayd/tests/build.mjs";

const edge = buildEdgeModules();
const pkg = buildJslayd();

const { buildJslaydSlides, readDesign } = await import(`${edge}/jslayd-layout.js`);
const { compile } = await import(`${pkg}/compile.js`);
const { SAMPLE_PROMPT } = await import(`${pkg}/standard.js`);

const { document: DOCUMENT, diagnostics } = compile(SAMPLE_PROMPT);
assert.deepEqual(diagnostics.errors, [], "the sample design must compile");

/**
 * A design that deliberately hangs two photographs off the canvas.
 *
 * This used to be borrowed from a built-in blueprint, which meant a test of the
 * repair pass depended on a production design continuing to be composed that
 * way. Written here instead: the behaviour under test is "authored geometry is
 * not damage", and the fixture should be the smallest thing that states it.
 */
const BLEEDING_PROMPT = `${SAMPLE_PROMPT}

[SLIDE comparison_bleed]
purpose: comparison
background: background
priority: 95
supportsImage: true

[ELEMENT left_photo]
type: image
x: -120
y: 80
width: 900
height: 620
fit: cover

[ELEMENT right_photo]
type: image
x: 1140
y: 80
width: 900
height: 620
fit: cover

[ELEMENT caption]
type: text
text: {{title}}
x: 120
y: 760
width: 1680
height: 120
font: font_1
fontSize: 44
color: text
`;

const { document: BLEEDING, diagnostics: bleedingDiagnostics } = compile(BLEEDING_PROMPT);
assert.deepEqual(bleedingDiagnostics.errors, [], "the bleeding fixture must compile");

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
  tampered.fonts[0].faces = [{ asset: "../../secret.ttf", format: "ttf", weight: 400, italic: false }];
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
  // Reproduces the live failure that stopped a real deck: a design composed its
  // comparison slide around two photographs hanging off both edges, and the
  // generic repair pass clamped them inward and scored the slide down for it —
  // even though the design placed them there on purpose.
  const document = BLEEDING;
  const archetype = document.archetypes.find((entry) => entry.purpose === "comparison");
  assert.ok(archetype, "the fixture draws a comparison slide");

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
    paletteCode: null,
  });

  const slide = built.slides[0];
  assert.deepEqual(slide.quality_report.issues, [], "authored geometry must not be reported as damage");
  assert.equal(slide.quality_score, 100);

  const images = built.elements.filter((element) => element.type === "image");
  assert.ok(images.some((image) => image.x < 0 || image.x + image.width > 1000),
    "and the photograph must still hang off the edge where the design put it");
});

test("text is still repaired, because only text moves with the content", () => {
  const archetype = BLEEDING.archetypes.find((entry) => entry.purpose === "comparison");
  const design = readDesign({ ...DESIGN_ROW, compiled_config: BLEEDING }).design;

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

/* ------------------------------------------------ the JElement seam ------ */

/**
 * A design that says "a reusable object goes here".
 *
 * The seam is one enum value. JSLAYD owns the slot — where it sits, how big it
 * is, what it is layered against — and an element is one of the things that can
 * fill it. An element that could move itself would be a design deciding its own
 * layout, which is the thing this whole system exists to prevent.
 */
const ELEMENT_SLOT_PROMPT = `${SAMPLE_PROMPT}

[SLIDE jelement_slot]
purpose: text_image
background: background
priority: 96
supportsImage: true

[ELEMENT hero_object]
type: image
slot: hero_object
sourceStrategy: jelement
x: 1000
y: 200
width: 700
height: 600
fit: contain

[ELEMENT caption]
type: text
text: {{title}}
x: 120
y: 400
width: 760
height: 160
font: font_1
fontSize: 56
color: text
`;

const { document: WITH_SLOT, diagnostics: slotDiagnostics } = compile(ELEMENT_SLOT_PROMPT);
assert.deepEqual(slotDiagnostics.errors, [], "a jelement slot must compile");

/** Two shapes of a drawn element, in the element's own 0-1 space. */
const DRAWN = [
  { x: 0.1, y: 0.3, width: 0.8, height: 0.4, rotation: 0, zIndex: 1, opacity: 1, style: { backgroundColor: "#101214", shape: "rect" } },
  { x: 0.2, y: 0.6, width: 0.2, height: 0.2, rotation: 0, zIndex: 2, opacity: 1, style: { backgroundColor: "#A7FF00", shape: "circle" } },
];

function buildWithElement(elements) {
  return buildJslaydSlides({
    presentationId: PRESENTATION,
    ownerId: OWNER,
    design: readDesign({ ...DESIGN_ROW, compiled_config: WITH_SLOT }).design,
    slides: [{
      title: "Konchilikda raqamli texnologiyalar", subtitle: null, purpose: "Namuna",
      layout: "text_image", bullets: [], body: null, quote: null,
      statistic: null, chart: null, table: null, visualPrompt: null,
    }],
    sources: [],
    generatedImages: [],
    uploadedImages: [],
    authorName: null,
    teacherName: null,
    paletteCode: null,
    slideElements: elements,
  });
}

test("an element fills the slot the design placed, not one of its own choosing", () => {
  const built = buildWithElement([{ hero_object: DRAWN }]);
  const drawn = built.elements.filter((row) => row.content?.kind === "jelement");
  assert.equal(drawn.length, 2, "both shapes were drawn");

  // The slot is at 1000,200 700×600 on a 1920-wide canvas, projected to the
  // 1000-wide model the renderers use.
  const scale = 1000 / 1920;
  const slotX = 1000 * scale;
  const slotWidth = 700 * scale;

  const [body] = drawn;
  assert.ok(Math.abs(body.x - (slotX + 0.1 * slotWidth)) < 0.5, "positioned inside the slot");
  assert.ok(Math.abs(body.width - 0.8 * slotWidth) < 0.5, "and scaled to it");
});

test("a slot with no element drawn for it leaves nothing behind", () => {
  // A design offers more slots than every slide fills. An empty one is
  // whitespace, not a hole to paper over.
  const built = buildWithElement([{}]);
  assert.equal(built.elements.filter((row) => row.content?.kind === "jelement").length, 0);
  assert.ok(built.elements.some((row) => row.type === "text"), "the rest of the slide still draws");
});

test("the element never escapes its slot", () => {
  const built = buildWithElement([{ hero_object: DRAWN }]);
  const scale = 1000 / 1920;
  const left = 1000 * scale;
  const right = left + 700 * scale;

  for (const row of built.elements.filter((entry) => entry.content?.kind === "jelement")) {
    assert.ok(row.x >= left - 0.5, `${row.id} started left of the slot`);
    assert.ok(row.x + row.width <= right + 0.5, `${row.id} ran past the slot`);
  }
});

test("the element's own layering survives inside the slot", () => {
  const built = buildWithElement([{ hero_object: DRAWN }]);
  const drawn = built.elements.filter((row) => row.content?.kind === "jelement");
  assert.ok(drawn[1].z_index > drawn[0].z_index, "the accent sits above the body, as the element said");
});
