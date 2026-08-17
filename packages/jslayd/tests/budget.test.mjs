import assert from "node:assert/strict";
import test from "node:test";

import { buildJslayd } from "./build.mjs";

const dir = buildJslayd();
const { compile } = await import(`${dir}/compile.js`);
const { SAMPLE_PROMPT } = await import(`${dir}/standard.js`);
const { buildWritingBrief, checkFit } = await import(`${dir}/budget.js`);
const { characterCapacity } = await import(`${dir}/text-metrics.js`);

const { document: DOCUMENT, diagnostics } = compile(SAMPLE_PROMPT);
assert.deepEqual(diagnostics.errors, [], "the sample design must compile");

const briefFor = (purpose, language = "uz") => {
  const archetype = DOCUMENT.archetypes.find((entry) => entry.purpose === purpose);
  assert.ok(archetype, `the sample design draws a ${purpose} slide`);
  return buildWritingBrief(DOCUMENT, archetype, { language });
};

const slotOf = (brief, role) => brief.slots.find((slot) => slot.role === role);

/* ------------------------------------------------------------------ shape */

test("a brief carries the archetype's geometry, not a copy of the design", () => {
  const brief = briefFor("cover");
  assert.equal(brief.canvas.width, DOCUMENT.design.canvas.width);
  assert.ok(brief.slots.length > 0, "a cover has copy to write");

  for (const slot of brief.slots) {
    assert.ok(slot.geometry.width > 0 && slot.geometry.height > 0, `${slot.elementId} has a box`);
    assert.ok(slot.typography.fontSize > 0, `${slot.elementId} says what size it is set at`);
    assert.equal(typeof slot.binding, "string");
  }
});

test("the brief is small enough to send once per slide", () => {
  // The whole point of a brief rather than the document: a writer gets this
  // slide's boxes, not the other twelve archetypes and every colour family.
  const brief = briefFor("cover");
  const briefBytes = JSON.stringify(brief).length;
  const documentBytes = JSON.stringify(DOCUMENT).length;

  assert.ok(briefBytes < 4000, `a slide brief should stay a few KB, got ${briefBytes}`);
  assert.ok(
    briefBytes < documentBytes / 8,
    `sending the brief must be far cheaper than the document (${briefBytes} vs ${documentBytes})`,
  );
});

/* ------------------------------------------------------------------ roles */

test("a slot's role comes from its binding, never from its element id", () => {
  const brief = briefFor("cover");
  const title = slotOf(brief, "title");
  assert.ok(title, "a cover has a title");
  assert.equal(title.binding, "title");

  // The sample design calls its eyebrow `eyebrow`, but the role is read from
  // `section_label` — an id is whatever the designer typed.
  const eyebrow = brief.slots.find((slot) => slot.binding === "section_label");
  if (eyebrow) assert.equal(eyebrow.role, "eyebrow");
});

test("facts the server already holds are not offered as slots", () => {
  // A model asked to fill an author field will invent an author.
  for (const purpose of DOCUMENT.archetypes.map((entry) => entry.purpose)) {
    const brief = buildWritingBrief(
      DOCUMENT,
      DOCUMENT.archetypes.find((entry) => entry.purpose === purpose),
    );
    for (const slot of brief.slots) {
      assert.ok(
        !["author", "teacher", "date", "brand", "page_number", "slide_count", "sources"].includes(slot.binding),
        `${slot.binding} is the server's to fill, not a writer's`,
      );
    }
  }
});

test("literal copy is left alone", () => {
  // A fixed label is the designer's own words. Offering it as a slot invites a
  // rewrite of something that was decided on purpose.
  const ids = new Set();
  for (const archetype of DOCUMENT.archetypes) {
    for (const slot of buildWritingBrief(DOCUMENT, archetype).slots) ids.add(slot.elementId);
  }
  for (const archetype of DOCUMENT.archetypes) {
    for (const element of archetype.elements) {
      if (element.type === "text" && element.source && "literal" in element.source) {
        assert.ok(!ids.has(element.id), `${element.id} holds literal copy and must not be a slot`);
      }
    }
  }
});

/* ----------------------------------------------------------------- budget */

test("preferred is below maximum, and maximum is below what the box holds", () => {
  for (const archetype of DOCUMENT.archetypes) {
    const brief = buildWritingBrief(DOCUMENT, archetype);
    for (const slot of brief.slots) {
      const raw = characterCapacity(slot.geometry.width, slot.geometry.height, {
        fontSize: slot.typography.fontSize,
        lineHeight: slot.typography.lineHeight,
        maxLines: slot.typography.maxLines,
      });
      assert.ok(slot.budget.preferredCharacters > 0, `${slot.elementId}: a slot with no budget cannot be written for`);
      assert.ok(
        slot.budget.preferredCharacters <= slot.budget.maximumCharacters,
        `${slot.elementId}: preferred must not exceed maximum`,
      );
      // Whitespace is a design element, and this is where it is defended: a
      // writer told it may use the whole box will use the whole box.
      assert.ok(
        slot.budget.maximumCharacters <= raw,
        `${slot.elementId}: the budget must stay inside the estimate (${slot.budget.maximumCharacters} of ${raw})`,
      );
      assert.ok(slot.budget.preferredWords <= slot.budget.maximumWords);
    }
  }
});

