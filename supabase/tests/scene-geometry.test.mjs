import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { readScene, CANVAS, GRID } = await import(`${edge}/scene-spec.js`);
const { compilePlacement, placeScene, findCollisions, findOutOfBounds, measureText } =
  await import(`${edge}/scene-geometry.js`);

const title = (over) => ({
  type: "text", role: "title", place: { column: 0, span: 6, row: 1, rows: 2 },
  typography: { font: "display", step: "title", color: "ink" },
  text: "Sarlavha", ...over,
});

test("a placement compiles to a rectangle inside the safe area", () => {
  const box = compilePlacement({ column: 0, span: 12, row: 0, rows: 8 });
  assert.equal(box.x, GRID.margin);
  assert.equal(box.y, GRID.margin);
  assert.equal(box.width, CANVAS.width - GRID.margin * 2);
  assert.equal(box.height, CANVAS.height - GRID.margin * 2);
});

test("half the grid is half the usable width, gutters accounted for", () => {
  const left = compilePlacement({ column: 0, span: 6, row: 0, rows: 4 });
  const right = compilePlacement({ column: 6, span: 6, row: 0, rows: 4 });
  assert.equal(left.width, right.width);
  assert.ok(right.x > left.x + left.width, "the two halves do not touch");
});

test("bleed is the whole page and nothing less", () => {
  const box = compilePlacement({ column: 0, span: 1, row: 0, rows: 1, bleed: true });
  assert.deepEqual(box, { x: 0, y: 0, width: CANVAS.width, height: CANVAS.height });
});

test("a placement running off the grid is refused by name", () => {
  const { problems } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [title({ place: { column: 9, span: 6, row: 0, rows: 2 } })],
  });
  assert.ok(problems.some((one) => one.path.endsWith(".span")), JSON.stringify(problems));
});

test("a role the model got wrong is inferred from the size it asked for", () => {
  // A model that says step: "title" and calls the role "headline" has said
  // what it meant. Losing the page over the word costs more than it saves.
  const { scene, problems } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [{ ...title(), role: "headline" }],
  });
  assert.deepEqual(problems, []);
  assert.equal(scene.elements[0].role, "title");
});

test("an element with words but no role at all is a paragraph", () => {
  // Most elements are, and losing the page over the omission is the trade the
  // first real run showed to be wrong.
  const { scene, problems } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [{ type: "text", place: { column: 0, span: 6, row: 0, rows: 2 }, text: "Bir jumla." }],
  });
  assert.deepEqual(problems, []);
  assert.equal(scene.elements[0].role, "body");
  assert.equal(scene.elements[0].typography.font, "body", "and it is set the way a paragraph is set");
});

test("an element with no words is dropped without taking the slide with it", () => {
  const { scene, problems } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "text", place: { column: 0, span: 6, row: 0, rows: 2 }, text: "   " },
      title(),
    ],
  });
  assert.deepEqual(problems, []);
  assert.equal(scene.elements.length, 1, "the empty box is gone and the page survives");
});

test("a card asked for an image treatment still draws as a card", () => {
  const { scene, problems } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [{
      type: "card", treatment: "rounded", place: { column: 0, span: 4, row: 0, rows: 2 },
      children: [{ role: "body", text: "Matn", font: "body", step: "body", color: "ink" }],
    }],
  });
  assert.deepEqual(problems, []);
  assert.equal(scene.elements[0].treatment, "solid");
});

test("two elements in the same cells collide", () => {
  const { scene } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [title(), title({ text: "Boshqa" })],
  });
  const collisions = findCollisions(placeScene(scene));
  assert.equal(collisions.length, 1);
  assert.ok(collisions[0].area > 0);
});

test("neighbouring cells do not collide", () => {
  const { scene } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [title(), title({ place: { column: 6, span: 6, row: 1, rows: 2 }, text: "Yonida" })],
  });
  assert.deepEqual(findCollisions(placeScene(scene)), []);
});

test("text over a full-bleed photograph is a cover, not a collision", () => {
  const { scene } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "image", place: { column: 0, span: 12, row: 0, rows: 8, bleed: true }, treatment: "full_bleed", intent: { query: "Samarqand", orientation: "landscape" }, overlay: "scrim_bottom" },
      title({ place: { column: 0, span: 9, row: 5, rows: 2 }, typography: { font: "display", step: "display", color: "onImage" } }),
    ],
  });
  assert.deepEqual(findCollisions(placeScene(scene)), []);
});

test("a decorative rule across a paragraph is a collision", () => {
  const { scene } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [
      title({ place: { column: 0, span: 8, row: 2, rows: 3 }, role: "body", typography: { font: "body", step: "body", color: "ink" } }),
      { type: "shape", kind: "rule", place: { column: 0, span: 8, row: 3, rows: 1 }, color: "accent" },
    ],
  });
  assert.equal(findCollisions(placeScene(scene)).length, 1);
});

test("a card holds its children rather than colliding with them", () => {
  const { scene } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [{
      type: "card", treatment: "glass", place: { column: 0, span: 5, row: 2, rows: 3 },
      children: [{ ...title(), place: { column: 0, span: 1, row: 0, rows: 1 } }],
    }],
  });
  const placed = placeScene(scene);
  assert.deepEqual(findCollisions(placed), []);
  const child = placed.find((entry) => entry.path.includes("children"));
  const card = placed.find((entry) => entry.element.type === "card");
  assert.ok(child.box.x >= card.box.x && child.box.y >= card.box.y, "the child sits inside its card");
  assert.ok(child.box.x + child.box.width <= card.box.x + card.box.width);
});

test("nothing legitimate leaves the page", () => {
  const { scene } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [title()],
  });
  assert.deepEqual(findOutOfBounds(placeScene(scene)), []);
});

test("copy is measured against the box it was placed in", () => {
  const { scene } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [
      title({ role: "body", place: { column: 0, span: 4, row: 0, rows: 1 }, typography: { font: "body", step: "body", color: "ink" }, text: "qisqa" }),
      title({ role: "body", place: { column: 4, span: 4, row: 0, rows: 1 }, typography: { font: "body", step: "body", color: "ink" }, text: "so'z ".repeat(400) }),
    ],
  });
  const fits = measureText(placeScene(scene));
  assert.equal(fits[0].fits, true);
  assert.equal(fits[1].fits, false, "a wall of text in one row does not fit");
  assert.ok(fits[1].lines > fits[1].maximumLines);
});

test("a pie of negative values is refused", () => {
  const { problems } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [{ type: "chart", place: { column: 0, span: 6, row: 0, rows: 4 }, chart: { kind: "pie", labels: ["a", "b"], values: [-1, 5] } }],
  });
  assert.ok(problems.some((one) => one.message.includes("parts of a whole")));
});

test("an empty card is dropped without taking the slide with it", () => {
  const { scene, problems } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "card", treatment: "solid", place: { column: 0, span: 4, row: 0, rows: 2 }, children: [] },
      title(),
    ],
  });
  assert.deepEqual(problems, []);
  assert.equal(scene.elements.length, 1);
  assert.equal(scene.elements[0].type, "text");
});

test("a model's leading spaces are not an indent", () => {
  const { scene } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [{ ...title(), text: "    Amir Temur davlatining boshqaruv tizimi" }],
  });
  // Renderers preserve whitespace, so this arrived with its first line pushed
  // right and the rest flush — a broken box rather than an indent.
  assert.equal(scene.elements[0].text, "Amir Temur davlatining boshqaruv tizimi");
});
