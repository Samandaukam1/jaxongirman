import assert from "node:assert/strict";
import test from "node:test";

import { buildJslayd } from "../../packages/jslayd/tests/build.mjs";
import { buildEdgeModules } from "../scripts/build-edge.mjs";

const pkg = buildJslayd();
const edge = buildEdgeModules();
const { compile } = await import(`${pkg}/compile.js`);
const { SAMPLE_PROMPT } = await import(`${pkg}/standard.js`);
const { buildWritingBrief, planArchetypes, purposeForLayout } = await import(`${pkg}/index.js`);
const { adaptContentToBrief, findSlotProblems } = await import(`${edge}/layout-brief.js`);

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

/* ----------------------------------------------------------- two-way fit */

const BODY_BRIEF = {
  archetypeId: "body-test", purpose: "title_content", canvas: { width: 1920, height: 1080 },
  visualZones: [], slots: [{
    elementId: "body", binding: "body", role: "body", priority: 2,
    geometry: { x: 100, y: 300, width: 1200, height: 500 },
    typography: {
      font: "font_1", fontSize: 32, fontWeight: 400, lineHeight: 1.2,
      letterSpacing: 0, align: "left", verticalAlign: "top", transform: "none",
      maxLines: 12, minFontSize: 24, overflow: "shrink",
    },
    budget: {
      minimumCharacters: 75, preferredCharacters: 100, maximumCharacters: 140,
      minimumWords: 11, preferredWords: 15, maximumWords: 21,
      estimatedCharactersPerLine: 24, estimatedLines: 12,
    },
  }],
};

const semanticFor = (brief, text) => {
  const slot = brief.slots[0];
  return {
    slide: {
      title: "Aniq sarlavha", subtitle: null, purpose: "Sinov", layout: "title_body",
      bullets: slot.binding === "bullets" && text ? [text] : [],
      body: slot.binding === "body" ? text : null,
      quote: null, statistic: null, chart: null, table: null, visualPrompt: null,
    },
    slot,
  };
};

const words = (characters) => "Mazmunli fikr sabab va natija bilan tushuntiriladi. ".repeat(Math.ceil(characters / 52)).slice(0, characters);

test("short body copy is sent to the expansion path", () => {
  const brief = BODY_BRIEF;
  const sample = semanticFor(brief, "Qisqa fikr.");
  const problem = findSlotProblems(brief, sample.slide).find((entry) => entry.binding === sample.slot.binding);
  assert.equal(problem?.direction, "expand");
  assert.ok(problem?.shortBy > 0);
});

test("an empty content page requests exactly one fill", () => {
  const brief = BODY_BRIEF;
  const empty = semanticFor(brief, "").slide;
  const problems = findSlotProblems(brief, empty).filter((entry) => entry.direction === "expand");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].text, "");
});

test("bullets are preserved inside a body-only composition", () => {
  const slide = semanticFor(BODY_BRIEF, "Qisqa kirish.").slide;
  slide.bullets = ["Birinchi dalil", "Ikkinchi natija"];
  const adapted = adaptContentToBrief(slide, BODY_BRIEF);
  assert.equal(adapted.bullets.length, 0);
  assert.match(adapted.body, /Qisqa kirish\. Birinchi dalil\. Ikkinchi natija\./);
});

test("body copy is preserved inside a bullets-only composition", () => {
  const bulletsBrief = {
    ...BODY_BRIEF,
    slots: BODY_BRIEF.slots.map((slot) => ({ ...slot, binding: "bullets", role: "bullets" })),
  };
  const slide = semanticFor(BODY_BRIEF, "Birinchi izoh. Ikkinchi izoh.").slide;
  slide.bullets = ["Mavjud band"];
  const adapted = adaptContentToBrief(slide, bulletsBrief);
  assert.equal(adapted.body, null);
  assert.deepEqual(adapted.bullets, ["Mavjud band", "Birinchi izoh.", "Ikkinchi izoh."]);
});

test("overlong body copy is sent to the shortening path", () => {
  const brief = BODY_BRIEF;
  const base = semanticFor(brief, "");
  const sample = semanticFor(brief, words(base.slot.budget.maximumCharacters + 120));
  const problem = findSlotProblems(brief, sample.slide).find((entry) => entry.binding === sample.slot.binding);
  assert.equal(problem?.direction, "shorten");
  assert.ok(problem?.overBy > 0);
});

test("normal body copy needs no rewrite", () => {
  const brief = BODY_BRIEF;
  const base = semanticFor(brief, "");
  const sample = semanticFor(brief, words(base.slot.budget.preferredCharacters));
  assert.equal(findSlotProblems(brief, sample.slide).some((entry) => entry.binding === base.slot.binding), false);
});

test("a section-only page is not treated as a silent content page", () => {
  const titleOnly = {
    archetypeId: "section-only", purpose: "section", canvas: { width: 1920, height: 1080 },
    visualZones: [], slots: [{
      elementId: "heading", binding: "title", role: "title",
      geometry: { x: 100, y: 100, width: 1200, height: 200 },
      typography: { fontSize: 80, lineHeight: 1.1, maxLines: 2 },
      budget: {
        minimumCharacters: 0, preferredCharacters: 40, maximumCharacters: 80,
        minimumWords: 0, preferredWords: 6, maximumWords: 12,
        estimatedCharactersPerLine: 20, estimatedLines: 2,
      },
    }],
  };
  const slide = {
    title: "Bo‘lim", subtitle: null, purpose: "Ajratish", layout: "title_body",
    bullets: [], body: null, quote: null, statistic: null, chart: null, table: null, visualPrompt: null,
  };
  assert.deepEqual(findSlotProblems(titleOnly, slide), []);
});
