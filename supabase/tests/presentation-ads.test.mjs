import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

/** The spec's own examples, and the rule the database counts with. */

const edge = buildEdgeModules();
const { deckWithAds } = await import(`${edge}/presentation-ads.js`);
const shape = (pages) => pages.map((page) => (page.kind === "ad" ? `A${page.ad}` : page.index + 1)).join(" ");
const adPagesInDatabase = (slides, ads) => Math.min(Math.max(ads, 0), Math.max(Math.floor((slides - 1) / 5), 0));

test("10 pages and 1 ad: the ad is page 6, eleven pages in all", () => {
  assert.equal(shape(deckWithAds(10, [1])), "1 2 3 4 5 A1 6 7 8 9 10");
});

test("20 pages and 1 ad: still only page 6", () => {
  const pages = deckWithAds(20, [1]);
  assert.equal(pages.length, 21);
  assert.equal(pages.findIndex((page) => page.kind === "ad"), 5);
});

test("20 pages and 3 ads: pages 6, 12 and 18, twenty-three in all", () => {
  const pages = deckWithAds(20, [1, 2, 3]);
  assert.equal(pages.length, 23);
  assert.deepEqual(pages.map((page, at) => (page.kind === "ad" ? at + 1 : null)).filter(Boolean), [6, 12, 18]);
});

test("a deck never ends on an ad, and no ads means no ad pages", () => {
  assert.equal(shape(deckWithAds(5, [1, 2, 3])), "1 2 3 4 5");
  assert.equal(shape(deckWithAds(10, [1, 2, 3])), "1 2 3 4 5 A1 6 7 8 9 10");
  assert.equal(shape(deckWithAds(12, [])), "1 2 3 4 5 6 7 8 9 10 11 12");
});

test("the database counts the same number of ad pages", () => {
  for (let slides = 0; slides <= 40; slides += 1) {
    for (let ads = 0; ads <= 3; ads += 1) {
      const counted = deckWithAds(slides, Array.from({ length: ads }, (_, at) => at)).filter((page) => page.kind === "ad").length;
      assert.equal(counted, adPagesInDatabase(slides, ads), `${slides} slides, ${ads} ads`);
    }
  }
});

test("the app's copy and the server's are the same file", () => {
  const root = new URL("../..", import.meta.url).pathname;
  assert.equal(readFileSync(`${root}supabase/functions/_shared/presentation-ads.ts`, "utf8"),
    readFileSync(`${root}packages/types/src/presentation-ads.ts`, "utf8"));
});
