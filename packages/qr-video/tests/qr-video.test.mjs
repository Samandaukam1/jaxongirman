import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import jsQR from "jsqr";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

function build() {
  // Inside the repo, not the system temp directory: the package imports
  // `qrcode`, and Node resolves that by walking up from wherever the compiled
  // file sits. From /tmp that walk never reaches this repo's node_modules.
  const cache = path.join(repoRoot, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const outDir = mkdtempSync(path.join(cache, "jaxongirman-qr-video-"));
  const configPath = path.join(outDir, "tsconfig.json");
  const src = path.join(packageRoot, "src");
  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      lib: ["ES2022", "DOM"], strict: true, noUncheckedIndexedAccess: true,
      skipLibCheck: true, outDir, rootDir: src,
    },
    include: [path.join(src, "**", "*.ts")],
  }, null, 2));
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
  return outDir;
}

const dir = build();
const { REFERENCE, drawQr, glowFilter, placeQr, QUIET_ZONE } = await import(`${dir}/index.js`);
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

/* --------------------------------------------------------- the real thing */

/**
 * Rasterises the SVG path the site actually paints.
 *
 * The point of going through the path string rather than the library's matrix
 * is that the path is what ships. A bug in how runs are merged, an off-by-one
 * in the quiet zone, a stray transform — none of that shows up in a test that
 * reads the matrix, and all of it would ship a code nobody can scan.
 */
function rasterise(drawing, { scale = 6, dark = [0x7C, 0x3A, 0xED], light = [0xFF, 0xFF, 0xFF] } = {}) {
  const side = drawing.extent;
  const grid = Array.from({ length: side }, () => new Array(side).fill(false));

  for (const [, x, y, run] of drawing.path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    for (let step = 0; step < Number(run); step += 1) grid[Number(y)][Number(x) + step] = true;
  }

  const pixels = side * scale;
  const data = new Uint8ClampedArray(pixels * pixels * 4);
  for (let row = 0; row < pixels; row += 1) {
    for (let column = 0; column < pixels; column += 1) {
      const on = grid[Math.floor(row / scale)][Math.floor(column / scale)];
      const [r, g, b] = on ? dark : light;
      const at = (row * pixels + column) * 4;
      data[at] = r; data[at + 1] = g; data[at + 2] = b; data[at + 3] = 255;
    }
  }
  return { data, width: pixels, height: pixels, grid };
}

const URLS = [
  "https://jaxongirman.uz/pair/QYbn3kW8ZvT2mLpR7dHsA1cXeF4gJ6uN",
  "https://jaxongirman.uz/game-pair/aB9cD8eF7gH6iJ5kL4mN3oP2qR1sT0uV",
  "https://jaxongirman.app/pair/zz11yy22xx33ww44vv55uu66tt77ss88",
];

test("the code the site paints decodes back to the session URL", () => {
  for (const url of URLS) {
    const image = rasterise(drawQr(url));
    const read = jsQR(image.data, image.width, image.height);
    assert.ok(read, `a real decoder could not read the code for ${url}`);
    assert.equal(read.data, url, "the decoded text must be the session URL, exactly");
  }
});

/**
 * The gradient is the part most likely to break scanning, so it is the part
 * that gets read back at its worst.
 *
 * `#A855F7` is the lightest colour in the brand ramp, and a symbol printed
 * entirely in it is the least contrast this design can ever produce against
 * white. If that decodes, every mixture along the gradient does.
 */
test("even the palest colour in the gradient still scans on white", () => {
  const url = URLS[0];
  const image = rasterise(drawQr(url), { dark: [0xA8, 0x55, 0xF7], light: [0xFF, 0xFF, 0xFF] });
  const read = jsQR(image.data, image.width, image.height);
  assert.ok(read, "the lightest gradient stop must still read against the white background");
  assert.equal(read.data, url);
});

test("a rotated token produces a different code, not a stale one", () => {
  const first = drawQr(URLS[0]);
  const second = drawQr(URLS[1]);
  assert.notEqual(first.path, second.path, "two sessions must never paint the same symbol");
});

/* ------------------------------------------------------------ quiet zone */

