import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

/** Decks, defence scripts and games in Turkish: the server's side of the fourth language. */

const edge = buildEdgeModules();
const { DECK_LANGUAGES, CHROME, ANSWER_IN, RESEARCH_IN, facesFor, isDeckLanguage } = await import(`${edge}/glass/language.js`);
const { capitals } = await import(`${edge}/glass/compose.js`);
const { spellSlide } = await import(`${edge}/glass/spelling.js`);

test("Turkish is a deck language with its own words around the slides", () => {
  assert.ok(DECK_LANGUAGES.includes("tr"));
  assert.ok(isDeckLanguage("tr"));
  assert.equal(CHROME.tr.references, "Kaynakça");
  assert.equal(CHROME.tr.sections(5), "5 ana bölüm");
  assert.match(ANSWER_IN.tr, /Turkish/);
  assert.equal(RESEARCH_IN.tr, "Turkish");
});

test("Turkish capitals keep the dot on the i", () => {
  assert.equal(capitals("bilimsel çalışma", "tr"), "BİLİMSEL ÇALIŞMA");
  assert.equal(capitals("bilim", "uz"), "BILIM");
  assert.equal(capitals("science", "en"), "SCIENCE");
});

test("a Turkish deck never picks a face without İ, Ğ and Ş", () => {
  const all = () => true;
  assert.equal(facesFor("tr", all)("Prata", 400), false);
  assert.equal(facesFor("tr", all)("Lato", 400), true);
});

test("the updated Uzbek alphabet never touches Turkish text", () => {
  const slide = { kind: "statement", title: "Çocuk eğitimi", eyebrow: "", lead: "Şehir okulları", points: [], stats: [], quote: null, chart: null, left: null, right: null, imageQuery: null };
  assert.equal(spellSlide(slide, "tr"), slide);
});
