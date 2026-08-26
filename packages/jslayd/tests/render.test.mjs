import assert from "node:assert/strict";
import test from "node:test";

import { buildJslayd } from "./build.mjs";

const dir = buildJslayd();
const { compile } = await import(`${dir}/compile.js`);
const { renderArchetype, renderPreview, renderAllPreviews, bundledFace } = await import(`${dir}/render.js`);
const { selectArchetypes, purposeForLayout } = await import(`${dir}/select.js`);
const { previewSlide } = await import(`${dir}/content.js`);
const { SAMPLE_PROMPT } = await import(`${dir}/standard.js`);
const { RENDER_SCALE, RENDER_WIDTH, RENDER_HEIGHT, CANVAS_WIDTH } = await import(`${dir}/spec.js`);

/**
 * The sample design, plus one font file.
 *
 * The standard's example names Google families and ships no `face:` lines,
 * because the library supplies the files — which is what a design should do and
 * what the fonts section now says. Tests about file paths, legacy shapes and
 * uploaded assets have to supply their own file rather than borrow one from an
 * example that no longer has any.
 */
const withFace = (prompt) => {
  const at = prompt.indexOf("[FONTS]");
  if (at === -1) throw new Error("the standard has no [FONTS] block");
  const head = prompt.slice(0, at);
  const tail = prompt.slice(at).replace(/^(\s*)role: (.*)$/m, "$1role: $2\n$1face: sample-display.ttf 400");
  return `${head}${tail}`;
};


const { document: DESIGN, diagnostics } = compile(SAMPLE_PROMPT);
assert.deepEqual(diagnostics.errors, [], "the sample must compile before rendering can be tested");

const archetypeBy = (id) => DESIGN.archetypes.find((entry) => entry.id === id);

/** The same design with one font file attached, for the tests that need one. */
const { document: DESIGN_WITH_FACE } = compile(withFace(SAMPLE_PROMPT));
const elementsOf = (slide, type) => slide.elements.filter((element) => element.type === type);

/** A slide carrying everything a design can ask for. */
function fullSlide(purpose, overrides = {}) {
  return { ...previewSlide(purpose), images: { hero_image: { bucket: "images", path: "a/b.png" } }, ...overrides };
}

/* ------------------------------------------------------------ coordinates */

test("canvas units are projected onto the render model exactly", () => {
  const slide = renderArchetype(DESIGN, archetypeBy("cover_01"), fullSlide("cover"));
  const title = slide.elements.find((element) => element.content.text?.startsWith("G'oyangizni"));
  assert.ok(title);
  // Authored at x: 120 on the 1920-wide canvas.
  assert.equal(title.x, Math.round(120 * RENDER_SCALE * 100) / 100);
  assert.equal(RENDER_SCALE, RENDER_WIDTH / CANVAS_WIDTH);
});

test("every rendered element stays inside the model canvas or bleeds by design", () => {
  for (const { slide } of renderAllPreviews(DESIGN)) {
    for (const element of slide.elements) {
      if (element.type === "shape" || element.type === "image") continue;
      assert.ok(element.x + element.width <= RENDER_WIDTH + 1, `${element.type} overflows horizontally`);
      assert.ok(element.y + element.height <= RENDER_HEIGHT + 1, `${element.type} overflows vertically`);
    }
  }
});

test("rotation survives compilation and rendering unchanged", () => {
  const slide = renderArchetype(DESIGN, archetypeBy("cover_01"), fullSlide("cover"));
  const rotated = slide.elements.filter((element) => element.rotation !== 0);
  assert.ok(rotated.length >= 2, "the sample rotates its title and its hero image");
  assert.ok(rotated.some((element) => element.rotation === -4));
  assert.ok(rotated.some((element) => element.rotation === 5));
});

test("elements come back ordered by z-index", () => {
  const slide = renderArchetype(DESIGN, archetypeBy("cover_01"), fullSlide("cover"));
  const order = slide.elements.map((element) => element.z_index);
  assert.deepEqual(order, [...order].sort((first, second) => first - second));
});

/* --------------------------------------------------------------- gradients */

