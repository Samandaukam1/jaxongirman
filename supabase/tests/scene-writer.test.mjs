import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const spec = await import(`${edge}/scene-spec.js`);
const { readScene } = spec;
const { placeScene, findCollisions, findOutOfBounds, measureText } = await import(`${edge}/scene-geometry.js`);
const { scoreScene } = await import(`${edge}/scene-quality.js`);
const { MOODS, GROUNDS } = await import(`${edge}/scene-dna.js`);
const { sceneSchema, directionSchema, briefSchema, scenePrompt, repairPrompt, directionPrompt, briefPrompt } =
  await import(`${edge}/scene-writer.js`);

const schema = sceneSchema();
const item = schema.properties.elements.items;

/**
 * The schema and the reader have to agree.
 *
 * A schema admitting a role the reader rejects produces slides that pass the
 * model and vanish at validation, which is worse than either failing alone.
 */
test("every vocabulary the schema offers is one the reader accepts", () => {
  assert.deepEqual(item.properties.role.enum, [...spec.TEXT_ROLES]);
  assert.deepEqual(item.properties.color.enum, [...spec.COLOR_ROLES]);
  assert.deepEqual(item.properties.typography.properties.font.enum, [...spec.FONT_ROLES]);
  assert.deepEqual(item.properties.typography.properties.step.enum, Object.keys(spec.TYPE_SCALE));
  assert.deepEqual(item.properties.chart.properties.kind.enum, [...spec.CHART_TYPES]);
  for (const treatment of [...spec.IMAGE_TREATMENTS, ...spec.CARD_TREATMENTS]) {
    assert.ok(item.properties.treatment.enum.includes(treatment), treatment);
  }
  for (const kind of spec.SHAPE_KINDS) {
    assert.ok(item.properties.kind.enum.includes(kind), kind);
  }
});

test("the direction schema offers exactly the moods and grounds the palette knows", () => {
  const direction = directionSchema();
  assert.deepEqual(direction.properties.mood.enum, [...MOODS]);
  assert.deepEqual(direction.properties.ground.enum, [...GROUNDS]);
  // One colour, not a palette: six chances to fail contrast is six too many.
  assert.equal(direction.properties.brand.type, "string");
  assert.ok(!("palette" in direction.properties));
});

test("the schema cannot express a hex, a font name or a pixel size", () => {
  const text = JSON.stringify(schema);
  assert.ok(!/fontFamily|fontSize|"#/.test(text), "the model can name a value it should not");
  assert.equal(item.properties.typography.properties.step.type, "string");
});

test("cards hold type and never another card", () => {
  const children = item.properties.children.items;
  assert.deepEqual(children.properties.type.enum, ["text"]);
});

test("a scene written to the schema shape reads and scores", () => {
  const written = {
    purpose: "Muammoni tushuntirish",
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "text", role: "eyebrow", place: { column: 0, span: 3, row: 0, rows: 1 }, typography: { font: "body", step: "micro", color: "inkMuted" }, text: "01 — KIRISH" },
      { type: "text", role: "title", place: { column: 0, span: 7, row: 1, rows: 2 }, typography: { font: "display", step: "title", color: "ink" }, text: "Suv taqchilligi" },
      { type: "text", role: "body", place: { column: 0, span: 6, row: 3, rows: 4 }, typography: { font: "body", step: "body", color: "ink" }, text: "Mintaqada suv zaxiralari kamaymoqda. ".repeat(8) },
      { type: "image", place: { column: 7, span: 5, row: 1, rows: 6 }, treatment: "rounded", intent: { query: "Orol dengizi", orientation: "portrait" } },
    ],
  };
  const { scene, problems } = readScene(written);
  assert.deepEqual(problems, [], JSON.stringify(problems));
  const placed = placeScene(scene);
  const report = scoreScene({
    scene, placed,
    fits: measureText(placed),
    collisions: findCollisions(placed),
    outOfBounds: findOutOfBounds(placed),
  });
  assert.equal(report.score, 100, JSON.stringify(report.faults));
});

