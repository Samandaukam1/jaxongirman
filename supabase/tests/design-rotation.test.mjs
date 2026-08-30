import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { pickWithRotation, rankDesigns, matchTopics } = await import(`${edge}/design-select.js`);

const candidates = [
  { id: "alpha", slug: "alpha", keywords: [{ keyword: "tarix", score: 10 }], pages: 0, featured: true },
  { id: "beta", slug: "beta", keywords: [{ keyword: "tarix", score: 9 }], pages: 0, featured: false },
  { id: "gamma", slug: "gamma", keywords: [{ keyword: "tarix", score: 8 }], pages: 0, featured: false },
];
const taxonomy = [{ slug: "tarix", label: "Tarix", synonyms: ["tarixi"] }];
const ranked = () => rankDesigns(candidates, matchTopics("O'zbekiston tarixi", taxonomy));

test("with no history the best match wins", () => {
  const picked = pickWithRotation(ranked(), new Set());
  assert.equal(picked.chosen.id, "alpha");
  assert.equal(picked.repeated, false);
});

test("a design used in a recent deck steps aside", () => {
  const picked = pickWithRotation(ranked(), new Set(["alpha"]));
  assert.equal(picked.chosen.id, "beta");
  assert.equal(picked.repeated, false);
});

test("the same topic twice does not produce the same design twice", () => {
  const first = pickWithRotation(ranked(), new Set());
  const second = pickWithRotation(ranked(), new Set([first.chosen.id]));
  assert.notEqual(first.chosen.id, second.chosen.id);
});

test("three recent decks are all avoided while a fourth design exists", () => {
  const wider = [...candidates, { id: "delta", slug: "delta", keywords: [{ keyword: "tarix", score: 7 }], pages: 0, featured: false }];
  const list = rankDesigns(wider, matchTopics("O'zbekiston tarixi", taxonomy));
  const picked = pickWithRotation(list, new Set(["alpha", "beta", "gamma"]));
  assert.equal(picked.chosen.id, "delta");
});

test("a small catalogue repeats rather than refusing to make a deck", () => {
  const picked = pickWithRotation(ranked(), new Set(["alpha", "beta", "gamma"]));
  assert.equal(picked.chosen.id, "alpha");
  assert.equal(picked.repeated, true);
});

test("an empty catalogue chooses nothing at all", () => {
  assert.equal(pickWithRotation([], new Set()), null);
});
