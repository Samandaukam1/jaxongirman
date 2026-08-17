import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

function build() {
  const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-jelement-render-"));
  const configPath = path.join(outDir, "tsconfig.json");
  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir,
      rootDir: repoRoot, allowImportingTsExtensions: false, rewriteRelativeImportExtensions: true,
      paths: { "@jaxongirman/jslayd": [path.join(repoRoot, "packages", "jslayd", "src", "index.ts")] },
    },
    include: [
      path.join(packageRoot, "src", "*.ts"),
      path.join(repoRoot, "packages", "jslayd", "src", "*.ts"),
    ],
  }, null, 2));
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));

  const link = path.join(outDir, "node_modules", "@jaxongirman", "jslayd");
  mkdirSync(link, { recursive: true });
  writeFileSync(path.join(link, "package.json"), JSON.stringify({
    name: "@jaxongirman/jslayd", type: "module",
    main: path.join(outDir, "packages", "jslayd", "src", "index.js"),
  }));
  return path.join(outDir, "packages", "jelement", "src");
}

const dir = build();
const { compile } = await import(`${dir}/compile.js`);
const { renderElement, fitToBox, shouldFlip } = await import(`${dir}/render.js`);

/**
 * An element, drawn.
 *
 * The claim under test is that JElement needs nothing new from any renderer:
 * what comes out is the same filled, rounded, rotatable box the slide engine
 * already draws, so the web view, the phone and the PPTX exporter all work
 * without being told JElement exists.
 */
const SPEC = `JELEMENT-FAMILY 1.0

[FAMILY]
name: Test Family
slug: test-family
category: Test
style: Flat

[COLOR_TOKENS]
primary: #101214
accent: #A7FF00
glass: #1B2728

[VISUAL_DNA]
material: flat
detailDensity: 4

[ELEMENT 01]
canonicalName: test truck
objectClass: vehicle
semantic:
  uzbekTerms: sinov mashinasi
  concepts: testing
geometry:
  visualBounds: 0.1 0.2 0.8 0.6
  naturalFacing: right
  components:
    body:
      shape: roundedRect
      box: 0.1 0.3 0.8 0.4
      fill: {{primary}}
      zIndex: 2
    wheel:
      shape: circle
      box: 0.2 0.6 0.2 0.2
      fill: {{glass}}
      recolorable: false
      zIndex: 3
    trim:
      shape: rect
      box: 0.1 0.26 0.8 0.04
      fill: {{accent}}
      rotation: 5
      zIndex: 4
usage:
  slideRoles: hero
transform:
  flipHorizontal: true
`;

const { family, diagnostics } = compile(SPEC);
assert.deepEqual(diagnostics.errors, [], "the fixture must compile");
const element = family.elements[0];
const TARGET = { x: 100, y: 50, width: 400, height: 300 };

test("an element renders to the rows the slide engine already draws", () => {
  const shapes = renderElement(element, family, TARGET);
  assert.equal(shapes.length, 3, "one row per component");
  for (const shape of shapes) {
    assert.equal(shape.type, "shape", "nothing here is a new element type");
    assert.equal(typeof shape.x, "number");
    assert.equal(typeof shape.style.backgroundColor, "string");
  }
});

test("components land where the element is, scaled to it", () => {
  const [body] = renderElement(element, family, TARGET);
  // box 0.1 0.3 0.8 0.4 inside 100,50 400×300
  assert.equal(body.x, 100 + 0.1 * 400);
  assert.equal(body.y, 50 + 0.3 * 300);
  assert.equal(body.width, 0.8 * 400);
  assert.equal(body.height, 0.4 * 300);
});

test("scaling the element scales everything inside it", () => {
  const small = renderElement(element, family, TARGET);
  const large = renderElement(element, family, { ...TARGET, width: 800, height: 600 });
  assert.equal(large[0].width, small[0].width * 2);
  assert.equal(large[0].height, small[0].height * 2);
});

test("a circle is a rectangle the renderers already round", () => {
  // The reason no renderer needs a new primitive.
  const wheel = renderElement(element, family, TARGET).find((shape) => shape.style.shape === "circle");
  assert.ok(wheel, "the wheel is drawn");
  assert.equal(wheel.style.borderRadius, Math.min(wheel.width, wheel.height) / 2);
});

