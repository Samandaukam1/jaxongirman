import assert from "node:assert/strict";
import test from "node:test";

import { buildJelement } from "../../../supabase/tests/helpers/build-jelement.mjs";

const dir = buildJelement();
const {
  crop, dominantHue, gridCells, hexToHsl, hslToRgb, recolour, rgbToHsl, sliceSheet, trim,
} = await import(`${dir}/raster.js`);

/**
 * Cutting a sheet apart and changing what colour it is.
 *
 * These are the two operations that let a rendered CGI asset be a library
 * element: it arrives as one sheet of twelve objects in lime, and it has to
 * become twelve objects that can be lime, amber or blue depending on the deck.
 * Nothing here redraws anything, so the tests are about pixels landing where
 * they should and colours moving only where they were asked to.
 */

/* ------------------------------------------------------------- helpers */

function blank(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function put(pixels, x, y, [red, green, blue], alpha = 255) {
  const index = (y * pixels.width + x) * 4;
  pixels.data[index] = red;
  pixels.data[index + 1] = green;
  pixels.data[index + 2] = blue;
  pixels.data[index + 3] = alpha;
}

function at(pixels, x, y) {
  const index = (y * pixels.width + x) * 4;
  return [pixels.data[index], pixels.data[index + 1], pixels.data[index + 2], pixels.data[index + 3]];
}

/** Fills a rectangle with one colour. */
function fill(pixels, rect, colour, alpha = 255) {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) put(pixels, x, y, colour, alpha);
  }
}

const LIME = [154, 230, 0];
const GRAPHITE = [21, 23, 25];
const CREAM = [232, 217, 186];

/* -------------------------------------------------------------- colour */

test("a colour survives the round trip through HSL", () => {
  for (const colour of [LIME, GRAPHITE, CREAM, [255, 0, 0], [0, 0, 255], [128, 128, 128]]) {
    const [hue, saturation, lightness] = rgbToHsl(...colour);
    const back = hslToRgb(hue, saturation, lightness);
    for (let channel = 0; channel < 3; channel += 1) {
      assert.ok(Math.abs(back[channel] - colour[channel]) <= 1, `${colour} came back as ${back}`);
    }
  }
});

test("the accent is found without being told what it is", () => {
  /**
   * These sheets are one dark mass and one loud colour, and the dark mass is
   * far larger. Counting every pixel would answer "graphite" every time, which
   * is why saturation is the filter rather than frequency alone.
   */
  const sheet = blank(40, 40);
  fill(sheet, { x: 0, y: 0, width: 40, height: 40 }, GRAPHITE);
  fill(sheet, { x: 30, y: 30, width: 6, height: 6 }, LIME);

  const hue = dominantHue(sheet);
  const [limeHue] = rgbToHsl(...LIME);

  assert.ok(hue !== null, "an accent must be found");
  assert.ok(Math.abs(hue - limeHue) < 12, `expected about ${limeHue}, got ${hue}`);
});

test("a sheet with no colour in it reports none, rather than guessing", () => {
  const grey = blank(20, 20);
  fill(grey, { x: 0, y: 0, width: 20, height: 20 }, [128, 128, 128]);
  assert.equal(dominantHue(grey), null);
});

test("recolouring moves the accent and leaves the object alone", () => {
  /**
   * The whole promise of this module. A book is graphite covers, cream pages
   * and a lime ribbon; asking for amber must produce graphite covers, cream
   * pages and an amber ribbon.
   */
  const book = blank(10, 10);
  fill(book, { x: 0, y: 0, width: 10, height: 4 }, GRAPHITE);
  fill(book, { x: 0, y: 4, width: 10, height: 3 }, CREAM);
  fill(book, { x: 0, y: 7, width: 10, height: 3 }, LIME);

  const [limeHue] = rgbToHsl(...LIME);
  const amber = 45;
  const out = recolour(book, limeHue, amber);

  assert.deepEqual(at(out, 5, 1), at(book, 5, 1), "the graphite cover must not move");
  assert.deepEqual(at(out, 5, 5), at(book, 5, 5), "and neither must the cream page");

  const [hue] = rgbToHsl(...at(out, 5, 8).slice(0, 3));
  assert.ok(Math.abs(hue - amber) < 6, `the ribbon should be amber, got hue ${hue}`);
});

test("shading survives a recolour, because lightness is never touched", () => {
  // A lit ribbon and a shadowed one are the same hue at different lightness.
  // If recolouring flattened that, the object would come back looking printed
  // rather than rendered.
  const strip = blank(4, 1);
  put(strip, 0, 0, hslToRgb(90, 1, 0.25));
  put(strip, 1, 0, hslToRgb(90, 1, 0.45));
  put(strip, 2, 0, hslToRgb(90, 1, 0.65));
  put(strip, 3, 0, hslToRgb(90, 1, 0.85));

  const out = recolour(strip, 90, 220);

  const lightness = [0, 1, 2, 3].map((x) => rgbToHsl(...at(out, x, 0).slice(0, 3))[2]);
  for (let index = 1; index < lightness.length; index += 1) {
    assert.ok(lightness[index] > lightness[index - 1], "the gradient must still climb");
  }
  for (const x of [0, 1, 2, 3]) {
    const [hue] = rgbToHsl(...at(out, x, 0).slice(0, 3));
    assert.ok(Math.abs(hue - 220) < 6, `every step should be the new hue, got ${hue}`);
  }
});

test("a fully transparent pixel is never given a colour", () => {
  const sheet = blank(2, 1);
  put(sheet, 0, 0, LIME);
  // Pixel (1,0) is left at alpha 0.
  const [limeHue] = rgbToHsl(...LIME);
  const out = recolour(sheet, limeHue, 300);
  assert.deepEqual(at(out, 1, 0), [0, 0, 0, 0], "empty space stays empty");
});