test("a three-stop gradient renders in full and keeps a two-stop fallback", () => {
  const slide = renderArchetype(DESIGN, archetypeBy("cover_01"), fullSlide("cover"));
  const halo = slide.elements.find((element) => Array.isArray(element.style.gradientStops));
  assert.ok(halo, "the sample's halo carries a three-stop gradient");
  assert.equal(halo.style.gradientStops.length, 3);
  assert.deepEqual(halo.style.gradientStops.map((stop) => stop.offset), [0, 50, 100]);
  // Renderers that only know two stops still draw something correct.
  assert.equal(halo.style.fill, "#FF7100");
  assert.equal(halo.style.gradientTo, "#FFE86A");
  assert.equal(halo.style.gradientAngle, 135);
});

/* ------------------------------------------------------------------ fonts */

test("a font with an uploaded asset renders under its namespaced family", () => {
  const archetype = DESIGN_WITH_FACE.archetypes.find((entry) => entry.id === "cover_01");
  const slide = renderArchetype(DESIGN_WITH_FACE, archetype, fullSlide("cover"));
  const title = slide.elements.find((element) => element.content.text?.startsWith("G'oyangizni"));
  assert.equal(title.style.fontFamily, "jslayd_apelsen_futuristik_font_1");
  // The design's own declared fallback rides along for PPTX and for the moment
  // before the face has loaded.
  assert.equal(title.style.fontFallback, "LeagueSpartan_800ExtraBold");
});

test("the bundled fallback is the nearest weight the apps actually ship", () => {
  assert.equal(bundledFace("Manrope", 400), "Manrope_400Regular");
  assert.equal(bundledFace("Manrope", 650), "Manrope_600SemiBold");
  assert.equal(bundledFace("League Spartan", 800), "LeagueSpartan_800ExtraBold");
  assert.equal(bundledFace("Inter", 900), "Inter_900Black");
  // An unknown family never emits an unbundled name.
  assert.equal(bundledFace("Comic Sans", 400), "Manrope_400Regular");
});

/* ------------------------------------------------------------------- text */

test("copy that fits the drawn composition stays above the declared floor", () => {
  const slide = renderArchetype(DESIGN, archetypeBy("cover_01"), fullSlide("cover"));
  const title = slide.elements.find((element) => element.content.text?.startsWith("G'oyangizni"));
  // Authored at 148 canvas units with a 72-unit floor; sample copy is short
  // enough that the first pass never has to reach it.
  assert.ok(title.style.fontSize <= 148 * RENDER_SCALE);
  assert.ok(title.style.fontSize >= 72 * RENDER_SCALE, "ordinary copy must never reach the floor");
});

test("copy longer than the slot was drawn for keeps every word", () => {
  const long = "Alisher Navoiy hayoti, ijodiy merosi va uning jahon adabiyotidagi o'rni haqida keng qamrovli tahlil".repeat(3);
  const slide = renderArchetype(DESIGN, archetypeBy("cover_01"), fullSlide("cover", { title: long }));
  const title = slide.elements.find((element) => element.content.text === long);
  // Text deleted here would be gone from the deck for good, so the second pass
  // trades the declared floor away rather than truncating — and still stops
  // well before the copy stops being readable.
  assert.ok(title, "the whole string must survive");
  assert.ok(title.style.fontSize <= 148 * RENDER_SCALE);
  assert.ok(title.style.fontSize >= 8 * RENDER_SCALE, "must never go below the absolute readability floor");
});

test("an element whose condition fails is dropped", () => {
  const withSubtitle = renderArchetype(DESIGN, archetypeBy("cover_01"), fullSlide("cover"));
  const without = renderArchetype(DESIGN, archetypeBy("cover_01"), fullSlide("cover", { subtitle: null }));
  assert.ok(withSubtitle.elements.length > without.elements.length);
});

/* ------------------------------------------------------------------ stats */

test("a stat renders as a value and a label with the affixes applied", () => {
  const slide = renderArchetype(DESIGN, archetypeBy("statistics_01"), fullSlide("statistics"));
  const texts = elementsOf(slide, "text").map((element) => element.content.text);
  assert.ok(texts.includes("68%+"), `expected the suffix to be applied, got ${JSON.stringify(texts)}`);
  assert.ok(texts.some((text) => text.includes("auditoriya")));
  const value = slide.elements.find((element) => element.content.statRole === "value");
  const label = slide.elements.find((element) => element.content.statRole === "label");
  assert.ok(value.y + value.height <= label.y, "the label must sit below the value");
});

