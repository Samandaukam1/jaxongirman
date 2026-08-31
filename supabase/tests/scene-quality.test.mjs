import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { readScene } = await import(`${edge}/scene-spec.js`);
const { placeScene, findCollisions, findOutOfBounds, measureText } = await import(`${edge}/scene-geometry.js`);
const { scoreScene, compositionSignature, similarity, findRepetition, speaks, freeBand, withRescuedContent, withCoverCredit } = await import(`${edge}/scene-quality.js`);

const judge = (raw) => {
  const { scene, problems } = readScene(raw);
  assert.deepEqual(problems, [], JSON.stringify(problems));
  const placed = placeScene(scene);
  return scoreScene({
    scene,
    placed,
    fits: measureText(placed),
    collisions: findCollisions(placed),
    outOfBounds: findOutOfBounds(placed),
  });
};

const healthy = {
  purpose: "explain",
  background: { kind: "solid", color: "background" },
  elements: [
    { type: "text", role: "eyebrow", place: { column: 0, span: 4, row: 0, rows: 1 }, typography: { font: "body", step: "micro", color: "inkMuted" }, text: "KIRISH" },
    { type: "text", role: "title", place: { column: 0, span: 7, row: 1, rows: 2 }, typography: { font: "display", step: "title", color: "ink" }, text: "Suv resurslari" },
    { type: "text", role: "body", place: { column: 0, span: 6, row: 3, rows: 4 }, typography: { font: "body", step: "body", color: "ink" }, text: "Suv taqchilligi mintaqadagi eng jiddiy masalalardan biri. ".repeat(6) },
    { type: "image", place: { column: 7, span: 5, row: 1, rows: 6 }, treatment: "rounded", intent: { query: "Amudaryo", orientation: "portrait" } },
  ],
};

test("a sound composition scores at the top of the range", () => {
  const report = judge(healthy);
  assert.equal(report.faults.length, 0, JSON.stringify(report.faults));
  assert.equal(report.score, 100);
});

test("a collision alone puts a slide below any usable threshold", () => {
  const report = judge({
    ...healthy,
    elements: [
      healthy.elements[1],
      { ...healthy.elements[1], text: "Ikkinchi sarlavha" },
    ],
  });
  assert.ok(report.faults.some((fault) => fault.code === "collision"));
  assert.ok(report.score < 90, `scored ${report.score}`);
});

test("copy that does not fit its box is a fault with the numbers in it", () => {
  const report = judge({
    ...healthy,
    elements: [
      healthy.elements[1],
      { type: "text", role: "body", place: { column: 0, span: 4, row: 4, rows: 1 }, typography: { font: "body", step: "body", color: "ink" }, text: "so'z ".repeat(300) },
    ],
  });
  const overflow = report.faults.find((fault) => fault.code === "overflow");
  assert.ok(overflow, JSON.stringify(report.faults));
  assert.match(overflow.detail, /lines in room for/);
});

test("a nearly empty page is a fault, not a minimal composition", () => {
  const report = judge({
    ...healthy,
    elements: [
      { type: "text", role: "title", place: { column: 0, span: 3, row: 0, rows: 1 }, typography: { font: "display", step: "heading", color: "ink" }, text: "Qisqa" },
      { type: "text", role: "body", place: { column: 0, span: 3, row: 1, rows: 1 }, typography: { font: "body", step: "body", color: "ink" }, text: "Bir jumla." },
    ],
  });
  assert.ok(report.faults.some((fault) => fault.code === "sparse"), JSON.stringify(report.faults));
});

test("two elements at the largest size leave the eye nowhere to land", () => {
  const report = judge({
    ...healthy,
    elements: [
      healthy.elements[1],
      { ...healthy.elements[1], place: { column: 0, span: 7, row: 4, rows: 2 }, text: "Yana bir sarlavha" },
      healthy.elements[3],
    ],
  });
  assert.ok(report.faults.some((fault) => fault.code === "no_hierarchy"));
});

test("a page with only a heading carries no message", () => {
  const report = judge({
    ...healthy,
    elements: [
      { type: "text", role: "title", place: { column: 1, span: 10, row: 3, rows: 3 }, typography: { font: "display", step: "display", color: "ink" }, text: "Xulosa" },
    ],
  });
  assert.ok(report.faults.some((fault) => fault.code === "no_content"));
});

test("the signature describes the arrangement, not the words", () => {
  const { scene: first } = readScene(healthy);
  const { scene: second } = readScene({
    ...healthy,
    elements: healthy.elements.map((element) => element.type === "text" ? { ...element, text: "Butunlay boshqa matn" } : element),
  });
  assert.equal(compositionSignature(first), compositionSignature(second));
  assert.equal(similarity(compositionSignature(first), compositionSignature(second)), 1);
});

test("moving the image to the other side changes the composition", () => {
  const { scene: first } = readScene(healthy);
  const { scene: mirrored } = readScene({
    ...healthy,
    elements: healthy.elements.map((element) =>
      element.type === "image" ? { ...element, place: { column: 0, span: 5, row: 1, rows: 6 } } : element),
  });
  assert.ok(similarity(compositionSignature(first), compositionSignature(mirrored)) < 1);
});

test("a deck that repeats one composition is caught by slide index", () => {
  const one = "solid|title@0,1,7x2|body@0,3,6x4";
  const other = "solid|title@0,0,12x1|chart@0,2,12x5";
  assert.deepEqual(findRepetition([one, one, other, other, one]), [1, 3]);
  assert.deepEqual(findRepetition([one, other, one, other]), []);
});