test("a bigger box buys more copy, a bigger typeface buys less", () => {
  const archetype = DOCUMENT.archetypes.find((entry) => entry.purpose === "cover");
  const base = slotOf(buildWritingBrief(DOCUMENT, archetype), "title");
  assert.ok(base, "the cover has a title to measure");

  const widen = structuredClone(archetype);
  const enlarge = structuredClone(archetype);
  for (const element of widen.elements) {
    if (element.type === "text" && element.source?.bind === "title") element.geometry.width *= 2;
  }
  for (const element of enlarge.elements) {
    if (element.type === "text" && element.source?.bind === "title") element.text.fontSize *= 2;
  }

  const wider = slotOf(buildWritingBrief(DOCUMENT, widen), "title");
  const larger = slotOf(buildWritingBrief(DOCUMENT, enlarge), "title");

  assert.ok(wider.budget.maximumCharacters > base.budget.maximumCharacters, "a wider box holds more");
  assert.ok(larger.budget.maximumCharacters < base.budget.maximumCharacters, "bigger type holds less");
});

test("maxLines caps the budget even when the box is tall", () => {
  const archetype = structuredClone(DOCUMENT.archetypes.find((entry) => entry.purpose === "cover"));
  for (const element of archetype.elements) {
    if (element.type === "text" && element.source?.bind === "title") {
      element.geometry.height *= 4;
      element.text.maxLines = 1;
    }
  }
  const slot = slotOf(buildWritingBrief(DOCUMENT, archetype), "title");
  assert.equal(slot.budget.estimatedLines, 1, "a one-line title stays one line however tall the box is");
  assert.ok(
    slot.budget.maximumCharacters <= slot.budget.estimatedCharactersPerLine,
    "and its budget is one line's worth of characters",
  );
});

test("Uzbek is given a smaller budget than English for the same box", () => {
  // Agglutination: one English preposition becomes a suffix, so the same
  // meaning runs longer. A budget written for English does not fit in Uzbek.
  const archetype = DOCUMENT.archetypes.find((entry) => entry.purpose === "cover");
  const uz = slotOf(buildWritingBrief(DOCUMENT, archetype, { language: "uz" }), "title");
  const en = slotOf(buildWritingBrief(DOCUMENT, archetype, { language: "en" }), "title");

  assert.ok(uz.budget.maximumCharacters < en.budget.maximumCharacters,
    "the same box asks for less Uzbek than English");
  assert.ok(uz.budget.preferredWords <= en.budget.preferredWords,
    "and fewer words, because Uzbek words are longer");
});

/* -------------------------------------------------------------------- fit */

test("copy inside its budget fits", () => {
  // The sample's cover title is set at 148px in an 1100px box: about fourteen
  // characters to a line. A hero title there is two or three words, and the
  // budget saying so is the design speaking, not a limitation.
  const title = slotOf(briefFor("cover"), "title");
  const fit = checkFit(title, "Yangi intellekt");
  assert.equal(fit.fits, true);
  assert.equal(fit.overBy, 0);
});

test("a long Uzbek title is caught before anything is rendered", () => {
  const title = slotOf(briefFor("cover"), "title");
  const long = "Sun'iy intellekt texnologiyalarining zamonaviy ta'lim tizimida qo'llanilishi va uning kelajakdagi istiqbollari";
  const fit = checkFit(title, long);

  assert.equal(fit.fits, false, "this is the sentence that used to reach the renderer and get shrunk");
  assert.ok(fit.overBy > 0, "and the caller is told by how much, so it can ask for that much less");
});

test("a long English title is caught too", () => {
  const title = slotOf(briefFor("cover", "en"), "title");
  const long = "The Application of Artificial Intelligence Technologies in Contemporary Educational Systems and Their Future Prospects";
  assert.equal(checkFit(title, long).fits, false);
});

test("a last line holding one short word is refused", () => {
  // "YANGI TEXNOLOGIYALAR VA\nSUN'IY\nINTELLEKT" — the orphan that reads as a
  // mistake rather than as a line break somebody chose.
  const title = slotOf(briefFor("cover"), "title");
  const fit = checkFit(title, "Ta'limning yangi\nAI");
  assert.equal(fit.orphan, true);
  assert.equal(fit.fits, false, "an orphan is not a fit, however few characters it is");
});

test("a deliberate two-line break is honoured, not punished", () => {
  const title = slotOf(briefFor("cover"), "title");
  const fit = checkFit(title, "Kam vaqt\nKo'p natija");
  assert.equal(fit.orphan, false, "both lines carry weight");
  assert.equal(fit.lines, 2);
  assert.equal(fit.fits, true, "a break the writer chose is not an overflow");
});

test("more lines than the design allows does not fit, however short the copy", () => {
  const title = slotOf(briefFor("cover"), "title");
  const many = "Bir\nIkki\nUch\nTo'rt\nBesh\nOlti\nYetti\nSakkiz";
  const fit = checkFit(title, many);
  assert.ok(fit.lines > (fit.maximumLines ?? 0));
  assert.equal(fit.fits, false);
});