test("a stat with no figure on the slide drops out rather than rendering empty", () => {
  const slide = renderArchetype(DESIGN, archetypeBy("statistics_01"), fullSlide("statistics", { statistic: null }));
  assert.equal(slide.elements.filter((element) => element.content.statRole).length, 0);
});

/* ----------------------------------------------------------------- charts */

test("a chart carries real data and a deterministic series palette", () => {
  const slide = renderArchetype(DESIGN, archetypeBy("statistics_01"), fullSlide("statistics"));
  const chart = elementsOf(slide, "chart")[0];
  assert.ok(chart);
  assert.deepEqual(chart.content.values, [48, 32, 20]);
  assert.deepEqual(chart.content.labels, ["Birinchi", "Ikkinchi", "Uchinchi"]);
  // `doughnut` is authored; `donut` is what today's renderers draw.
  assert.equal(chart.content.chartKind, "doughnut");
  assert.equal(chart.content.chartType, "donut");
  assert.ok(chart.style.series.length >= 3);
  assert.equal(new Set(chart.style.series).size, chart.style.series.length);
});

test("chart series extend deterministically past the palette length", () => {
  const many = { type: "bar", labels: Array.from({ length: 9 }, (_, i) => `L${i}`), values: Array.from({ length: 9 }, (_, i) => i + 1) };
  const first = renderArchetype(DESIGN, archetypeBy("statistics_01"), fullSlide("statistics", { chart: many }));
  const second = renderArchetype(DESIGN, archetypeBy("statistics_01"), fullSlide("statistics", { chart: many }));
  const seriesOf = (slide) => elementsOf(slide, "chart")[0].style.series;
  assert.deepEqual(seriesOf(first), seriesOf(second));
  assert.equal(seriesOf(first).length, 9);
  assert.equal(new Set(seriesOf(first)).size, 9);
});

/* ----------------------------------------------------------------- tables */

test("a table renders its real rows and columns", () => {
  const slide = renderArchetype(DESIGN, archetypeBy("table_01"), fullSlide("table"));
  const table = elementsOf(slide, "table")[0];
  assert.ok(table);
  assert.equal(table.content.header, true);
  assert.deepEqual(table.content.columns, ["Ko'rsatkich", "2023", "2024", "O'zgarish"]);
  assert.equal(table.content.rows.length, 4);
  assert.equal(table.content.truncated, false);
});

test("a table with more rows than fit shrinks its type before truncating", () => {
  const rows = Array.from({ length: 30 }, (_, index) => [`Qator ${index}`, "1", "2", "3"]);
  const slide = renderArchetype(DESIGN, archetypeBy("table_01"), fullSlide("table", {
    table: { columns: ["A", "B", "C", "D"], rows },
  }));
  const table = elementsOf(slide, "table")[0];
  assert.ok(table.style.cellSize < 28 * RENDER_SCALE, "type must step down first");
  assert.ok(table.content.rows.length > 4, "shrinking must buy back rows");
  assert.equal(table.content.truncated, true, "and what still does not fit is reported, not hidden");
});

test("a slide with no table data renders no table element", () => {
  const slide = renderArchetype(DESIGN, archetypeBy("table_01"), fullSlide("table", { table: null }));
  assert.equal(elementsOf(slide, "table").length, 0);
});

/* ------------------------------------------------------------------ image */

test("an image slot binds to the picture the generator resolved for it", () => {
  const slide = renderArchetype(DESIGN, archetypeBy("cover_01"), fullSlide("cover"));
  const image = elementsOf(slide, "image")[0];
  assert.equal(image.content.storageBucket, "images");
  assert.equal(image.content.storagePath, "a/b.png");
  assert.equal(image.content.slot, "hero_image");
  assert.equal(image.content.strategy, "internet_search");
});

test("an optional image slot with nothing resolved is dropped", () => {
  const slide = renderArchetype(DESIGN, archetypeBy("cover_01"), fullSlide("cover", { images: {} }));
  assert.equal(elementsOf(slide, "image").length, 0);
});