test("a page with a heading and a photograph and nothing else is silent", () => {
  const { scene } = readScene({
    purpose: "p",
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "text", role: "title", place: { column: 0, span: 7, row: 0, rows: 2 }, typography: { font: "display", step: "title", color: "ink" }, text: "Sarlavha" },
      { type: "image", place: { column: 7, span: 5, row: 0, rows: 4 }, treatment: "rounded", intent: { query: "x", orientation: "portrait" } },
    ],
  });
  assert.equal(speaks(scene), false);
  const rescued = withRescuedContent(scene, "Bu sahifaning asosiy fikri.");
  assert.equal(speaks(rescued), true);
  const added = rescued.elements.at(-1);
  assert.equal(added.role, "body");
  assert.equal(added.text, "Bu sahifaning asosiy fikri.");
});

test("the rescued paragraph lands where nothing else is", () => {
  const { scene } = readScene({
    purpose: "p",
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "text", role: "title", place: { column: 0, span: 12, row: 0, rows: 2 }, typography: { font: "display", step: "title", color: "ink" }, text: "Sarlavha" },
    ],
  });
  const rescued = withRescuedContent(scene, "Fikr.");
  const placed = placeScene(rescued);
  assert.deepEqual(findCollisions(placed), [], "the rescue does not land on the title");
  assert.ok(rescued.elements.at(-1).place.row >= 2);
});

test("a page that already speaks is left alone", () => {
  const { scene } = readScene(healthy);
  const rescued = withRescuedContent(scene, "Qo'shimcha");
  assert.equal(rescued.elements.length, scene.elements.length);
});

test("a full page cannot be rescued and is not damaged trying", () => {
  const { scene } = readScene({
    purpose: "p",
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "text", role: "title", place: { column: 0, span: 12, row: 0, rows: 4 }, typography: { font: "display", step: "title", color: "ink" }, text: "Sarlavha" },
      { type: "image", place: { column: 0, span: 12, row: 4, rows: 4 }, treatment: "rounded", intent: { query: "x", orientation: "landscape" } },
    ],
  });
  assert.equal(freeBand(scene), null);
  assert.equal(withRescuedContent(scene, "Fikr.").elements.length, 2);
});

test("a page of one paragraph and no heading is not a finished page", () => {
  const report = judge({
    ...healthy,
    elements: [
      { type: "text", role: "body", place: { column: 0, span: 8, row: 1, rows: 5 }, typography: { font: "body", step: "body", color: "ink" }, text: "Uzun matn. ".repeat(20) },
    ],
  });
  assert.ok(report.faults.some((fault) => fault.code === "no_heading"), JSON.stringify(report.faults));
});

test("an eyebrow is heading enough for an editorial page", () => {
  const report = judge({
    ...healthy,
    elements: [
      { type: "text", role: "eyebrow", place: { column: 0, span: 4, row: 0, rows: 1 }, typography: { font: "body", step: "micro", color: "inkMuted" }, text: "01 — KIRISH" },
      { type: "text", role: "body", place: { column: 0, span: 8, row: 1, rows: 5 }, typography: { font: "body", step: "body", color: "ink" }, text: "Uzun matn. ".repeat(20) },
    ],
  });
  assert.ok(!report.faults.some((fault) => fault.code === "no_heading"), JSON.stringify(report.faults));
});

test("a cover with no credit line gets one", () => {
  const { scene } = readScene({
    purpose: "cover",
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "image", place: { column: 0, span: 12, row: 0, rows: 8, bleed: true }, treatment: "full_bleed", intent: { query: "x", orientation: "landscape" }, overlay: "scrim_bottom" },
      { type: "text", role: "title", place: { column: 0, span: 9, row: 4, rows: 2 }, typography: { font: "display", step: "display", color: "onImage" }, text: "Mavzu" },
    ],
  });
  const credited = withCoverCredit(scene, "Tayyorladi: Ali · O'qituvchi: Dilnoza");
  const line = credited.elements.at(-1);
  assert.equal(line.role, "caption");
  assert.match(line.text, /Ali/);
  assert.equal(line.typography.color, "onImage", "readable over a photograph nobody has seen");
  assert.deepEqual(findCollisions(placeScene(credited)), [], "and it lands where nothing else is");
});

test("a cover that already names its author is left alone", () => {
  const { scene } = readScene({
    purpose: "cover",
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "text", role: "title", place: { column: 0, span: 9, row: 4, rows: 2 }, typography: { font: "display", step: "display", color: "ink" }, text: "Mavzu" },
      { type: "text", role: "caption", place: { column: 0, span: 6, row: 7, rows: 1 }, typography: { font: "body", step: "caption", color: "ink" }, text: "Tayyorladi: Ali" },
    ],
  });
  assert.equal(withCoverCredit(scene, "Tayyorladi: Ali · O'qituvchi: Dilnoza").elements.length, 2);
});

test("a deck with no names on it gets no empty label", () => {
  const { scene } = readScene({
    purpose: "cover",
    background: { kind: "solid", color: "background" },
    elements: [{ type: "text", role: "title", place: { column: 0, span: 9, row: 4, rows: 2 }, typography: { font: "display", step: "display", color: "ink" }, text: "Mavzu" }],
  });
  assert.equal(withCoverCredit(scene, "").elements.length, 1);
});
