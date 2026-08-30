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

test("an unknown role is an error rather than a silently dropped element", () => {
  const { problems } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [{ ...title(), role: "headline" }],
  });
  assert.ok(problems.some((one) => one.message.includes("unknown text role")));
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

test("an empty card is refused, because it is decoration pretending to be content", () => {
  const { problems } = readScene({
    background: { kind: "solid", color: "background" },
    elements: [{ type: "card", treatment: "solid", place: { column: 0, span: 4, row: 0, rows: 2 }, children: [] }],
  });
  assert.ok(problems.some((one) => one.path.endsWith(".children")));
});
