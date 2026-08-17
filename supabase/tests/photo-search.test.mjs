import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { photoQuery } = await import(`${edge}/photo-query.js`);

/**
 * Turning a slide's visual direction into something a photo index can answer.
 *
 * The directions in this system were written for an image model: they describe
 * a style nothing in an index is tagged with. Handing one to a search returns
 * pictures of clay and studio lighting rather than of the subject, so the style
 * words come out and the nouns stay.
 */

test("style words are dropped and the subject survives", () => {
  const query = photoQuery(
    "isolated 3D clay render of a mining excavator, soft contact shadow, matte finish",
    "Konchilik sanoati",
  );
  assert.ok(query.includes("mining"), "the subject is what an index can match");
  assert.ok(query.includes("excavator"));
  for (const style of ["3d", "clay", "render", "isolated", "matte", "shadow"]) {
    assert.equal(query.includes(style), false, `"${style}" describes a look, not a thing`);
  }
});

test("a direction that is nothing but style falls back to the topic", () => {
  // Better a picture about roughly the right subject than a picture of
  // "professional high quality soft lighting", which is nothing.
  const query = photoQuery("professional high quality studio lighting, modern minimal style", "sun'iy intellekt ta'limda");
  assert.ok(query.length > 0);
  assert.ok(query.includes("sun'iy") || query.includes("intellekt"));
});

test("a query stays short enough to match something", () => {
  // A long query is a query with no results: an index matches tags, and eight
  // required words match nothing.
  const query = photoQuery(
    "a wide editorial photograph showing several engineers inspecting an underground conveyor belt system in a working coal mine",
    "kon",
  );
  assert.ok(query.split(" ").length <= 4, `got "${query}"`);
});

test("punctuation and case do not reach the index", () => {
  const query = photoQuery("Neural-network, ARTIFICIAL intelligence!", "AI");
  assert.equal(query, query.toLowerCase());
  assert.equal(/[,!]/.test(query), false);
});

test("an empty direction still produces something askable", () => {
  assert.ok(photoQuery("", "raqamli transformatsiya").length > 0);
});
