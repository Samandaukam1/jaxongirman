import assert from "node:assert/strict";
import test from "node:test";

import { SLIDE_HOLD_MS, settledSlide, slideAfter } from "../src/presenting.ts";

test("a command lands where the database will put it", () => {
  assert.equal(slideAfter("next", 3, 10), 4);
  assert.equal(slideAfter("next", 9, 10), 9, "the last slide is the end");
  assert.equal(slideAfter("previous", 0, 10), 0, "the first slide is the start");
  assert.equal(slideAfter("goto", 0, 10, 7), 7);
  assert.equal(slideAfter("goto", 0, 10, 42), 9, "a jump past the end stops at the end");
  assert.equal(slideAfter("goto", 5, 10, -3), 0);
  assert.equal(slideAfter("goto", 5, 10, Number.NaN), 0, "a value that is not a number goes to the start, as in SQL");
  assert.equal(slideAfter("next", 0, 0), 0, "an empty deck never moves");
});

test("quick taps are not replayed by the answers that follow them", () => {
  const now = 10_000;
  const pending = { slide: 6, at: now };
  assert.deepEqual(settledSlide(4, pending, now + 120), { slide: 6, pending }, "an older answer does not pull the screen back");
  assert.deepEqual(settledSlide(5, pending, now + 300), { slide: 6, pending });
  assert.deepEqual(settledSlide(6, pending, now + 500), { slide: 6, pending: null }, "the answer that agrees settles it");
});

test("the database wins once a move is too old to be on its way", () => {
  const pending = { slide: 6, at: 0 };
  assert.deepEqual(settledSlide(4, pending, SLIDE_HOLD_MS + 1), { slide: 4, pending: null });
  assert.deepEqual(settledSlide(4, null, 0), { slide: 4, pending: null }, "and with nothing in flight it simply wins");
});