test("a resolved picture carries exactly the fields it always did", () => {
  const slide = renderArchetype(DESIGN, archetypeBy("cover_01"), fullSlide("cover"));
  const image = elementsOf(slide, "image")[0];
  // The hint is for the hole. A filled slot gaining fields would be a change to
  // every stored deck's rows for the benefit of nobody.
  assert.equal(image.content.empty, undefined);
  assert.equal(image.content.hint, undefined);
});

test("a required slot with no picture says what belongs in it", () => {
  const required = {
    ...DESIGN,
    archetypes: DESIGN.archetypes.map((archetype) => ({
      ...archetype,
      elements: archetype.elements.map((element) =>
        element.type === "image" ? { ...element, required: true } : element),
    })),
  };
  const slide = renderArchetype(required, required.archetypes.find((entry) => entry.id === "cover_01"),
    fullSlide("cover", { images: {} }));
  const image = elementsOf(slide, "image")[0];

  assert.ok(image, "a required slot must still draw its hole");
  assert.equal(image.content.empty, true);
  assert.equal(image.content.required, true);
  // Somebody looking at a grey rectangle should not have to guess its shape.
  assert.ok(image.content.orientation);
  assert.ok(image.content.hint.length > 0, image.content.hint);
});

/* --------------------------------------------------------------- previews */

test("the preview is the real engine on deterministic sample content", () => {
  const first = renderPreview(DESIGN);
  const second = renderPreview(DESIGN);
  assert.deepEqual(first, second);
  assert.ok(first.elements.length > 0);
  assert.equal(typeof first.background.color, "string");
});

test("every archetype previews without throwing", () => {
  const previews = renderAllPreviews(DESIGN);
  assert.equal(previews.length, DESIGN.archetypes.length);
  for (const preview of previews) assert.ok(preview.slide.elements.length > 0, `${preview.id} rendered empty`);
});

/* -------------------------------------------------------------- selection */

/** Three `text_image` variants of one purpose — what §41 asks a design to offer. */
const VARIANTS = `JSLAYD-DESIGN 1.0

[DESIGN]
name: Variantlar
slug: variantlar
tier: good

[COLOR_FAMILY]
background: #FFFFFF
surface: #F4F4F4
primary: #111111
secondary: #DDDDDD
accent: #FF6A00
text: #111111
muted: #666666

[FONTS]
font_1:
role: display, heading, body
asset: variantlar.ttf

[SLIDE text_image_01]
purpose: text_image
supportsStats: true
supportsChart: true
supportsTable: true
supportsQuote: true

[ELEMENT title]
type: text
bind: {{title}}
x: 120
y: 200
width: 900
height: 300
fontSize: 90
color: text

[SLIDE text_image_02]
purpose: text_image
supportsStats: true
supportsChart: true
supportsTable: true
supportsQuote: true

[ELEMENT title]
type: text
bind: {{title}}
x: 900
y: 200
width: 900
height: 300
fontSize: 90
color: text

[SLIDE text_image_03]
purpose: text_image
supportsStats: true
supportsChart: true
supportsTable: true
supportsQuote: true

[ELEMENT title]
type: text
bind: {{title}}
x: 120
y: 600
width: 900
height: 300
fontSize: 90
color: text
`;

test("selection rotates variants instead of repeating one composition", () => {
  const { document, diagnostics } = compile(VARIANTS);
  assert.deepEqual(diagnostics.errors, [], diagnostics.errors.map((item) => item.message).join(" | "));
  const slides = Array.from({ length: 6 }, (_, index) => previewSlide("text_image", index, 6));
  const chosen = selectArchetypes(document, slides).map((entry) => entry.archetype.id);
  assert.equal(new Set(chosen).size, 3, `expected all three variants, got ${chosen.join(", ")}`);
  // Six slides across three variants is two each, not four of one.
  for (const id of new Set(chosen)) {
    assert.equal(chosen.filter((entry) => entry === id).length, 2);
  }
  assert.notEqual(chosen[0], chosen[1], "consecutive slides must not repeat a composition");
});

