import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { firstUsable, queryLadder } = await import(`${edge}/unsplash-results.js`);

/**
 * A picture that cannot be credited cannot be published, and a search that
 * finds nothing is the normal case rather than the failure case.
 */

const photo = (over = {}) => ({
  id: "x",
  width: 4000,
  height: 3000,
  urls: { regular: "https://images.example/photo.jpg" },
  links: { html: "https://unsplash.example/photos/x" },
  user: { name: "A Photographer" },
  alt_description: "a laboratory",
  ...over,
});

test("the first result that can be used and credited is the one taken", () => {
  const hit = firstUsable([photo()]);
  assert.equal(hit.url, "https://images.example/photo.jpg");
  assert.equal(hit.attribution.creator, "A Photographer");
  assert.equal(hit.attribution.provider, "Unsplash");
  assert.equal(hit.attribution.licenseUrl, "https://unsplash.com/license");
  assert.equal(hit.attribution.sourceUrl, "https://unsplash.example/photos/x");
});

test("a photo with no photographer is skipped, not used with an empty credit", () => {
  const results = [photo({ user: {} }), photo({ user: { name: "Credited" } })];
  assert.equal(firstUsable(results).attribution.creator, "Credited");
});

test("a photo with no link back is skipped: the terms require one", () => {
  const results = [photo({ links: {} }), photo({ user: { name: "Second" } })];
  assert.equal(firstUsable(results).attribution.creator, "Second");
});

test("a result with no file at all is skipped", () => {
  assert.equal(firstUsable([photo({ urls: {} })]), null);
});

test("a missing description becomes a title rather than an empty string", () => {
  assert.equal(firstUsable([photo({ alt_description: null, description: null })]).attribution.title, "Untitled");
  assert.equal(firstUsable([photo({ alt_description: "  " , description: null })]).attribution.title, "Untitled");
});

test("nothing usable comes back as null rather than as a broken hit", () => {
  assert.equal(firstUsable([]), null);
});

/* ------------------------------------------------------------------ ladder */

test("the ladder drops information rather than inventing it", () => {
  const steps = queryLadder("quarterly revenue growth in emerging markets", "finance");
  assert.equal(steps[0], "quarterly revenue growth in emerging markets");
  assert.equal(steps[1], "quarterly revenue growth", "the subject is the first three words");
  assert.equal(steps[2], "quarterly");
  // The last resorts are a theme-shaped texture, then any texture at all.
  assert.ok(steps.includes("finance abstract background"));
  assert.equal(steps.at(-1), "abstract texture");
});

test("a one-word query does not produce the same step four times", () => {
  const steps = queryLadder("mitochondria");
  assert.equal(new Set(steps).size, steps.length, `duplicates in ${steps.join(" | ")}`);
  assert.equal(steps[0], "mitochondria");
});

test("an empty query still ends somewhere usable", () => {
  const steps = queryLadder("   ");
  assert.ok(steps.length > 0);
  assert.equal(steps.at(-1), "abstract texture");
});

test("the ladder is ordered from most specific to least", () => {
  const steps = queryLadder("solar panel installation on a rooftop", "technology");
  const lengths = steps.map((step) => step.split(/\s+/).length);
  // Not strictly monotonic — the abstract fallbacks are longer on purpose —
  // but the real queries narrow.
  assert.ok(lengths[0] > lengths[1] && lengths[1] > lengths[2]);
});
