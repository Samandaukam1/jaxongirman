import assert from "node:assert/strict";
import test from "node:test";

import { buildJelement } from "../../../supabase/tests/helpers/build-jelement.mjs";

const dir = buildJelement();
const { manifestToFamily, readManifest } = await import(`${dir}/manifest.js`);
const { SHEET_PROMPT, sheetExpansionPrompt } = await import(`${dir}/sheet-prompt.js`);

/**
 * The names that arrive with a reference sheet.
 *
 * This replaced an indented, sectioned language that nested by leading spaces —
 * and chat interfaces flatten leading spaces, so a specification pasted from a
 * chat compiled to twelve elements containing nothing. JSON cannot fail that
 * way, which is most of the reason it is JSON.
 */

const ELEMENT = (cell, name, uzbek) => ({
  cell,
  canonicalName: name,
  displayName: uzbek,
  objectClass: "other",
  uzbekTerms: [uzbek],
  englishTerms: [name],
  concepts: ["reading"],
});

const GOOD = {
  family: { name: "Adabiyot", slug: "adabiyot", category: "Adabiyot", style: "CGI" },
  grid: { columns: 2, rows: 1 },
  colorTokens: { primary: "#151719", accent: "#9BEA00" },
  elements: [ELEMENT(1, "open book", "ochiq kitob"), ELEMENT(2, "quill", "patqalam")],
};

const json = (value) => JSON.stringify(value, null, 2);

test("a well-formed manifest is read", () => {
  const { manifest, errors } = readManifest(json(GOOD));
  assert.deepEqual(errors, []);
  assert.equal(manifest.family.slug, "adabiyot");
  assert.equal(manifest.elements.length, 2);
  assert.equal(manifest.colorTokens.accent, "#9BEA00");
});

test("a fenced code block is accepted, because that is how it arrives", () => {
  // Nobody strips the fence by hand, and refusing it would be a refusal over
  // punctuation.
  const { manifest, errors } = readManifest("```json\n" + json(GOOD) + "\n```");
  assert.deepEqual(errors, []);
  assert.equal(manifest.elements.length, 2);
});

test("elements come back in cell order however they were listed", () => {
  const shuffled = { ...GOOD, elements: [GOOD.elements[1], GOOD.elements[0]] };
  const { manifest } = readManifest(json(shuffled));
  assert.deepEqual(manifest.elements.map((e) => e.cell), [1, 2]);
  assert.equal(manifest.elements[0].canonicalName, "open book");
});

test("a count that does not match the grid is refused, not padded", () => {
  /**
   * The nth cut becomes the nth element. If the counts differ, every element
   * after the gap is mislabelled — a quill filed as a bust — and the library
   * is quietly wrong rather than loudly broken.
   */
  const short = { ...GOOD, grid: { columns: 4, rows: 3 } };
  const { manifest, errors } = readManifest(json(short));
  assert.equal(manifest, null);
  assert.ok(errors.some((message) => /12 ta katak/.test(message)), errors.join("; "));
});