test("an unrelated colour is left where it is", () => {
  // A gold rim on the same object is not the accent and must not follow it.
  const sheet = blank(2, 1);
  put(sheet, 0, 0, LIME);
  put(sheet, 1, 0, hslToRgb(40, 0.8, 0.5));

  const [limeHue] = rgbToHsl(...LIME);
  const out = recolour(sheet, limeHue, 220, { tolerance: 30 });

  const [gold] = rgbToHsl(...at(out, 1, 0).slice(0, 3));
  assert.ok(Math.abs(gold - 40) < 3, `gold moved to ${gold}`);
});

test("a hex accent is read into the same space the pixels are compared in", () => {
  const parsed = hexToHsl("#9AE600");
  assert.ok(parsed);
  const [direct] = rgbToHsl(...LIME);
  assert.ok(Math.abs(parsed[0] - direct) < 1);
  assert.equal(hexToHsl("lime"), null, "only hex, because only hex is unambiguous");
});

/* ------------------------------------------------------------- slicing */

test("a grid covers the sheet exactly, with no seam and no overlap", () => {
  const cells = gridCells(1000, 750, 4, 3);
  assert.equal(cells.length, 12);

  const covered = cells.reduce((sum, cell) => sum + cell.width * cell.height, 0);
  assert.equal(covered, 1000 * 750, "every pixel belongs to exactly one cell");
});

test("a grid that does not divide evenly still covers every pixel", () => {
  // 1001 across 4 columns. Rounding has to be shared out rather than dropped.
  const cells = gridCells(1001, 751, 4, 3);
  assert.equal(cells.reduce((sum, cell) => sum + cell.width * cell.height, 0), 1001 * 751);
});

test("an object is trimmed to itself, not to its cell", () => {
  /**
   * Without this, a pen with a wide transparent margin is drawn as small as
   * its margin makes it, and lands off-centre beside a book that had none.
   */
  const sheet = blank(100, 100);
  fill(sheet, { x: 40, y: 30, width: 20, height: 10 }, LIME);

  const bounds = trim(sheet, { x: 0, y: 0, width: 100, height: 100 }, { padding: 0 });
  assert.deepEqual(bounds, { x: 40, y: 30, width: 20, height: 10 });
});

test("trimming keeps a little air, because a glow is part of the object", () => {
  const sheet = blank(100, 100);
  fill(sheet, { x: 40, y: 30, width: 20, height: 10 }, LIME);

  const bounds = trim(sheet, { x: 0, y: 0, width: 100, height: 100 }, { padding: 3 });
  assert.deepEqual(bounds, { x: 37, y: 27, width: 26, height: 16 });
});

test("an empty cell yields nothing rather than a blank square", () => {
  const sheet = blank(40, 20);
  // Only the first cell has anything in it.
  fill(sheet, { x: 2, y: 2, width: 8, height: 8 }, LIME);

  const cut = sliceSheet(sheet, 2, 1, { padding: 0 });
  assert.equal(cut.length, 2);
  assert.ok(cut[0], "the occupied cell produces an image");
  assert.equal(cut[1], null, "the empty one produces nothing to delete later");
});

test("a sheet comes apart in reading order, so image n is element n", () => {
  // Four cells, each with one identifying pixel of a different lightness.
  const sheet = blank(20, 20);
  const marks = [
    { x: 2, y: 2, value: 40 }, { x: 12, y: 2, value: 80 },
    { x: 2, y: 12, value: 120 }, { x: 12, y: 12, value: 160 },
  ];
  for (const mark of marks) put(sheet, mark.x, mark.y, [mark.value, mark.value, mark.value]);

  const cut = sliceSheet(sheet, 2, 2, { padding: 0 });
  assert.equal(cut.length, 4);
  for (let index = 0; index < marks.length; index += 1) {
    assert.equal(at(cut[index], 0, 0)[0], marks[index].value, `cell ${index} is out of order`);
  }
});

test("cropping takes the pixels it was pointed at", () => {
  const sheet = blank(6, 6);
  fill(sheet, { x: 2, y: 2, width: 2, height: 2 }, LIME);

  const cut = crop(sheet, { x: 2, y: 2, width: 2, height: 2 });
  assert.equal(cut.width, 2);
  assert.equal(cut.height, 2);
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    assert.deepEqual(at(cut, x, y), [...LIME, 255]);
  }
});

/* ---------------------------------------------------- the two together */

test("a sheet becomes twelve objects, each recolourable on its own", () => {
  /**
   * The end-to-end shape of the feature: one generated sheet in, twelve
   * independently coloured elements out, with nothing redrawn.
   */
  const sheet = blank(120, 90);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const x = column * 30 + 8;
      const y = row * 30 + 8;
      fill(sheet, { x, y, width: 14, height: 8 }, GRAPHITE);
      fill(sheet, { x, y: y + 8, width: 14, height: 6 }, LIME);
    }
  }

  const objects = sliceSheet(sheet, 4, 3, { padding: 0 });
  assert.equal(objects.length, 12);
  assert.equal(objects.filter(Boolean).length, 12);

  const accent = dominantHue(sheet);
  const amber = objects.map((object) => recolour(object, accent, 45));

  for (const object of amber) {
    const [hue] = rgbToHsl(...at(object, 7, 10).slice(0, 3));
    assert.ok(Math.abs(hue - 45) < 8, `an element kept its old accent (${hue})`);
  }
  // And the structure is untouched in every one of them.
  for (let index = 0; index < objects.length; index += 1) {
    assert.deepEqual(at(amber[index], 7, 2), at(objects[index], 7, 2));
  }
});
