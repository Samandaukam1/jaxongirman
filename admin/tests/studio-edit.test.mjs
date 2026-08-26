import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/**
 * The editing arithmetic, run rather than reasoned about.
 *
 * These are the operations a drag, a handle and an align button perform on a
 * compiled design. They are pure on purpose: the canvas is a view over them,
 * so getting them right here is getting the editor right.
 */

const root = new URL("..", import.meta.url).pathname;
const repoRoot = new URL("../..", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "studio-"));

/**
 * The package is stubbed rather than compiled.
 *
 * `studioEdit` takes two constants and some types from `@jaxongirman/jslayd`
 * and nothing else, so pulling the whole engine through `tsc` to test a
 * rectangle would be a slow way to test the wrong thing.
 */
writeFileSync(join(out, "jslayd-stub.ts"), [
  "export const CANVAS_WIDTH = 1920;",
  "export const CANVAS_HEIGHT = 1080;",
  "export type Geometry = { x: number; y: number; width: number; height: number; rotation: number; zIndex: number; anchor: string };",
  "export type ColorValue = { role: string } | { hex: string };",
  "export type GradientStop = { offset: number; color: ColorValue };",
  "export type Gradient = { type: 'linear' | 'radial'; angle: number; stops: readonly GradientStop[] };",
  "export type Border = { width: number; color: ColorValue; style: 'solid' | 'dashed' | 'dotted'; opacity: number };",
  "export type Corners = { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };",
  "export type Shadow = { offsetX: number; offsetY: number; blur: number; spread: number; opacity: number; color: ColorValue };",
  "export type JslaydElement = { id: string; type: string; geometry: Geometry; background?: ColorValue | Gradient | null;"
  + " border?: Border | null; corners?: Corners | null; shadows?: readonly Shadow[];"
  + " slot?: string; fit?: 'cover' | 'contain' | 'fill'; focus?: { x: number; y: number };"
  + " orientation?: string; required?: boolean; queryFrom?: readonly string[];"
  + " stylePreference?: string | null; overlayOpacity?: number };",
  "export type Archetype = { id: string; elements: JslaydElement[] };",
  "export type JslaydDocument = { archetypes: Archetype[] };",
].join("\n"));

const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "bundler",
    lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir: out,
    baseUrl: out,
    paths: { "@jaxongirman/jslayd": [join(out, "jslayd-stub.ts")] },
  },
  files: [join(root, "src", "lib", "studioEdit.ts"), join(out, "jslayd-stub.ts")],
}));
execFileSync(join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));

/**
 * `paths` steers the type checker, not the emit, so the compiled file still
 * names the package. It is pointed at the stub here rather than in tsconfig.
 */
