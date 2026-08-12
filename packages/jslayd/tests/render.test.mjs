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

const { document: DESIGN, diagnostics } = compile(SAMPLE_PROMPT);
assert.deepEqual(diagnostics.errors, [], "the sample must compile before rendering can be tested");

const archetypeBy = (id) => DESIGN.archetypes.find((entry) => entry.id === id);
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
  const slide = renderArchetype(DESIGN, archetypeBy("cover_01"), fullSlide("cover"));
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
