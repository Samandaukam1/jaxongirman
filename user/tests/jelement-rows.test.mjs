import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const userRoot = path.resolve(here, "..");
const repoRoot = path.resolve(userRoot, "..");

/**
 * An element behaves as one thing on a slide.
 *
 * Dragging a truck must not leave a wheel behind, and the editor works one row
 * at a time — so the placement is the truth and the rows are derived from it.
 * Every transform is "change the placement, redraw", which is what these tests
 * hold: there is no delta arithmetic to drift over a long editing session.
 */
function build() {
  const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-jelement-rows-"));
  const configPath = path.join(outDir, "tsconfig.json");
  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir,
      rootDir: path.join(userRoot, "src", "lib"),
      allowImportingTsExtensions: false,
    },
    files: [path.join(userRoot, "src", "lib", "jelement-rows.ts")],
  }, null, 2));

  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
  return outDir;
}

const outDir = build();
const { rowsFor, placementOf, isElementRow, initialPlacement, boundsOf } =
  await import(path.join(outDir, "jelement-rows.js"));

const ELEMENT = {
  elementId: "11110000-0000-4000-8000-000000000001",
  version: 3,
  name: "mining haul truck",
  colorTokens: { primary: "#101214", accent: "#A7FF00", glass: "#1B2728" },
  components: [
    { id: "body", shape: "roundedRect", box: { x: 0.1, y: 0.3, width: 0.8, height: 0.4 }, rotation: 0, zIndex: 1, fill: "primary", opacity: 1, recolorable: true },
    { id: "wheel", shape: "circle", box: { x: 0.2, y: 0.65, width: 0.15, height: 0.2 }, rotation: 0, zIndex: 3, fill: "glass", opacity: 1, recolorable: false },
    { id: "trim", shape: "rect", box: { x: 0.1, y: 0.26, width: 0.8, height: 0.04 }, rotation: 4, zIndex: 2, fill: "accent", opacity: 1, recolorable: true },
  ],
};

const BASE = {
  slideId: "22220000-0000-4000-8000-000000000002",
  presentationId: "33330000-0000-4000-8000-000000000003",
  ownerId: "44440000-0000-4000-8000-000000000004",
  zIndex: 10,
};

const PLACEMENT = {
  groupId: "group-1", elementId: ELEMENT.elementId, version: 3,
  x: 200, y: 100, width: 400, height: 300, rotation: 0, flipHorizontal: false,
};

test("one element becomes one row per component", () => {
  const rows = rowsFor(ELEMENT, PLACEMENT, BASE);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.type, "shape", "nothing here is a new element type");
    assert.equal(row.slide_id, BASE.slideId);
  }
});

test("every member carries the placement, so any one can rebuild the set", () => {
  // This is what makes the group survive a reload: the truth is in the rows,
  // not in editor state that is lost when the app closes.
  const rows = rowsFor(ELEMENT, PLACEMENT, BASE);
  for (const row of rows) {
    const placement = placementOf(row);
    assert.ok(placement, "the placement travelled");
    assert.equal(placement.groupId, "group-1");
    assert.equal(placement.elementId, ELEMENT.elementId);
    assert.equal(placement.version, 3, "and the version it was drawn from");
  }
});

test("a row that is not part of an element says so", () => {
  assert.equal(isElementRow({ content: {} }), false);
  assert.equal(isElementRow({ content: null }), false);
  assert.equal(isElementRow(rowsFor(ELEMENT, PLACEMENT, BASE)[0]), true);
});

test("components land inside the placement, scaled to it", () => {
  const [body] = rowsFor(ELEMENT, PLACEMENT, BASE);
  assert.equal(body.x, 200 + 0.1 * 400);
  assert.equal(body.y, 100 + 0.3 * 300);
  assert.equal(body.width, 0.8 * 400);
  assert.equal(body.height, 0.4 * 300);
});

test("moving the placement moves every member together", () => {
  // The failure this prevents: dragging the truck and leaving a wheel behind.
  const before = rowsFor(ELEMENT, PLACEMENT, BASE);
  const after = rowsFor(ELEMENT, { ...PLACEMENT, x: 500, y: 250 }, BASE);

  for (const [index, row] of after.entries()) {
    assert.equal(row.x - before[index].x, 300, `${row.content.component} moved with the rest`);
    assert.equal(row.y - before[index].y, 150);
    assert.equal(row.width, before[index].width, "and nothing changed size");
  }
});