const { globSync, readFileSync } = await import("node:fs");
const [emitted] = globSync(join(out, "**", "studioEdit.js"));
const [stub] = globSync(join(out, "**", "jslayd-stub.js"));
writeFileSync(emitted, readFileSync(emitted, "utf8")
  .replace(/from ["']@jaxongirman\/jslayd["']/g, `from ${JSON.stringify(stub)}`));

const studio = await import(emitted);
const {
  CANVAS, HANDLES, alignElements, beginGesture, canRedo, canUndo, clampBox, commit,
  distribute, duplicateElement, endGesture, freeId, moveElement, preview, redo,
  removeElement, renameElement, reorder, resizeBox, setGeometry, snap, stackingOrder,
  startHistory, undo, addStop, gradientFromPreset, gradientOf, removeStop, setFill, setStop,
  DEFAULT_BORDER, DEFAULT_SHADOW, MAX_SHADOWS, addShadow, cornersAreEven, evenCorners,
  patchBorder, patchShadow, removeShadow, setBorder, setCorners, setImageRules, setShadows,
  takesBorder, takesCorners, takesShadow, boundingBox, nudgeElements,
} = studio;

const element = (id, x, y, width, height) => ({
  id, type: "text", geometry: { x, y, width, height, rotation: 0, zIndex: 1, anchor: "top-left" },
});
const shape = (id) => ({
  id, type: "shape",
  geometry: { x: 0, y: 0, width: 400, height: 200, rotation: 0, zIndex: 1, anchor: "top-left" },
});
const doc = (...elements) => ({ archetypes: [{ id: "a1", elements }] });
const boxOf = (document, id) => document.archetypes[0].elements.find((e) => e.id === id).geometry;

/* ------------------------------------------------------------------- snap */

test("geometry lands on the spacing ladder, not where the pointer stopped", () => {
  assert.equal(snap(617), 616);
  assert.equal(snap(618), 620);
  assert.equal(snap(24), 24);
});

test("a box is kept on the canvas and kept grabbable", () => {
  const offRight = clampBox({ x: CANVAS.width + 500, y: 10, width: 200, height: 100 });
  assert.equal(offRight.x, CANVAS.width - 200);

  const negative = clampBox({ x: -80, y: -40, width: 200, height: 100 });
  assert.deepEqual([negative.x, negative.y], [0, 0]);

  // Nothing is allowed to become a handle-less sliver.
  const tiny = clampBox({ x: 0, y: 0, width: 1, height: 1 });
  assert.ok(tiny.width >= 16 && tiny.height >= 16);
});

/* ------------------------------------------------------------------ move */

test("a move changes one element and leaves the rest identical", () => {
  const before = doc(element("t1", 100, 100, 400, 80), element("t2", 100, 300, 400, 80));
  const after = moveElement(before, "a1", "t1", { x: 244, y: 156, width: 400, height: 80 });

  assert.deepEqual(boxOf(after, "t1"), { ...boxOf(before, "t1"), x: 244, y: 156 });
  // Identity, not just equality: an untouched element should not be rebuilt.
  assert.equal(after.archetypes[0].elements[1], before.archetypes[0].elements[1]);
});

test("setGeometry can be given one field without inventing the others", () => {
  const before = doc(element("t1", 100, 100, 400, 80));
  const after = setGeometry(before, "a1", "t1", { zIndex: 9 });
  assert.equal(boxOf(after, "t1").zIndex, 9);
  assert.equal(boxOf(after, "t1").x, 100);
});

/* ---------------------------------------------------------------- resize */

test("every handle pulls the edge it names and no other", () => {
  const box = { x: 200, y: 200, width: 400, height: 200 };

  const east = resizeBox(box, "e", 50, 999);
  assert.deepEqual([east.x, east.y, east.width, east.height], [200, 200, 450, 200]);

  const north = resizeBox(box, "n", 999, -40);
  assert.deepEqual([north.x, north.y, north.width, north.height], [200, 160, 400, 240]);

  // A corner moves the origin and the size together.
  const northWest = resizeBox(box, "nw", -60, -30);
  assert.deepEqual([northWest.x, northWest.y, northWest.width, northWest.height], [140, 170, 460, 230]);
});

test("a handle dragged through its opposite edge does not invert the box", () => {
  const box = { x: 200, y: 200, width: 400, height: 200 };
  const crushed = resizeBox(box, "e", -900, 0);
  assert.ok(crushed.width >= 16, `width went to ${crushed.width}`);
  assert.ok(crushed.x >= 0);
});

test("there are eight handles and they are all distinct", () => {
  assert.equal(HANDLES.length, 8);
  assert.equal(new Set(HANDLES).size, 8);
});

/* --------------------------------------------------------------- history */

test("a gesture is one undo, however many frames it took", () => {
  /**
   * The whole point. Twenty presses of undo to put an element back is the same
   * as having no undo at all.
   */
  const start = doc(element("t1", 100, 100, 400, 80));
  let history = startHistory(start);

  history = beginGesture(history);
  // Fifty frames of a drag: the present moves, the past does not grow.
  for (let frame = 1; frame <= 50; frame += 1) {
    history = preview(history, moveElement(history.present, "a1", "t1", {
      x: 100 + frame * 4, y: 100, width: 400, height: 80,
    }));
  }
  assert.equal(history.past.length, 0, "a mid-gesture frame was recorded");

  history = endGesture(history);
  assert.equal(history.past.length, 1, "the gesture recorded no entry at all");

  history = undo(history);
  assert.equal(boxOf(history.present, "t1").x, 100, "one undo did not return the element");
});

test("undo and redo are symmetric, and say when they are exhausted", () => {
  const start = doc(element("t1", 100, 100, 400, 80));
  let history = startHistory(start);
  assert.equal(canUndo(history), false);
  assert.equal(canRedo(history), false);

  history = commit(history, setGeometry(history.present, "a1", "t1", { x: 300 }));
  assert.equal(canUndo(history), true);

  history = undo(history);
  assert.equal(boxOf(history.present, "t1").x, 100);
  assert.equal(canRedo(history), true);

  history = redo(history);
  assert.equal(boxOf(history.present, "t1").x, 300);
});

test("a new edit after an undo drops the redo branch", () => {
  let history = startHistory(doc(element("t1", 100, 100, 400, 80)));
  history = commit(history, setGeometry(history.present, "a1", "t1", { x: 300 }));
  history = undo(history);
  history = commit(history, setGeometry(history.present, "a1", "t1", { y: 500 }));
  assert.equal(canRedo(history), false, "a branch nobody can reach was kept");
});

test("a gesture that moved nothing records nothing", () => {
  // Click an element, do not drag it, let go.
  let history = startHistory(doc(element("t1", 100, 100, 400, 80)));
  history = endGesture(beginGesture(history));
  assert.equal(history.past.length, 0);
  assert.equal(history.anchor, null, "the gesture was left open");
});

test("committing the same document twice is not two entries", () => {
  let history = startHistory(doc(element("t1", 100, 100, 400, 80)));
  history = commit(history, history.present);
  assert.equal(history.past.length, 0);
});

/* ----------------------------------------------------------------- align */

test("align works against the set's own outer edges", () => {
  const before = doc(
    element("a", 100, 100, 200, 50),
    element("b", 400, 200, 300, 50),
    element("c", 250, 300, 100, 50),
  );

  const left = alignElements(before, "a1", ["a", "b", "c"], "left");
  assert.deepEqual([boxOf(left, "a").x, boxOf(left, "b").x, boxOf(left, "c").x], [100, 100, 100]);

  const right = alignElements(before, "a1", ["a", "b", "c"], "right");
  // The outermost right edge is b's, at 700.
  assert.deepEqual(
    [boxOf(right, "a").x + 200, boxOf(right, "b").x + 300, boxOf(right, "c").x + 100],
    [700, 700, 700],
  );
});

test("aligning fewer than two elements is a no-op, not a crash", () => {
  const before = doc(element("a", 100, 100, 200, 50));
  assert.equal(alignElements(before, "a1", ["a"], "left"), before);
  assert.equal(alignElements(before, "a1", [], "left"), before);
});

test("distribute evens the gaps and leaves the outer two alone", () => {
  const before = doc(
    element("a", 0, 0, 100, 50),
    element("b", 150, 0, 100, 50),
    element("c", 900, 0, 100, 50),
  );
  const after = distribute(before, "a1", ["a", "b", "c"], "x");

  assert.equal(boxOf(after, "a").x, 0, "the first element moved");
  assert.equal(boxOf(after, "c").x, 900, "the last element moved");

  const gapOne = boxOf(after, "b").x - (boxOf(after, "a").x + 100);
  const gapTwo = boxOf(after, "c").x - (boxOf(after, "b").x + 100);
  assert.ok(Math.abs(gapOne - gapTwo) <= 4, `gaps ${gapOne} and ${gapTwo} are not even`);
});

test("distribute needs three elements to mean anything", () => {
  const before = doc(element("a", 0, 0, 100, 50), element("b", 200, 0, 100, 50));
  assert.equal(distribute(before, "a1", ["a", "b"], "x"), before);
});

/* ---------------------------------------------------------------- layers */

const zed = (id, z) => ({
  id, type: "text",
  geometry: { x: 0, y: 0, width: 100, height: 50, rotation: 0, zIndex: z, anchor: "top-left" },
});

test("the panel reorders a list; the numbers are this function's problem", () => {
  const before = { archetypes: [{ id: "a1", elements: [zed("a", 5), zed("b", 5), zed("c", 9)] }] };
  const after = reorder(before, "a1", ["c", "a", "b"]);
  const z = (id) => after.archetypes[0].elements.find((e) => e.id === id).geometry.zIndex;

  assert.deepEqual([z("c"), z("a"), z("b")], [1, 2, 3]);
  // No two elements share a number afterwards, which was the point.
  assert.equal(new Set([z("a"), z("b"), z("c")]).size, 3);
});

test("stacking order is bottom-first, and a tie does not flap", () => {
  const archetype = { id: "a1", elements: [zed("a", 3), zed("b", 1), zed("c", 3)] };
  const once = stackingOrder(archetype).map((e) => e.id);
  const twice = stackingOrder(archetype).map((e) => e.id);
  assert.deepEqual(once, ["b", "a", "c"]);
  assert.deepEqual(once, twice, "two elements sharing a z swapped between renders");
});

test("a duplicate is visibly a copy, not hidden under the original", () => {
  const before = doc(element("title", 100, 100, 400, 80));
  const { document: after, id } = duplicateElement(before, "a1", "title");

  assert.equal(id, "title_copy");
  assert.equal(after.archetypes[0].elements.length, 2);
  const copy = boxOf(after, "title_copy");
  assert.ok(copy.x > 100 && copy.y > 100, "the copy landed exactly on top of the original");
  assert.ok(copy.zIndex > boxOf(after, "title").zIndex);
});

test("duplicating twice does not produce two elements with one id", () => {
  let document = doc(element("title", 100, 100, 400, 80));
  document = duplicateElement(document, "a1", "title").document;
  document = duplicateElement(document, "a1", "title").document;
  const ids = document.archetypes[0].elements.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.join(", ")}`);
});

test("a copy of a copy does not stack the suffix forever", () => {
  const archetype = { id: "a1", elements: [zed("title", 1), zed("title_copy", 2)] };
  assert.equal(freeId(archetype, "title_copy"), "title_copy2");
});

test("deleting removes one element and nothing else", () => {
  const before = doc(element("a", 0, 0, 100, 50), element("b", 0, 100, 100, 50));
  const after = removeElement(before, "a1", "a");
  assert.deepEqual(after.archetypes[0].elements.map((e) => e.id), ["b"]);
});

test("a rename is refused rather than allowed to collide", () => {
  const before = doc(element("a", 0, 0, 100, 50), element("b", 0, 100, 100, 50));

  const taken = renameElement(before, "a1", "a", "b");
  assert.equal(taken.document, before, "a colliding rename went through");
  assert.match(taken.error, /band/);

  const bad = renameElement(before, "a1", "a", "2 words");
  assert.equal(bad.document, before);
  assert.ok(bad.error);

  const good = renameElement(before, "a1", "a", "headline");
  assert.equal(good.error, null);
  assert.deepEqual(good.document.archetypes[0].elements.map((e) => e.id), ["headline", "b"]);
});

test("renaming an element to its own name is allowed", () => {
  const before = doc(element("a", 0, 0, 100, 50));
  const same = renameElement(before, "a1", "a", "a");
  assert.equal(same.error, null);
});

/* ------------------------------------------------------------------ fill */

const gradient = (...offsets) => ({
  type: "linear", angle: 90,
  stops: offsets.map((offset) => ({ offset, color: { role: "primary" } })),
});
const elementOfDoc = (document, id) => document.archetypes[0].elements.find((e) => e.id === id);

test("stops are sorted whatever order they arrive in", () => {
  const before = doc(element("box", 0, 0, 100, 100));
  const after = setFill(before, "a1", "box", gradient(80, 0, 40));
  assert.deepEqual(gradientOf(elementOfDoc(after, "box")).stops.map((s) => s.offset), [0, 40, 80]);
});

test("a preset becomes a gradient in roles, not in hex", () => {
  const built = gradientFromPreset({
    type: "linear", angle: 135,
    stops: [{ role: "primary", position: 0 }, { role: "accent", position: 100 }],
  });
  assert.equal(built.type, "linear");
  assert.equal(built.angle, 135);
  assert.deepEqual(built.stops.map((s) => s.color), [{ role: "primary" }, { role: "accent" }]);
});

test("a stop can be moved and recoloured, and the order is kept", () => {
  let document = setFill(doc(element("box", 0, 0, 100, 100)), "a1", "box", gradient(0, 100));
  document = setStop(document, "a1", "box", 0, { offset: 70 });
  const stops = gradientOf(elementOfDoc(document, "box")).stops;
  assert.deepEqual(stops.map((s) => s.offset), [70, 100]);
});

test("a new stop lands in the widest gap, where it can be seen", () => {
  let document = setFill(doc(element("box", 0, 0, 100, 100)), "a1", "box", gradient(0, 10, 100));
  document = addStop(document, "a1", "box");
  const offsets = gradientOf(elementOfDoc(document, "box")).stops.map((s) => s.offset);
  // The widest gap is 10 → 100, so the new stop is at 55, not at 5.
  assert.ok(offsets.includes(55), `stops: ${offsets.join(", ")}`);
});

test("a gradient is never allowed fewer than two stops", () => {
  let document = setFill(doc(element("box", 0, 0, 100, 100)), "a1", "box", gradient(0, 100));
  const after = removeStop(document, "a1", "box", 0);
  assert.equal(gradientOf(elementOfDoc(after, "box")).stops.length, 2, "a gradient was reduced to a colour");

  document = setFill(document, "a1", "box", gradient(0, 50, 100));
  const trimmed = removeStop(document, "a1", "box", 1);
  assert.equal(gradientOf(elementOfDoc(trimmed, "box")).stops.length, 2);
});

test("a plain colour is not mistaken for a gradient", () => {
  const document = setFill(doc(element("box", 0, 0, 100, 100)), "a1", "box", { role: "surface" });
  assert.equal(gradientOf(elementOfDoc(document, "box")), null);
  assert.deepEqual(elementOfDoc(document, "box").background, { role: "surface" });
});

test("clearing a fill sets null rather than deleting the key", () => {
  const document = setFill(doc(element("box", 0, 0, 100, 100)), "a1", "box", null);
  assert.equal(elementOfDoc(document, "box").background, null);
});

/* --------------------------------------------------------------- border */

test("a border is written whole or not at all", () => {
  const before = doc(element("t1", 0, 0, 400, 80));

  // Switching it on from nothing produces every part a renderer needs, rather
  // than a width with no colour for an exporter to guess at.
  const on = patchBorder(before, "a1", "t1", { width: 4 });
  const border = on.archetypes[0].elements[0].border;
  assert.deepEqual(border, { ...DEFAULT_BORDER, width: 4 });

  const off = setBorder(on, "a1", "t1", null);
  assert.equal(off.archetypes[0].elements[0].border, null);
});

test("a patch keeps the parts it was not given", () => {
  const before = setBorder(doc(element("t1", 0, 0, 400, 80)), "a1", "t1",
    { width: 6, color: { hex: "#FF0000" }, style: "dashed", opacity: 0.5 });
  const after = patchBorder(before, "a1", "t1", { width: 2 });

  assert.deepEqual(after.archetypes[0].elements[0].border,
    { width: 2, color: { hex: "#FF0000" }, style: "dashed", opacity: 0.5 });
});

/* -------------------------------------------------------------- corners */

test("four corners, set together or read as even", () => {
  assert.deepEqual(evenCorners(18), { topLeft: 18, topRight: 18, bottomRight: 18, bottomLeft: 18 });
  assert.ok(cornersAreEven(evenCorners(18)));
  assert.ok(cornersAreEven(null), "no corners is not an uneven corner");
  assert.ok(!cornersAreEven({ topLeft: 18, topRight: 0, bottomRight: 18, bottomLeft: 18 }));

  const document = setCorners(doc(element("t1", 0, 0, 400, 80)), "a1", "t1", evenCorners(12));
  assert.equal(document.archetypes[0].elements[0].corners.bottomLeft, 12);
});

/* -------------------------------------------------------------- shadows */

test("shadows are capped, because past three nobody can see the difference", () => {
  let document = doc(shape("s1"));
  for (let at = 0; at < MAX_SHADOWS + 2; at += 1) document = addShadow(document, "a1", "s1");

  assert.equal(document.archetypes[0].elements[0].shadows.length, MAX_SHADOWS);
  // Refused, not silently truncated to a different document each time.
  assert.equal(addShadow(document, "a1", "s1"), document);
});

test("a shadow is edited and removed by position", () => {
  let document = addShadow(addShadow(doc(shape("s1")), "a1", "s1"), "a1", "s1");
  document = patchShadow(document, "a1", "s1", 1, { blur: 4 });

  const shadows = document.archetypes[0].elements[0].shadows;
  assert.equal(shadows[0].blur, DEFAULT_SHADOW.blur, "the other shadow is untouched");
  assert.equal(shadows[1].blur, 4);

  const fewer = removeShadow(document, "a1", "s1", 0);
  assert.equal(fewer.archetypes[0].elements[0].shadows.length, 1);
  assert.equal(fewer.archetypes[0].elements[0].shadows[0].blur, 4, "the right one was removed");

  // A position that is not there is a no-op rather than a hole in the array.
  assert.equal(removeShadow(document, "a1", "s1", 9), document);
  assert.equal(patchShadow(document, "a1", "s1", 9, { blur: 1 }), document);
});

/* ---------------------------------------------------------------- image */

const image = (id) => ({
  id, type: "image",
  geometry: { x: 0, y: 0, width: 800, height: 600, rotation: 0, zIndex: 1, anchor: "top-left" },
  slot: "hero", fit: "cover", focus: { x: 0.5, y: 0.5 }, orientation: "landscape",
  required: false, queryFrom: [], stylePreference: null, overlayOpacity: 0,
});

test("a focal point outside the picture is brought back onto it", () => {
  const before = doc(image("i1"));

  const past = setImageRules(before, "a1", "i1", { focus: { x: 1.8, y: -0.4 } });
  assert.deepEqual(past.archetypes[0].elements[0].focus, { x: 1, y: 0 });

  const inside = setImageRules(before, "a1", "i1", { focus: { x: 0.25, y: 0.75 } });
  assert.deepEqual(inside.archetypes[0].elements[0].focus, { x: 0.25, y: 0.75 });
});

test("an overlay cannot be more opaque than opaque", () => {
  const before = doc(image("i1"));
  assert.equal(setImageRules(before, "a1", "i1", { overlayOpacity: 4 }).archetypes[0].elements[0].overlayOpacity, 1);
  assert.equal(setImageRules(before, "a1", "i1", { overlayOpacity: -1 }).archetypes[0].elements[0].overlayOpacity, 0);
});

test("image rules are refused on things that are not images", () => {
  const before = doc(element("t1", 0, 0, 400, 80));
  const after = setImageRules(before, "a1", "t1", { fit: "contain" });
  assert.equal(after.archetypes[0].elements[0].fit, undefined, "a text box has no crop");
});

test("what an element can carry is read from the language, not from what it happens to hold", () => {
  /**
   * An icon has no border because `IconElement` does not define one. Writing
   * it anyway produces a document that appears to save and loses the change on
   * the next read, because the compiler drops what the type does not declare.
   *
   * Text is the case that makes this worth asserting: it takes a border and a
   * corner radius but no shadow.
   */
  assert.ok(takesBorder({ type: "text" }) && takesCorners({ type: "text" }));
  assert.ok(!takesShadow({ type: "text" }), "text has no shadow in the language");
  assert.ok(takesShadow({ type: "line" }), "a line is a shape and shapes do");
  assert.ok(takesCorners({ type: "table" }) && !takesShadow({ type: "table" }));
  for (const type of ["icon", "chart", "list", "group"]) {
    assert.ok(!takesBorder({ type }) && !takesCorners({ type }) && !takesShadow({ type }),
      `${type} carries no box properties`);
  }

  const icon = { id: "i1", type: "icon", geometry: { x: 0, y: 0, width: 64, height: 64, rotation: 0, zIndex: 1, anchor: "top-left" } };
  const before = { archetypes: [{ id: "a1", elements: [icon] }] };
  assert.equal(setCorners(before, "a1", "i1", evenCorners(8)).archetypes[0].elements[0].corners, undefined);
  assert.equal(setBorder(before, "a1", "i1", DEFAULT_BORDER).archetypes[0].elements[0].border, undefined);
  assert.equal(addShadow(before, "a1", "i1"), before, "an icon cannot be given a shadow");
});

/* ------------------------------------------------------ moving a selection */

test("a selection moves as one rectangle, not as three elements clamping separately", () => {
  const before = doc(
    element("a", 40, 100, 200, 100),
    element("b", 300, 100, 200, 100),
    element("c", 560, 100, 200, 100),
  );

  // Far enough left that the first element alone would hit the wall.
  const after = nudgeElements(before, "a1", ["a", "b", "c"], -400, 0);

  // The group stops at the edge and keeps its shape: every gap is what it was.
  assert.equal(boxOf(after, "a").x, 0);
  assert.equal(boxOf(after, "b").x, 260, "the middle element kept its distance");
  assert.equal(boxOf(after, "c").x, 520);
});

test("the bounding box is the rectangle around the selection", () => {
  const document = doc(
    element("a", 100, 200, 100, 50),
    element("b", 400, 100, 200, 400),
  );
  assert.deepEqual(boundingBox(document.archetypes[0], ["a", "b"]), { x: 100, y: 100, width: 500, height: 400 });
  assert.deepEqual(boundingBox(document.archetypes[0], ["a"]), { x: 100, y: 200, width: 100, height: 50 });
  assert.equal(boundingBox(document.archetypes[0], []), null);
  assert.equal(boundingBox(document.archetypes[0], ["nope"]), null);
});

test("elements outside the selection do not move", () => {
  const before = doc(element("a", 100, 100, 200, 100), element("b", 400, 100, 200, 100));
  const after = nudgeElements(before, "a1", ["a"], 40, 40);

  assert.deepEqual([boxOf(after, "a").x, boxOf(after, "a").y], [140, 140]);
  assert.deepEqual([boxOf(after, "b").x, boxOf(after, "b").y], [400, 100]);
});

test("a nudge that changes nothing returns the same document", () => {
  const before = doc(element("a", 0, 100, 200, 100));
  // Already at the wall and pushed further into it.
  assert.equal(nudgeElements(before, "a1", ["a"], -50, 0), before);
  assert.equal(nudgeElements(before, "a1", [], 40, 40), before);
});
