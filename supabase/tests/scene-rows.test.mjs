import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { readScene } = await import(`${edge}/scene-spec.js`);
const { buildDNA } = await import(`${edge}/scene-dna.js`);
const { renderScene } = await import(`${edge}/scene-render.js`);
const { deckToRows, deckPagesFrom } = await import(`${edge}/scene-rows.js`);

const dna = buildDNA(
  { mood: "editorial", ground: "near_black", brand: "#5A78F0", cornerLanguage: "soft", gradients: true },
  [{ name: "Playfair Display", category: "serif" }, { name: "Inter", category: "sans-serif" }],
);

const cover = readScene({
  purpose: "cover",
  background: { kind: "solid", color: "background" },
  elements: [
    { type: "image", place: { column: 0, span: 12, row: 0, rows: 8, bleed: true }, treatment: "full_bleed", intent: { query: "Registon", orientation: "landscape" }, overlay: "scrim_bottom" },
    { type: "text", role: "title", place: { column: 0, span: 9, row: 5, rows: 2 }, typography: { font: "display", step: "display", color: "onImage" }, text: "Registon" },
  ],
}).scene;

const body = readScene({
  purpose: "body",
  background: { kind: "solid", color: "background" },
  elements: [
    { type: "text", role: "title", place: { column: 0, span: 7, row: 1, rows: 2 }, typography: { font: "display", step: "title", color: "ink" }, text: "Sarlavha" },
    { type: "text", role: "body", place: { column: 0, span: 6, row: 3, rows: 4 }, typography: { font: "body", step: "body", color: "ink" }, text: "Matn." },
  ],
}).scene;

let counter = 0;
const deck = (scenes) => ({
  engine: "generative_v1",
  dna,
  slides: scenes.map((scene, index) => ({
    index, title: `Slayd ${index}`, brief: null, scene,
    rendered: renderScene(scene, dna),
    score: 100, accepted: true, attempts: 1, faults: [], synthesised: false, mirrored: false,
  })),
  observability: {},
});
const convert = (scenes) => {
  counter = 0;
  return deckToRows(deck(scenes), { ownerId: "u", presentationId: "p", newId: () => `id-${counter++}` });
};

test("one row per slide, carrying the score and how it was made", () => {
  const { slideRows } = convert([cover, body]);
  assert.equal(slideRows.length, 2);
  assert.equal(slideRows[0].position, 0);
  assert.equal(slideRows[0].quality_score, 100);
  assert.equal(slideRows[0].quality_report.engine, "generative_v1");
  assert.equal(slideRows[0].quality_report.synthesised, false);
});

test("layers become ranks the column can hold, per slide", () => {
  const { elementRows } = convert([cover, body]);
  for (const row of elementRows) assert.ok(Number.isInteger(row.z_index), `${row.z_index}`);

  const first = elementRows.filter((row) => row.slide_id === elementRows[0].slide_id);
  // Each page's order is its own: the second slide starts at zero again rather
  // than continuing the first slide's count.
  const second = elementRows.filter((row) => row.slide_id !== elementRows[0].slide_id);
  assert.equal(Math.min(...first.map((row) => row.z_index)), 0);
  assert.equal(Math.min(...second.map((row) => row.z_index)), 0);
});

test("the scrim keeps its place between the photograph and the words", () => {
  const { elementRows } = convert([cover]);
  const image = elementRows.find((row) => row.type === "image");
  const scrim = elementRows.find((row) => row.content.kind === "scrim");
  const title = elementRows.find((row) => row.content.role === "title");
  assert.ok(image.z_index < scrim.z_index, "the scrim is over the photograph");
  assert.ok(scrim.z_index < title.z_index, "and under the words");
});

test("every row is inside the canvas the apps draw", () => {
  const { elementRows } = convert([cover, body]);
  for (const row of elementRows) {
    assert.ok(row.x >= -1 && row.y >= -1, `${row.x},${row.y}`);
    assert.ok(row.x + row.width <= 1001, `${row.x + row.width}`);
    assert.ok(row.y + row.height <= 564, `${row.y + row.height}`);
  }
});

test("a slide the engine could not render is skipped rather than stored empty", () => {
  const broken = deck([body]);
  broken.slides[0].rendered = null;
  const { slideRows, elementRows } = deckToRows(broken, { ownerId: "u", presentationId: "p", newId: () => "id" });
  assert.deepEqual(slideRows, []);
  assert.deepEqual(elementRows, []);
});

test("a deck is its outline plus its own furniture", () => {
  const pages = deckPagesFrom({
    topic: "Suv resurslari",
    outlineTitles: ["Kirish", "Holat", "Yechim"],
    research: "manba matni",
    agendaTitle: "Mavzular rejasi",
    referencesTitle: "Foydalanilgan adabiyotlar",
    thanksTitle: "Rahmat",
  });
  assert.equal(pages.length, 6, "cover, agenda, three body pages, references, closing");
  assert.deepEqual(pages.map((page) => page.kind), ["cover", "content", "content", "content", "content", "closing"]);
  assert.equal(pages[0].title, "Suv resurslari");
  assert.equal(pages[0].kind, "cover");
  assert.equal(pages.at(-1).kind, "closing");
});

test("the agenda is told what the deck contains", () => {
  const pages = deckPagesFrom({
    topic: "T", outlineTitles: ["Bir", "Ikki"], research: null,
    agendaTitle: "Reja", referencesTitle: "Manbalar", thanksTitle: "Rahmat",
  });
  assert.match(pages[1].research, /Bir; Ikki/);
});

test("body pages carry the research and the cover does not", () => {
  const pages = deckPagesFrom({
    topic: "T", outlineTitles: ["Bir"], research: "manba",
    agendaTitle: "Reja", referencesTitle: "Manbalar", thanksTitle: "Rahmat",
  });
  assert.equal(pages[0].research, null, "a cover is about the whole deck, not a source");
  assert.equal(pages[2].research, "manba");
});