test("the slide prompt names the grid, the fonts and the ban on inventing values", () => {
  const prompt = scenePrompt({
    brief: { slideGoal: "g", mainMessage: "m", supportingMessage: null, informationDensity: 0.6, visualPriority: 0.4, needs: { image: true, chart: false, statistic: false, quote: false, comparison: false, timeline: false, example: true } },
    topic: "Suv resurslari",
    fonts: { display: "Playfair Display", body: "Inter" },
    mood: "editorial",
    used: [],
  });
  assert.match(prompt, /12 ustun/);
  assert.match(prompt, /Playfair Display/);
  assert.match(prompt, /HEX YOZMA/);
  assert.match(prompt, /O'YLAB TOPMANG/);
});

test("the prompt shows the deck's recent compositions so the next one differs", () => {
  const base = { brief: { slideGoal: "g", mainMessage: "m", supportingMessage: null, informationDensity: 0.5, visualPriority: 0.5, needs: { image: false, chart: false, statistic: false, quote: false, comparison: false, timeline: false, example: false } }, topic: "T", fonts: {}, mood: "civic" };
  assert.doesNotMatch(scenePrompt({ ...base, used: [] }), /oldingi kompozitsiyalari/);
  const withHistory = scenePrompt({ ...base, used: ["sig-one", "sig-two", "sig-three", "sig-four"] });
  assert.match(withHistory, /oldingi kompozitsiyalari/);
  assert.match(withHistory, /sig-four/);
  // Only the last few: the whole deck would be a prompt of its own.
  assert.ok(!withHistory.includes("sig-one"), "older compositions are dropped");
});

test("a repair instruction carries the measurement, not an opinion", () => {
  const { scene } = readScene({
    purpose: "p",
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "text", role: "title", place: { column: 0, span: 6, row: 1, rows: 2 }, typography: { font: "display", step: "title", color: "ink" }, text: "Bir" },
      { type: "text", role: "title", place: { column: 0, span: 6, row: 1, rows: 2 }, typography: { font: "display", step: "title", color: "ink" }, text: "Ikki" },
    ],
  });
  const placed = placeScene(scene);
  const report = scoreScene({ scene, placed, fits: measureText(placed), collisions: findCollisions(placed), outOfBounds: findOutOfBounds(placed) });
  const prompt = repairPrompt(scene, report);
  assert.match(prompt, /collision/);
  assert.match(prompt, /elements\[0\]/);
  assert.match(prompt, /ustma-ust/);
  // Only the faults that were actually found: an instruction listing advice
  // for problems the slide does not have is noise the model has to ignore.
  assert.doesNotMatch(prompt, /shrift o'lchamini kichraytirmang/);
});

test("copy that does not fit is repaired by shortening, never by shrinking", () => {
  const { scene } = readScene({
    purpose: "p",
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "text", role: "title", place: { column: 0, span: 6, row: 0, rows: 1 }, typography: { font: "display", step: "heading", color: "ink" }, text: "Sarlavha" },
      { type: "text", role: "body", place: { column: 0, span: 4, row: 2, rows: 1 }, typography: { font: "body", step: "body", color: "ink" }, text: "so'z ".repeat(300) },
    ],
  });
  const placed = placeScene(scene);
  const report = scoreScene({ scene, placed, fits: measureText(placed), collisions: findCollisions(placed), outOfBounds: findOutOfBounds(placed) });
  const prompt = repairPrompt(scene, report);
  assert.match(prompt, /overflow/);
  assert.match(prompt, /shrift o'lchamini kichraytirmang/);
});

test("the brief asks for meaning and forbids inventing evidence", () => {
  const prompt = briefPrompt({ topic: "T", title: "S", position: 2, total: 10, research: null });
  assert.match(prompt, /MA'NOSINI/);
  assert.match(prompt, /O'YLAB TOPMANG/);
  assert.match(prompt, /Slayd 3\/10/);
  const required = briefSchema().required;
  for (const field of ["slideGoal", "mainMessage", "informationDensity", "visualPriority", "needs"]) {
    assert.ok(required.includes(field), field);
  }
});

test("the direction prompt asks for one colour and a reason, not a palette", () => {
  const prompt = directionPrompt("Sun'iy intellekt");
  assert.match(prompt, /bitta #RRGGBB/);
  assert.match(prompt, /palitra yozmang/);
});
