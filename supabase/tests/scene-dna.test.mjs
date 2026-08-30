import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { buildDNA, contrastRatio, derivePalette, pairFonts, paletteIsComplete, parseHex, GROUNDS, MOODS } =
  await import(`${edge}/scene-dna.js`);

const library = [
  { name: "Playfair Display", category: "serif" },
  { name: "Inter", category: "sans-serif" },
  { name: "Space Grotesk", category: "sans-serif" },
  { name: "JetBrains Mono", category: "monospace" },
  { name: "Bebas Neue", category: "display" },
];

const direction = (over = {}) => ({
  mood: "editorial", ground: "near_black", brand: "#5A78F0", cornerLanguage: "soft", gradients: true, ...over,
});

test("every ground produces a complete palette", () => {
  for (const ground of GROUNDS) {
    const colors = derivePalette(direction({ ground }));
    assert.ok(paletteIsComplete(colors), `${ground} is incomplete`);
  }
});

test("body copy is readable on its own ground, on every ground", () => {
  for (const ground of GROUNDS) {
    const colors = derivePalette(direction({ ground }));
    const ratio = contrastRatio(parseHex(colors.background), parseHex(colors.ink));
    assert.ok(ratio >= 7, `${ground}: ink ${ratio.toFixed(1)}:1`);
    const muted = contrastRatio(parseHex(colors.background), parseHex(colors.inkMuted));
    assert.ok(muted >= 4.5, `${ground}: muted ${muted.toFixed(1)}:1`);
  }
});

test("a brand colour too close to its ground is moved until it can be seen", () => {
  // Near-black brand on a near-black ground: unreadable as given.
  const colors = derivePalette(direction({ ground: "near_black", brand: "#101114" }));
  const ratio = contrastRatio(parseHex(colors.background), parseHex(colors.primary));
  assert.ok(ratio >= 3, `primary ${ratio.toFixed(1)}:1`);
});

test("chart colours are distinguishable from each other and from the ground", () => {
  const colors = derivePalette(direction());
  const series = [colors.chart1, colors.chart2, colors.chart3, colors.chart4];
  assert.equal(new Set(series).size, 4, "four series, four colours");
  for (const one of series) {
    assert.ok(contrastRatio(parseHex(colors.background), parseHex(one)) >= 3);
  }
});

test("fonts come from the library and nowhere else", () => {
  for (const mood of MOODS) {
    const fonts = pairFonts(mood, library);
    for (const [role, name] of Object.entries(fonts)) {
      assert.ok(library.some((family) => family.name === name), `${mood}/${role} invented ${name}`);
    }
  }
});

test("an editorial deck is set in a serif and a geometric one is not", () => {
  assert.equal(pairFonts("editorial", library).display, "Playfair Display");
  assert.ok(["Inter", "Space Grotesk", "Bebas Neue"].includes(pairFonts("geometric", library).display));
});

test("display and body are different faces where the library can offer two", () => {
  const fonts = pairFonts("editorial", library);
  assert.notEqual(fonts.display, fonts.body);
});

test("a one-font library still produces a usable pairing", () => {
  const fonts = pairFonts("cinematic", [{ name: "Inter", category: "sans-serif" }]);
  assert.equal(fonts.display, "Inter");
  assert.equal(fonts.body, "Inter");
});

test("no library is a refusal, not a guessed font", () => {
  assert.equal(pairFonts("editorial", []), null);
  assert.equal(buildDNA(direction(), []), null);
});

test("the corner language sets one radius for the whole deck", () => {
  assert.equal(buildDNA(direction({ cornerLanguage: "sharp" }), library).radius, 0);
  assert.ok(buildDNA(direction({ cornerLanguage: "pill" }), library).radius > 32);
});
