import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { pptxFace } = await import(`${edge}/fonts.js`);

/**
 * PowerPoint resolves a font by name on the machine that opens the file, and
 * pptxgenjs cannot embed one. So the only thing an exporter controls is which
 * name it writes — and writing the wrong one is a deck that opens in the wrong
 * typeface with nothing to say why.
 */

test("a design's own family is what the run is named", () => {
  assert.equal(pptxFace({
    fontDisplayName: "Montserrat",
    fontFallback: "Manrope_700Bold",
    fontFamily: "Montserrat",
    fontWeight: "600",
  }), "Montserrat");
});

test("a family with a space keeps it", () => {
  assert.equal(pptxFace({ fontDisplayName: "Playfair Display" }), "Playfair Display");
});

test("with no real face, the bundled one the design nominated is named", () => {
  // Not a default the exporter invented: a documented substitution.
  assert.equal(pptxFace({ fontFallback: "LeagueSpartan_700Bold" }), "League Spartan");
  assert.equal(pptxFace({ fontFallback: "Arimo_400Regular" }), "Arimo");
});

test("blank is not a family", () => {
  assert.equal(pptxFace({ fontDisplayName: "   ", fontFallback: "Arimo_400Regular" }), "Arimo");
});

test("naming nothing usable lands on the default rather than on undefined", () => {
  assert.equal(pptxFace({}), "Manrope");
  assert.equal(pptxFace(null), "Manrope");
});
