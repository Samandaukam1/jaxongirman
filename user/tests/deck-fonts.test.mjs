import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The faces the editor offers are faces the engine knows.
 *
 * `deckFonts.ts` (phone) and `glass/dna.ts` (server) are two lists of the same
 * typefaces with the same measured widths. The phone resizes text by the ratio
 * of those widths when a deck's font is changed, so a face whose width differs
 * between the lists would resize wrongly — and a face offered on the phone that
 * the engine does not know would have no measured width at all. Read as text,
 * because one file is React Native and the other is Deno.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const phone = read("../src/lib/deckFonts.ts");
const server = read("../../supabase/functions/_shared/glass/dna.ts");

const serverWidths = new Map();
for (const match of server.matchAll(/family: "([^"]+)", weight: (\d+), em: ([\d.]+)/g)) serverWidths.set(`${match[1]}|${match[2]}`, Number(match[3]));
for (const match of server.matchAll(/family: "([^"]+)", light: \[(\d+), ([\d.]+)\], regular: \[(\d+), ([\d.]+)\], strong: \[(\d+), ([\d.]+)\]/g)) {
  serverWidths.set(`${match[1]}|${match[2]}`, Number(match[3]));
  serverWidths.set(`${match[1]}|${match[4]}`, Number(match[5]));
  serverWidths.set(`${match[1]}|${match[6]}`, Number(match[7]));
}

test("every face the editor offers is measured the same way the engine measured it", () => {
  const offered = [...phone.matchAll(/p\("([^"]+)", (\d+), ([\d.]+)\)/g)];
  assert.ok(offered.length >= 30, `only ${offered.length} faces read from deckFonts.ts`);
  for (const [, family, weight, em] of offered) {
    const known = serverWidths.get(`${family}|${weight}`);
    assert.ok(known !== undefined, `${family} ${weight} is offered on the phone but unknown to the engine`);
    assert.equal(Number(em), known, `${family} ${weight}: phone says ${em}, engine says ${known}`);
  }
});

test("a font change only ever shrinks type, never grows it", () => {
  assert.match(phone, /const ratio = Math\.min\(1, old\.em \/ pairing\[slot\]\.em\);/);
});
