import assert from "node:assert/strict";
import test from "node:test";

/**
 * Wikimedia Commons, against Wikimedia Commons.
 *
 * The ranking is unit-tested next door against fixtures I wrote, which proves
 * the rules and nothing about the API. This asks the real one: that the query
 * shape is right, that `File:` results come back with their metadata, and that
 * a subject no stock library carries is actually found.
 *
 * Skipped rather than failed when the network is unavailable — a laptop on a
 * train should not report a broken build.
 */

const AGENT = "Jaxongirman/1.0 presentation-generator (https://jaxongirman.uz)";

async function commons(query, limit = 10) {
  const parameters = new URLSearchParams({
    action: "query", format: "json", formatversion: "2",
    generator: "search", gsrsearch: query, gsrnamespace: "6", gsrlimit: String(limit),
    prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "1600",
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${parameters}`, {
    headers: { "User-Agent": AGENT, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const pages = payload.query?.pages;
  return Array.isArray(pages) ? pages : Object.values(pages ?? {});
}

const { buildEdgeModules } = await import("../scripts/build-edge.mjs");
const { bestWikimedia } = await import(`${buildEdgeModules()}/wikimedia-results.js`);

let online = true;
try {
  await commons("test", 1);
} catch {
  online = false;
}

for (const query of ["Amir Temur", "Registan Samarkand", "human heart anatomy"]) {
  test(`Commons has "${query}", with a credit`, { skip: online ? false : "Commons unreachable" }, async () => {
    const hit = bestWikimedia(await commons(query), query, "any");
    assert.ok(hit, `nothing usable came back for "${query}"`);

    assert.equal(hit.attribution.provider, "wikimedia");
    assert.match(hit.url, /^https:\/\/upload\.wikimedia\.org\//);
    assert.match(hit.attribution.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.ok(hit.attribution.creator.length > 0, "nobody to credit");
    assert.ok(hit.attribution.license.length > 0, "no licence");
    assert.ok(hit.width > 0 && hit.height > 0, "no dimensions");

    // The credit is text, not markup: it goes straight onto a slide.
    assert.ok(!/[<>]/.test(hit.attribution.creator), `credit still carries markup: ${hit.attribution.creator}`);

    console.log(`  ${query} → ${hit.width}x${hit.height} · ${hit.attribution.creator} · ${hit.attribution.license}`);
  });
}

test("the picture Commons offers can actually be downloaded", { skip: online ? false : "Commons unreachable" }, async () => {
  // A ranked result with a dead URL is a deck with a hole in it.
  const hit = bestWikimedia(await commons("Registan Samarkand"), "Registan Samarkand", "landscape");
  assert.ok(hit);

  const head = await fetch(hit.url, { method: "HEAD", headers: { "User-Agent": AGENT } });
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type") ?? "", /^image\/(jpeg|png|webp)$/);
});
