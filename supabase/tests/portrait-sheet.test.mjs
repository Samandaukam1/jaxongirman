import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { GRID, MIN_PIXELS, PHOTO, SHEET, checkSource, coverCrop, mm, slots } =
  await import(`${edge}/portrait-sheet.js`);

/**
 * A print sheet is wrong in a way a screen never is.
 *
 * Nobody notices until it comes out of a printer and the photographs are four
 * per cent too small for the form they were cut for — a wasted trip rather than
 * a bug report. So every measurement is checked against the millimetres it is
 * supposed to be, not against whatever the code happens to produce.
 */

const toMm = (points) => points / mm(1);

test("the sheet is A6 and the photographs are 30 by 40 millimetres", () => {
  assert.equal(SHEET.widthMm, 105);
  assert.equal(SHEET.heightMm, 148);
  assert.equal(PHOTO.widthMm, 30);
  assert.equal(PHOTO.heightMm, 40);

  const [first] = slots();
  assert.ok(Math.abs(toMm(first.width) - 30) < 0.001, `${toMm(first.width)}mm`);
  assert.ok(Math.abs(toMm(first.height) - 40) < 0.001, `${toMm(first.height)}mm`);
});

test("nine photographs, three by three", () => {
  assert.equal(slots().length, 9);
  assert.equal(GRID.columns * GRID.rows, 9);
});

test("nothing runs off the paper", () => {
  for (const slot of slots()) {
    assert.ok(slot.x >= 0, `chapdan chiqib ketdi: ${slot.x}`);
    assert.ok(slot.y >= 0, `pastdan chiqib ketdi: ${slot.y}`);
    assert.ok(toMm(slot.x + slot.width) <= SHEET.widthMm + 0.001);
    assert.ok(toMm(slot.y + slot.height) <= SHEET.heightMm + 0.001);
  }
});

test("the block is centred, so the sheet can be cut from any edge", () => {
  const all = slots();
  const left = Math.min(...all.map((slot) => slot.x));
  const right = SHEET.widthMm - toMm(Math.max(...all.map((slot) => slot.x + slot.width)));
  const bottom = Math.min(...all.map((slot) => slot.y));
  const top = SHEET.heightMm - toMm(Math.max(...all.map((slot) => slot.y + slot.height)));

  assert.ok(Math.abs(toMm(left) - right) < 0.001, `chap ${toMm(left)} ≠ o‘ng ${right}`);
  assert.ok(Math.abs(toMm(bottom) - top) < 0.001, `past ${toMm(bottom)} ≠ tepa ${top}`);
});

test("no two photographs overlap", () => {
  const all = slots();
  for (let a = 0; a < all.length; a += 1) {
    for (let b = a + 1; b < all.length; b += 1) {
      const overlapX = all[a].x < all[b].x + all[b].width && all[b].x < all[a].x + all[a].width;
      const overlapY = all[a].y < all[b].y + all[b].height && all[b].y < all[a].y + all[a].height;
      assert.ok(!(overlapX && overlapY), `${a} va ${b} ustma-ust tushdi`);
    }
  }
});

test("rows fill from the top, which is the order a sheet is cut", () => {
  const all = slots();
  assert.ok(all[0].y > all[3].y, "birinchi qator ikkinchisidan tepada bo‘lishi kerak");
  assert.ok(all[3].y > all[6].y);
  assert.ok(all[0].x < all[1].x, "qator chapdan o‘ngga to‘ldirilsin");
});

/* ------------------------------------------------------- what may be printed */

test("300 dpi is the floor, expressed in pixels", () => {
  assert.equal(MIN_PIXELS.width, 355);
  assert.equal(MIN_PIXELS.height, 473);
});

test("a small picture is refused rather than printed soft", () => {
  const { problems } = checkSource(300, 400);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, "too_small");
});

test("a landscape picture is refused, not cropped to a sliver", () => {
  const { problems } = checkSource(1600, 900);
  assert.ok(problems.some((problem) => problem.code === "not_portrait"));
});

test("a portrait at the right size passes with nothing to say", () => {
  const { problems, warnings } = checkSource(900, 1200);
  assert.deepEqual(problems, []);
  assert.deepEqual(warnings, []);
});

test("a portrait of the wrong shape is allowed, and the trim is named", () => {
  const { problems, warnings } = checkSource(1000, 1600);
  assert.deepEqual(problems, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /kesiladi/);
});

test("the crop is centred and keeps the whole of one dimension", () => {
  // Too wide: the full height survives, the sides go.
  const wide = coverCrop(1000, 1000);
  assert.equal(wide.height, 1000);
  assert.equal(wide.width, 750);
  assert.equal(wide.x, 125);

  // Too tall: the full width survives, top and bottom go.
  const tall = coverCrop(600, 1200);
  assert.equal(tall.width, 600);
  assert.equal(tall.height, 800);
  assert.equal(tall.y, 200);

  // Already 3:4: untouched.
  assert.deepEqual(coverCrop(900, 1200), { x: 0, y: 0, width: 900, height: 1200 });
});