test("components draw back to front", () => {
  const shapes = renderElement(element, family, TARGET);
  const order = shapes.map((shape) => shape.zIndex);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

/* ---------------------------------------------------------------- colour */

test("colours come from the family, never from the shape", () => {
  const shapes = renderElement(element, family, TARGET);
  assert.equal(shapes[0].style.backgroundColor, "#101214", "the body takes the primary role");
  const trim = shapes.find((shape) => shape.rotation !== 0);
  assert.equal(trim.style.backgroundColor, "#A7FF00", "and the trim the accent");
});

test("an override recolours every shape bound to that role", () => {
  const shapes = renderElement(element, family, TARGET, { accent: "#5B5BFF" });
  const trim = shapes.find((shape) => shape.rotation !== 0);
  assert.equal(trim.style.backgroundColor, "#5B5BFF", "the accent followed the override");
  assert.equal(shapes[0].style.backgroundColor, "#101214", "and nothing else moved");
});

test("a layer that must not be recoloured ignores the override", () => {
  // Glass is glass. An accent change must not turn a cabin window into a lime
  // panel, which is what `recolorable: false` is for.
  const shapes = renderElement(element, family, TARGET, { glass: "#FF0000" });
  const wheel = shapes.find((shape) => shape.style.shape === "circle");
  assert.equal(wheel.style.backgroundColor, "#1B2728", "the family value stands");
});

/* ------------------------------------------------------------- transform */

test("rotation adds to a component's own angle", () => {
  // A tilted trim placed at -12° is tilted by both, which is what somebody
  // rotating an element on a slide expects.
  const shapes = renderElement(element, family, { ...TARGET, rotation: -12 });
  const trim = shapes.find((shape) => Math.abs(shape.rotation - (-12 + 5)) < 0.001);
  assert.ok(trim, "the component's 5° and the placement's -12° combined");
});

test("opacity multiplies rather than replaces", () => {
  const shapes = renderElement(element, family, { ...TARGET, opacity: 0.5 });
  for (const shape of shapes) assert.ok(shape.opacity <= 0.5 + 1e-9);
});

test("flipping mirrors inside the element, not off the edge", () => {
  const normal = renderElement(element, family, TARGET);
  const flipped = renderElement(element, family, { ...TARGET, flipHorizontal: true });

  for (const shape of flipped) {
    assert.ok(shape.x >= TARGET.x - 1, "nothing escapes the element's left edge");
    assert.ok(shape.x + shape.width <= TARGET.x + TARGET.width + 1, "nor its right");
  }
  // The wheel sat left of centre; after a flip it sits right of it.
  const wheelBefore = normal.find((shape) => shape.style.shape === "circle");
  const wheelAfter = flipped.find((shape) => shape.style.shape === "circle");
  assert.ok(wheelAfter.x > wheelBefore.x, "and it actually moved");
});

test("rendering the same input twice produces the same output", () => {
  // Determinism is the whole reason this is geometry rather than a prompt.
  assert.deepEqual(
    renderElement(element, family, TARGET, { accent: "#123456" }),
    renderElement(element, family, TARGET, { accent: "#123456" }),
  );
});

/* ------------------------------------------------------------- placement */

test("fitting uses the visible mass, not the bounding rectangle", () => {
  // The element's visual bounds are 0.1 0.2 0.8 0.6 — the rectangle is much
  // bigger than what the eye sees, and placing by the rectangle is what makes a
  // diagonal object look small and off-centre on every slide.
  const box = { x: 0, y: 0, width: 400, height: 300 };
  const target = fitToBox(element, box);

  const visualLeft = target.x + element.geometry.visualBounds.x * target.width;
  const visualWidth = element.geometry.visualBounds.width * target.width;

  assert.ok(visualWidth <= box.width + 1, "the visible part fits the box");
  assert.ok(visualLeft >= box.x - 1, "and starts inside it");
  assert.ok(target.width > box.width, "which means the element itself is larger than the box");
});

test("an element facing away from the copy is flipped, when it may be", () => {
  // A truck facing right, placed right of a paragraph, reads as leaving.
  assert.equal(shouldFlip(element, "left"), true, "copy on the left wants it facing left");
  assert.equal(shouldFlip(element, "right"), false, "copy on the right is already faced");
});

test("an element that must not be flipped is not flipped", () => {
  const locked = { ...element, transform: { ...element.transform, flipHorizontal: false } };
  assert.equal(shouldFlip(locked, "left"), false, "text on a machine does not survive mirroring");
});

test("a front-facing element is never flipped", () => {
  const front = { ...element, geometry: { ...element.geometry, naturalFacing: "front" } };
  assert.equal(shouldFlip(front, "left"), false, "there is no wrong way for it to face");
});
