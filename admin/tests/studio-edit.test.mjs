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
  "export type JslaydElement = { id: string; type: string; geometry: Geometry };",
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
  distribute, endGesture, moveElement, preview, redo, resizeBox, setGeometry, snap,
  startHistory, undo,
} = studio;

const element = (id, x, y, width, height) => ({
  id, type: "text", geometry: { x, y, width, height, rotation: 0, zIndex: 1, anchor: "top-left" },
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
