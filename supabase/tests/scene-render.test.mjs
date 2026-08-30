import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { readScene, CANVAS } = await import(`${edge}/scene-spec.js`);
const { buildDNA } = await import(`${edge}/scene-dna.js`);
const { renderScene, imageIntents, MODEL_SCALE } = await import(`${edge}/scene-render.js`);

const library = [
  { name: "Playfair Display", category: "serif" },
  { name: "Inter", category: "sans-serif" },
  { name: "JetBrains Mono", category: "monospace" },
];
const dna = buildDNA(
  { mood: "editorial", ground: "near_black", brand: "#5A78F0", cornerLanguage: "soft", gradients: true },
  library,
);

const read = (raw) => {
  const { scene, problems } = readScene(raw);
  assert.deepEqual(problems, [], JSON.stringify(problems));
  return scene;
};

const cover = read({
  purpose: "cover",
  background: { kind: "solid", color: "background" },
  elements: [
    { type: "image", place: { column: 0, span: 12, row: 0, rows: 8, bleed: true }, treatment: "full_bleed", intent: { query: "Registon maydoni", orientation: "landscape" }, overlay: "scrim_bottom" },
    { type: "text", role: "title", place: { column: 0, span: 9, row: 5, rows: 2 }, typography: { font: "display", step: "display", color: "onImage" }, text: "Registon" },
    { type: "text", role: "caption", place: { column: 0, span: 5, row: 7, rows: 1 }, typography: { font: "body", step: "caption", color: "onImage" }, text: "Tayyorladi: Ali" },
  ],
});

test("geometry drops to the model the apps store", () => {
  const drawn = renderScene(cover, dna);
  const bleed = drawn.elements.find((row) => row.type === "image");
  assert.equal(bleed.x, 0);
  assert.equal(bleed.width, Math.round(CANVAS.width * MODEL_SCALE * 100) / 100);
  assert.ok(bleed.width <= 1000);
});

test("roles become values, and nothing downstream is still a role", () => {
  const drawn = renderScene(cover, dna);
  const title = drawn.elements.find((row) => row.content.role === "title");
  assert.match(title.style.color, /^#[0-9a-f]{6}$/i, "colour is resolved");
  assert.equal(title.style.fontFamily, dna.fonts.display, "the face comes from the library pairing");
  assert.equal(typeof title.style.fontSize, "number");
  assert.equal(drawn.background.color, dna.colors.background);
});

test("type is never set with a line shorter than itself", () => {
  const drawn = renderScene(cover, dna);
  for (const row of drawn.elements.filter((one) => one.type === "text")) {
    assert.ok(row.style.lineHeight >= row.style.fontSize, `${row.content.text}: ${row.style.lineHeight} < ${row.style.fontSize}`);
  }
});

test("text over a photograph gets a scrim between them", () => {
  const drawn = renderScene(cover, dna);
  const scrim = drawn.elements.find((row) => row.content.kind === "scrim");
  assert.ok(scrim, "no scrim was drawn");
  const image = drawn.elements.find((row) => row.type === "image");
  const title = drawn.elements.find((row) => row.content.role === "title");
  assert.ok(scrim.z_index > image.z_index && scrim.z_index < title.z_index, "the scrim sits between them");
});

test("decoration is drawn under type, never over it", () => {
  const scene = read({
    purpose: "p",
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "shape", kind: "orb", place: { column: 6, span: 6, row: 0, rows: 4 }, color: "accent" },
      { type: "text", role: "title", place: { column: 0, span: 6, row: 1, rows: 2 }, typography: { font: "display", step: "title", color: "ink" }, text: "Sarlavha" },
    ],
  });
  const drawn = renderScene(scene, dna);
  const orb = drawn.elements.find((row) => row.content.kind === "orb");
  const title = drawn.elements.find((row) => row.content.role === "title");
  assert.ok(orb.z_index < title.z_index);
});

test("a chart carries the deck's palette and not PowerPoint's", () => {
  const scene = read({
    purpose: "p",
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "text", role: "title", place: { column: 0, span: 6, row: 0, rows: 1 }, typography: { font: "display", step: "heading", color: "ink" }, text: "O'sish" },
      { type: "chart", place: { column: 0, span: 7, row: 2, rows: 5 }, chart: { kind: "doughnut", labels: ["a", "b"], values: [3, 7] } },
    ],
  });
  const drawn = renderScene(scene, dna);
  const chart = drawn.elements.find((row) => row.type === "chart");
  // The stored type stays in the vocabulary every renderer already draws,
  // while the design's own choice travels beside it.
  assert.equal(chart.content.chartType, "donut");
  assert.equal(chart.content.chartKind, "doughnut");
  assert.deepEqual(chart.style.palette, [dna.colors.chart1, dna.colors.chart2, dna.colors.chart3, dna.colors.chart4]);
  assert.equal(chart.style.showGrid, false);
});

test("a card is a shape and its children sit above it", () => {
  const scene = read({
    purpose: "p",
    background: { kind: "solid", color: "background" },
    elements: [{
      type: "card", treatment: "glass", place: { column: 0, span: 5, row: 2, rows: 3 },
      children: [{ type: "text", role: "statistic", place: { column: 0, span: 1, row: 0, rows: 1 }, typography: { font: "data", step: "statistic", color: "ink" }, text: "73%" }],
    }],
  });
  const drawn = renderScene(scene, dna);
  const card = drawn.elements.find((row) => row.content.kind === "card");
  const stat = drawn.elements.find((row) => row.content.text === "73%");
  assert.equal(card.type, "shape");
  assert.ok(stat.z_index > card.z_index);
  assert.ok(stat.x > card.x, "the child is inset by the card's padding");
});

test("every picture the scene needs is asked for once", () => {
  const scene = read({
    purpose: "p",
    background: { kind: "image", intent: { query: "Samarqand", orientation: "landscape" }, overlay: "veil" },
    elements: [
      { type: "image", place: { column: 0, span: 4, row: 0, rows: 3 }, treatment: "rounded", intent: { query: "Samarqand", orientation: "landscape" } },
      { type: "image", place: { column: 4, span: 4, row: 0, rows: 3 }, treatment: "rounded", intent: { query: "Buxoro", orientation: "landscape" } },
      { type: "text", role: "body", place: { column: 0, span: 8, row: 4, rows: 2 }, typography: { font: "body", step: "body", color: "ink" }, text: "Matn." },
    ],
  });
  const intents = imageIntents(scene);
  assert.deepEqual(intents.map((one) => one.query), ["Samarqand", "Buxoro"]);
});

test("a found picture reaches the element that asked for it", () => {
  const drawn = renderScene(cover, dna, new Map([["Registon maydoni", { bucket: "stock-images", path: "a/b.jpg" }]]));
  const image = drawn.elements.find((row) => row.type === "image");
  assert.equal(image.content.storageBucket, "stock-images");
  assert.equal(image.content.storagePath, "a/b.jpg");
});

test("a picture that was never found leaves a placeholder rather than a broken slide", () => {
  const drawn = renderScene(cover, dna);
  const image = drawn.elements.find((row) => row.type === "image");
  assert.equal(image.content.kind, "image");
  assert.equal(image.content.url, undefined);
});
