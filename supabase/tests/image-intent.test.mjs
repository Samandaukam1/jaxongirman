import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { identityCritical, readIntent } = await import(`${edge}/image-intent.js`);

/**
 * What kind of thing the slide wants a picture of.
 *
 * Everything downstream turns on this. A stock library is right for "modern
 * office" and catastrophic for a person's name — it answers both with equal
 * confidence, and only one of those answers is a stranger's face on somebody's
 * biography.
 */

const intentOf = (query, over = {}) => readIntent({ query, ...over }).intent;

test("a person's name is a person", () => {
  for (const name of ["Sherzodxon Qudratxo‘ja", "Yulduz Usmonova", "Amir Temur", "Albert Einstein"]) {
    assert.equal(intentOf(name), "exact_person", name);
    assert.equal(identityCritical(readIntent({ query: name }).intent), true);
  }
});

test("a concept is not", () => {
  for (const idea of ["modern business office", "artificial intelligence", "students studying", "green energy"]) {
    assert.equal(intentOf(idea), "generic_concept", idea);
    assert.equal(identityCritical(readIntent({ query: idea }).intent), false);
  }
});

test("a name with a place word is a place, not a person", () => {
  /**
   * "Registon maydoni" and "Alisher Navoiy universiteti" both read as names by
   * shape. Sending either to a person lookup finds no human and would block
   * the picture entirely, which is a square and a university nobody can see.
   */
  assert.equal(intentOf("Registon maydoni"), "specific_place");
  assert.equal(intentOf("Alisher Navoiy universiteti"), "organization");
  assert.equal(intentOf("Amir Temur maqbarasi"), "specific_building");
});

test("an event is an event even when a person is in it", () => {
  // The picture wanted is the concert, not the portrait.
  assert.equal(intentOf("Yulduz Usmonova konserti"), "specific_event");
  assert.equal(intentOf("Yulduz Usmonova", { title: "Xalqaro konsert faoliyati" }), "specific_event");
});

test("a product is told apart from the company that makes it", () => {
  assert.equal(intentOf("Chevrolet Cobalt"), "specific_product");
  assert.equal(intentOf("Apple Vision Pro"), "specific_product");
  assert.equal(intentOf("iPhone 15"), "specific_product");
});

test("the entity is separated from the words describing it", () => {
  // The scene belongs in the search; the subject belongs in the cache key.
  const reading = readIntent({ query: "Yulduz Usmonova dramatic stage" });
  assert.equal(reading.entity, "Yulduz Usmonova");
  assert.equal(reading.normalized, "yulduz usmonova");
});

test("one name typed three ways is one cache key", () => {
  const keys = ["Sherzodxon Qudratxo‘ja", "Sherzodxon Qudratxo'ja", "Sherzodxon Qudratxoʻja"]
    .map((name) => readIntent({ query: name }).normalized);
  assert.equal(new Set(keys).size, 1, `three spellings became ${new Set(keys).size} keys`);
});

test("the same query always reads the same way", () => {
  // Routing has to be reproducible: a deck regenerated tomorrow must take the
  // same path as the one generated today.
  const once = readIntent({ query: "Amir Temur", title: "Tarixiy shaxs" });
  const again = readIntent({ query: "Amir Temur", title: "Tarixiy shaxs" });
  assert.deepEqual(once, again);
});
