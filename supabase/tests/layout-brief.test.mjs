import assert from "node:assert/strict";
import test from "node:test";

import { buildJslayd } from "../../packages/jslayd/tests/build.mjs";

const pkg = buildJslayd();
const { compile } = await import(`${pkg}/compile.js`);
const { SAMPLE_PROMPT } = await import(`${pkg}/standard.js`);
const { buildWritingBrief, planArchetypes, purposeForLayout } = await import(`${pkg}/index.js`);

const { document: DOCUMENT, diagnostics } = compile(SAMPLE_PROMPT);
assert.deepEqual(diagnostics.errors, [], "the sample design must compile");

/**
 * The bridge between a design's geometry and the model that writes into it.
 *
 * These tests run against the package rather than the Edge copy of the bridge:
 * `layout-brief.ts` imports the Supabase-side JSLAYD runtime, which no Node
 * toolchain here can load. What is worth testing is the arithmetic — which
 * archetype gets chosen, and how big the payload is — and that is the package's.
 */

const LAYOUTS = [
  "title_body", "statistic", "chart", "quote", "comparison",
  "timeline", "table", "two_columns", "conclusion", "title_body",
  "statistic", "title_body",
];

function planDeck(layouts) {
  return planArchetypes(
    DOCUMENT,
    layouts.map((layout) => {
      const purpose = purposeForLayout(layout);
      return {
        purpose,
        needsChart: purpose === "chart",
        needsTable: purpose === "table",
        needsStats: purpose === "statistics",
        needsQuote: purpose === "quote",
      };
    }),
  );
}

test("an archetype is chosen for every slide before a word is written", () => {
  const chosen = planDeck(LAYOUTS);
  assert.equal(chosen.length, LAYOUTS.length);
  for (const selection of chosen) {
    assert.ok(selection.archetype.id, "every slide gets a composition");
  }
});

test("planning does not need the copy, which is the point", () => {
  // `selectArchetypes` gates on how much text a slide carries — right at render
  // time and impossible at planning time, when the whole reason to choose early
  // is to know how much to write.
  assert.doesNotThrow(() => planDeck(["title_body"]));
});

test("a chart slide lands somewhere that can draw a chart", () => {
  const [selection] = planDeck(["chart"]);
  assert.ok(
    selection.archetype.selection.supportsChart || selection.substituted,
    "either it draws charts, or the design has none and said so",
  );
});

test("the same layout twelve times does not produce the same slide twelve times", () => {
  // A deck of identical compositions is the failure §17 of the brief names:
  // card, card, card, card. The chooser prefers the least-used variant, so a
  // design carrying several of one purpose rotates through them.
  const chosen = planDeck(Array.from({ length: 12 }, () => "title_body"));
  const distinct = new Set(chosen.map((selection) => selection.archetype.id));
  const available = DOCUMENT.archetypes.filter(
    (archetype) => archetype.purpose === purposeForLayout("title_body"),
  ).length;

  if (available > 1) {
    assert.ok(distinct.size > 1, `the design has ${available} of that purpose and used ${distinct.size}`);
  }
});

test("planning is deterministic — two runs lay out a deck identically", () => {
  const first = planDeck(LAYOUTS).map((selection) => selection.archetype.id);
  const second = planDeck(LAYOUTS).map((selection) => selection.archetype.id);
  assert.deepEqual(first, second);
});

/* ------------------------------------------------------------- token cost */

test("a twelve-slide deck's layout payload stays a few kilobytes", () => {
  // §17: the failure to avoid is resending the whole design for every slide.
  // Slides sharing an archetype share its brief, so the payload grows with the
  // number of distinct compositions rather than with the number of slides.
  const chosen = planDeck(LAYOUTS);
  const distinct = new Map();
  for (const selection of chosen) {
    if (!distinct.has(selection.archetype.id)) {
      distinct.set(selection.archetype.id, buildWritingBrief(DOCUMENT, selection.archetype));
    }
  }

  const trimmed = [...distinct.values()].map((brief) => ({
    archetype: brief.archetypeId,
    purpose: brief.purpose,
    slots: brief.slots.map((slot) => ({
      id: slot.elementId, field: slot.binding, role: slot.role,
      box: `${slot.geometry.width}×${slot.geometry.height}`,
      fontSize: slot.typography.fontSize,
      maxLines: slot.typography.maxLines ?? slot.budget.estimatedLines,
      charsPerLine: slot.budget.estimatedCharactersPerLine,
      aim: slot.budget.preferredCharacters,
      limit: slot.budget.maximumCharacters,
    })),
  }));

  const payload = JSON.stringify(trimmed).length;
  const wholeDesign = JSON.stringify(DOCUMENT).length;

  assert.ok(payload < 12_000, `a deck's layout brief should stay small, got ${payload} bytes`);
  assert.ok(
    payload < wholeDesign / 4,
    `sending briefs must beat sending the design (${payload} vs ${wholeDesign})`,
  );

  // The number that actually matters: what resending the document per slide
  // would have cost against what this costs once.
  const naive = wholeDesign * LAYOUTS.length;
  assert.ok(payload < naive / 50, `saving should be an order of magnitude (${payload} vs ${naive})`);
});

test("the payload carries no colours, fonts or other archetypes", () => {
  // Everything a writer cannot act on is tokens spent on every slide of every
  // deck, and colour is the design's business in any case.
  const [selection] = planDeck(["title_body"]);
  const brief = buildWritingBrief(DOCUMENT, selection.archetype);
  const text = JSON.stringify(brief);

  assert.equal(/#[0-9a-f]{6}/i.test(text), false, "no hex colours reach the writer");
  assert.equal(text.includes("colorFamilies"), false);
  assert.equal(text.includes("archetypes"), false, "one archetype, not the catalogue");
});