test("an element with no Uzbek name is refused", () => {
  // The product is used in Uzbek. An element nobody can search for in Uzbek is
  // indistinguishable from one that is not there.
  const noUzbek = {
    ...GOOD,
    elements: [{ ...GOOD.elements[0], uzbekTerms: [] }, GOOD.elements[1]],
  };
  const { manifest, errors } = readManifest(json(noUzbek));
  assert.equal(manifest, null);
  assert.ok(errors.some((message) => /o'zbekcha/.test(message)), errors.join("; "));
});

test("two elements in one cell is a mismatch, not a preference", () => {
  const collide = { ...GOOD, elements: [GOOD.elements[0], { ...GOOD.elements[1], cell: 1 }] };
  const { manifest, errors } = readManifest(json(collide));
  assert.equal(manifest, null);
  assert.ok(errors.some((message) => /katak ikki marta/.test(message)), errors.join("; "));
});

test("the same object twice is refused", () => {
  const duplicate = { ...GOOD, elements: [GOOD.elements[0], { ...GOOD.elements[0], cell: 2 }] };
  const { manifest, errors } = readManifest(json(duplicate));
  assert.equal(manifest, null);
  assert.ok(errors.some((message) => /takrorlangan/.test(message)), errors.join("; "));
});

test("a comma-separated list is read as a list", () => {
  // What a model returns when the schema says "list" and the example reads as
  // prose. Accepting it costs one line and saves a round trip.
  const loose = {
    ...GOOD,
    elements: [{ ...GOOD.elements[0], aliases: "book, opened book" }, GOOD.elements[1]],
  };
  const { manifest } = readManifest(json(loose));
  assert.deepEqual(manifest.elements[0].aliases, ["book", "opened book"]);
});

test("text that is not JSON says so plainly", () => {
  const { manifest, errors } = readManifest("JELEMENT-FAMILY 1.0\n\n[FAMILY]\nname: x");
  assert.equal(manifest, null);
  assert.match(errors[0], /JSON o'qilmadi/);
});

test("a colour that is not hex is dropped with a note, not a refusal", () => {
  const loose = { ...GOOD, colorTokens: { accent: "lime", primary: "#151719" } };
  const { manifest, warnings } = readManifest(json(loose));
  assert.ok(manifest, "one bad colour must not cost the whole sheet");
  assert.equal("accent" in manifest.colorTokens, false);
  assert.equal(warnings.length, 1);
});

/* ------------------------------------------------------------- the prompt */

test("the prompt asks for both halves, and says why the grid matters", () => {
  assert.match(SHEET_PROMPT, /transparent PNG/i);
  assert.match(SHEET_PROMPT, /4 columns, 3 rows/);
  assert.match(SHEET_PROMPT, /NOTHING crosses a cell boundary/);
  assert.match(SHEET_PROMPT, /"cell": 1/);
});

test("the prompt no longer asks anybody to describe geometry", () => {
  // Two rounds were spent asking a model to describe a studio render as boxes
  // and paths. The instruction to stop is explicit, so it cannot creep back.
  assert.match(SHEET_PROMPT, /No geometry, no coordinates/);
  assert.equal(/components:/.test(SHEET_PROMPT), false);
  assert.equal(/shape: path/.test(SHEET_PROMPT), false);
});

test("an expansion prompt carries what already exists, so nothing is redrawn", () => {
  const prompt = sheetExpansionPrompt(
    { name: "Adabiyot", slug: "adabiyot", category: "Adabiyot", style: "CGI" },
    ["open book", "quill"],
    6,
  );
  assert.match(prompt, /open book/);
  assert.match(prompt, /quill/);
  assert.match(prompt, /"columns": 3/);
  assert.match(prompt, /"rows": 2/);
});

test("an expansion prompt for an empty family still reads correctly", () => {
  const prompt = sheetExpansionPrompt(
    { name: "Yangi", slug: "yangi", category: "X", style: "CGI" }, [], 12,
  );
  assert.match(prompt, /\(none yet\)/);
  assert.match(prompt, /"columns": 4/);
});

test("a manifest becomes the family shape the database already takes", () => {
  /**
   * Reusing the existing save path rather than adding a second one. The console
   * has always sent a compiled family; a manifest is just another way of
   * arriving at the same document.
   */
  const { manifest } = readManifest(json(GOOD));
  const family = manifestToFamily(manifest);

  assert.equal(family.format, "JELEMENT");
  assert.equal(family.family.slug, "adabiyot");
  assert.equal(family.elements.length, 2);
  for (const element of family.elements) {
    assert.equal(element.rendering, "asset", "these are pictures, and say so");
    assert.deepEqual(element.geometry.components, [], "the drawing arrives later");
    assert.ok(element.usage.slideRoles.length > 0, "a role is always set");
  }
  assert.ok(family.search.keywords.includes("ochiq kitob"), "search is built from the elements");
});
