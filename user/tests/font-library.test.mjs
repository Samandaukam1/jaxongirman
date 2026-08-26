import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/**
 * The decisions in the font shelf that are not obvious, and would be silently
 * wrong if they changed: which face a request lands on, and whether a runtime
 * name can be read back to the family it came from.
 */

const root = new URL("..", import.meta.url).pathname;
const repoRoot = new URL("../..", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "fontlib-"));

// `fontFaces` imports nothing, which is why it is its own module: the rules
// worth testing are the ones that do not need a network to be wrong.
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "bundler",
    lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir: out,
    rootDir: join(root, "src", "lib"),
  },
  files: [join(root, "src", "lib", "fontFaces.ts")],
}));
execFileSync(join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));

const { faceFor, faceId, slugOf, slugOfFaceId } = await import(join(out, "fontFaces.js"));

const family = (faces) => ({
  id: "x", name: "Montserrat", slug: "montserrat", category: "sans-serif",
  variable: false, featured: false, faces,
});
const face = (weight, italic = false) => ({
  weight, italic, styleName: "x", format: "ttf", storagePath: "p", hash: `h${weight}${italic}`,
});

test("the exact weight wins when the family has it", () => {
  const picked = faceFor(family([face(400), face(600), face(700)]), 600, false);
  assert.equal(picked.weight, 600);
});

test("asking for a weight a family does not cut lands on the nearest", () => {
  const picked = faceFor(family([face(400), face(700)]), 500, false);
  assert.equal(picked.weight, 400);
});

test("a tie goes to the heavier cut", () => {
  // 500 sits exactly between 400 and 600. A heading asked to be heavier than
  // the body must not come back lighter than it.
  const picked = faceFor(family([face(400), face(600)]), 500, false);
  assert.equal(picked.weight, 600);
});

test("a family with no italic gives its upright rather than nothing", () => {
  const picked = faceFor(family([face(400), face(700)]), 400, true);
  assert.equal(picked.weight, 400);
  assert.equal(picked.italic, false);
});

test("italic is preferred when the family has one", () => {
  const picked = faceFor(family([face(400), face(400, true)]), 400, true);
  assert.equal(picked.italic, true);
});

test("a family with no faces resolves to nothing rather than throwing", () => {
  assert.equal(faceFor(family([]), 400, false), null);
});

test("a runtime name can be read back to the family it came from", () => {
  assert.equal(faceId("montserrat", 600, false), "jx_montserrat_600");
  assert.equal(faceId("playfairdisplay", 400, true), "jx_playfairdisplay_400i");
  assert.equal(slugOfFaceId("jx_montserrat_600"), "montserrat");
  assert.equal(slugOfFaceId("jx_playfairdisplay_400i"), "playfairdisplay");
});

test("a bundled face is not mistaken for a library one", () => {
  assert.equal(slugOfFaceId("Manrope_400Regular"), null);
  assert.equal(slugOfFaceId(""), null);
});

test("the slug rule matches the importer's and the storage paths'", () => {
  assert.equal(slugOf("Playfair Display"), "playfairdisplay");
  assert.equal(slugOf("DM Sans"), "dmsans");
});