test("the symbol keeps its quiet zone on every side", () => {
  const drawing = drawQr(URLS[0]);
  const { grid } = rasterise(drawing);
  const side = drawing.extent;
  assert.equal(side, drawing.modules + QUIET_ZONE * 2, "the drawing must reserve the margin it claims");

  for (let ring = 0; ring < QUIET_ZONE; ring += 1) {
    for (let index = 0; index < side; index += 1) {
      assert.equal(grid[ring][index], false, `row ${ring} of the quiet zone is not clear`);
      assert.equal(grid[side - 1 - ring][index], false, `row ${side - 1 - ring} of the quiet zone is not clear`);
      assert.equal(grid[index][ring], false, `column ${ring} of the quiet zone is not clear`);
      assert.equal(grid[index][side - 1 - ring], false, `column ${side - 1 - ring} of the quiet zone is not clear`);
    }
  }
});

/* -------------------------------------------------------------- geometry */

/**
 * The reference coordinate is a spot in the footage, not a spot in the window.
 * `object-fit: cover` crops, so a percentage of the element lands somewhere the
 * designer never looked as soon as the window stops being 16:9 — which, on a
 * projector, it usually is not.
 */
test("the code sits on the same square of footage in any window shape", () => {
  const frame = { width: 1920, height: 1080 };
  const placement = { x: REFERENCE.x, y: REFERENCE.y, size: REFERENCE.size };

  // Exactly 16:9: no cropping, so the percentages fall where they read.
  const exact = placeQr(placement, frame, { width: 1920, height: 1080 });
  assert.ok(Math.abs(exact.left - 0.468 * 1920) < 0.001);
  assert.ok(Math.abs(exact.top - 0.66 * 1080) < 0.001);
  assert.ok(Math.abs(exact.side - 0.183 * 1920) < 0.001);

  // A taller window crops the sides. The code has to move with the footage,
  // which means leaving the element's own percentages behind.
  const tall = placeQr(placement, frame, { width: 1000, height: 1000 });
  const naive = 0.468 * 1000;
  assert.notEqual(Math.round(tall.left), Math.round(naive));

  // What it must keep is its place *in the frame*: undo the cover transform and
  // the original percentages come back.
  const scale = Math.max(1000 / 1920, 1000 / 1080);
  const drawnWidth = 1920 * scale;
  const drawnHeight = 1080 * scale;
  const backX = (tall.left - (1000 - drawnWidth) / 2) / drawnWidth * 100;
  const backY = (tall.top - (1000 - drawnHeight) / 2) / drawnHeight * 100;
  assert.ok(Math.abs(backX - REFERENCE.x) < 1e-9, `x drifted to ${backX}`);
  assert.ok(Math.abs(backY - REFERENCE.y) < 1e-9, `y drifted to ${backY}`);

  // And it stays square, because the design says 1:1 and the element is sized
  // from one number.
  assert.ok(tall.side > 0);
});

test("a frame or a stage with no size yields nothing rather than NaN", () => {
  const placement = { x: 10, y: 10, size: 10 };
  assert.equal(placeQr(placement, { width: 0, height: 0 }, { width: 100, height: 100 }), null);
  assert.equal(placeQr(placement, { width: 100, height: 100 }, { width: 0, height: 0 }), null);
});

/* ------------------------------------------------------------- the design */

test("the shipped defaults are the reference design", () => {
  assert.equal(REFERENCE.appearMs, 5060, "the code appears at 5.06 seconds");
  assert.equal(REFERENCE.x, 46.8);
  assert.equal(REFERENCE.y, 66);
  assert.equal(REFERENCE.size, 18.3);
  assert.equal(REFERENCE.gradientFrom, "#A855F7");
  assert.equal(REFERENCE.gradientVia, "#7C3AED");
  assert.equal(REFERENCE.gradientTo, "#4F46E5");
  assert.equal(REFERENCE.background, "#FFFFFF");
});

test("no glow costs no filter", () => {
  assert.equal(glowFilter(0), undefined);
  assert.match(glowFilter(REFERENCE.glow), /^drop-shadow\(/);
});