test("selection is deterministic", () => {
  const slides = Array.from({ length: 6 }, (_, index) => previewSlide(index === 0 ? "cover" : "statistics", index, 6));
  const first = selectArchetypes(DESIGN, slides).map((entry) => entry.archetype.id);
  const second = selectArchetypes(DESIGN, slides).map((entry) => entry.archetype.id);
  assert.deepEqual(first, second);
});

test("a purpose the design does not draw falls back to a relative, and says so", () => {
  const slides = [{ ...previewSlide("timeline"), chart: null, table: null, statistic: null, quote: null }];
  const [choice] = selectArchetypes(DESIGN, slides);
  assert.ok(choice.substituted, "a substitution must be reported, not hidden");
  assert.ok(DESIGN.archetypes.some((archetype) => archetype.id === choice.archetype.id));
});

test("content a slide merely carries does not disqualify an archetype", () => {
  const { document } = compile(VARIANTS);
  // The writer fills a quote and a figure into most slides; that must not stop
  // a `text_image` slide from getting a `text_image` composition.
  const slides = [{ ...previewSlide("text_image"), chart: null, table: null }];
  const [choice] = selectArchetypes(document, slides);
  assert.equal(choice.substituted, false, "a purpose the design draws must never be substituted");
  assert.ok(choice.archetype.id.startsWith("text_image"));
});

test("legacy layout names map onto archetype purposes", () => {
  assert.equal(purposeForLayout("title_body"), "title_content");
  assert.equal(purposeForLayout("two_columns"), "two_column");
  assert.equal(purposeForLayout("thanks"), "thank_you");
  assert.equal(purposeForLayout("something_new"), "title_content");
});

/* ------------------------------------------------- text you can actually read */

/**
 * A design states a colour for its type and a colour for the panel under it,
 * and both resolve against a palette. When those land on the same value the
 * words are drawn, correctly, and nobody can read them — every deck made from
 * that design has the fault and no single slide looks broken enough to report.
 */

/** The sample design with one palette role collided into another. */
function collided(role, onto) {
  const copy = JSON.parse(JSON.stringify(DESIGN));
  for (const family of copy.colorFamilies) family.colors[role] = family.colors[onto];
  copy.colors[role] = copy.colors[onto];
  return copy;
}

const titleOf = (slide) => slide.elements.find((element) => element.type === "text");

test("type that cannot be seen against its ground is made visible", () => {
  // Text set to exactly the background: a contrast ratio of one.
  const design = collided("text", "background");
  for (const { slide } of renderAllPreviews(design)) {
    for (const element of elementsOf(slide, "text")) {
      const ground = typeof slide.background.color === "string" ? slide.background.color : null;
      if (!ground || !/^#[0-9a-f]{6}$/i.test(element.style.color)) continue;
      // Only the ones actually sitting on the slide's own ground are checked;
      // a panel underneath is its own case, below.
      assert.notEqual(element.style.color.toLowerCase(), ground.toLowerCase());
    }
  }
});

test("a colour the designer chose that reads perfectly well is left alone", () => {
  /**
   * The sample design is legible by construction, so the floor must not touch
   * any of it. This is the guard against a rule that quietly repaints every
   * deck in black and white.
   */
  const before = renderAllPreviews(DESIGN)
    .flatMap(({ slide }) => elementsOf(slide, "text").map((element) => element.style.color));
  assert.ok(before.length > 0);
  const flattened = before.filter((color) => ["#ffffff", "#000000"].includes(String(color).toLowerCase()));
  // Some of the sample legitimately is black or white; most of it is not, and a
  // rule that had repainted everything would show up here.
  assert.ok(flattened.length < before.length, "matnlarning hammasi qora/oqqa aylandi");
});

test("the floor fires when the palette collides, and lands on black or white", () => {
  const design = collided("text", "background");
  const rescued = renderAllPreviews(design)
    .flatMap(({ slide }) => elementsOf(slide, "text"))
    .map((element) => String(element.style.color).toLowerCase())
    .filter((color) => color === "#ffffff" || color === "#000000");

  // At least one piece of type was unreadable and was made readable. The exact
  // count depends on the sample and is not the property worth pinning.
  assert.ok(rescued.length > 0, "kontrast qoidasi umuman ishlamadi");
});