test("scaling the placement scales every member proportionally", () => {
  const before = rowsFor(ELEMENT, PLACEMENT, BASE);
  const after = rowsFor(ELEMENT, { ...PLACEMENT, width: 800, height: 600 }, BASE);
  for (const [index, row] of after.entries()) {
    assert.equal(row.width, before[index].width * 2);
    assert.equal(row.height, before[index].height * 2);
  }
});

test("rotating adds to each component's own angle", () => {
  const rows = rowsFor(ELEMENT, { ...PLACEMENT, rotation: -12 }, BASE);
  const trim = rows.find((row) => row.content.component === "trim");
  assert.equal(trim.rotation, -12 + 4, "the component's 4° and the placement's -12°");
});

test("redrawing is exact, so a long session cannot drift", () => {
  // Rows are regenerated wholesale rather than patched. Applying the same
  // placement twice must produce identical geometry, or repeated edits would
  // accumulate rounding.
  const once = rowsFor(ELEMENT, PLACEMENT, BASE);
  const moved = rowsFor(ELEMENT, { ...PLACEMENT, x: 500 }, BASE);
  const back = rowsFor(ELEMENT, PLACEMENT, BASE);
  assert.deepEqual(back, once, "returning to a placement returns to the same pixels");
  assert.notDeepEqual(moved, once);
});

test("flipping mirrors inside the placement, not off the edge", () => {
  const normal = rowsFor(ELEMENT, PLACEMENT, BASE);
  const flipped = rowsFor(ELEMENT, { ...PLACEMENT, flipHorizontal: true }, BASE);

  for (const row of flipped) {
    assert.ok(row.x >= PLACEMENT.x - 0.5, "nothing escapes the left edge");
    assert.ok(row.x + row.width <= PLACEMENT.x + PLACEMENT.width + 0.5, "nor the right");
  }
  const wheelBefore = normal.find((row) => row.content.component === "wheel");
  const wheelAfter = flipped.find((row) => row.content.component === "wheel");
  assert.ok(wheelAfter.x > wheelBefore.x, "and the wheel actually moved");
});

test("colours come from the family, and an override reaches what may follow it", () => {
  const rows = rowsFor(ELEMENT, PLACEMENT, BASE, { accent: "#5B5BFF", glass: "#FF0000" });
  const trim = rows.find((row) => row.content.component === "trim");
  const wheel = rows.find((row) => row.content.component === "wheel");

  assert.equal(trim.style.fill, "#5B5BFF", "the accent followed the override");
  assert.equal(wheel.style.fill, "#1B2728", "and the glass did not, because it may not");
});

test("members stack in the order the element declared", () => {
  const rows = rowsFor(ELEMENT, PLACEMENT, BASE);
  const order = rows.map((row) => row.z_index);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal(rows[0].content.component, "body", "the body is behind");
  assert.equal(rows[2].content.component, "wheel", "and the wheel in front");
});

test("a first placement leaves the slide room to breathe", () => {
  // An element inserted at full width is one the person must shrink before
  // they can do anything else.
  const placement = initialPlacement(ELEMENT.elementId, 3, { width: 1000, height: 562.5 }, "g");
  assert.ok(placement.width < 1000 * 0.5, "it does not fill the slide");
  assert.ok(placement.x > 0 && placement.y > 0, "and it is inset from the corner");

  const bounds = boundsOf(placement);
  assert.ok(bounds.x + bounds.width <= 1000, "it fits horizontally");
  assert.ok(bounds.y + bounds.height <= 562.5, "and vertically");
});

test("a placed element carries its outline onto the slide", () => {
  /**
   * The admin preview and the phone have to draw the same object.
   *
   * They did not: the preview was about to learn paths while the row builder
   * still emitted a box per component, so an element would have looked right
   * in the console and like a stack of blocks on the slide somebody exported.
   */
  const rows = rowsFor(
    { ...ELEMENT, components: [
      ...ELEMENT.components,
      { id: "bucket", shape: "path", box: { x: 0.05, y: 0.4, width: 0.3, height: 0.3 },
        rotation: 0, zIndex: 9, fill: "primary", opacity: 1, recolorable: true,
        path: "M 6 8 L 88 2 L 96 44 Z" },
    ] },
    PLACEMENT,
    BASE,
    {},
  );

  const bucket = rows.find((row) => row.style.path);
  assert.ok(bucket, "the outline must reach the row");
  assert.equal(bucket.style.viewBox, "0 0 100 100");
  assert.equal(bucket.style.fill, "#101214", "and still take its colour from the token");
});
