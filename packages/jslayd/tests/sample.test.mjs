import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildJslayd } from "./build.mjs";

const dir = buildJslayd();
const { sampleBrief, samplePrompt, sampleSchema, readSample } = await import(`${dir}/sample.js`);
const { resolveBinding } = await import(`${dir}/content.js`);
const { buildWritingBrief, checkFit } = await import(`${dir}/budget.js`);

/**
 * Run against the real corpus, not against one hand-written slide.
 *
 * Fifteen designs and a hundred and thirty archetypes is where the shapes this
 * code has to survive actually live: parallel bullet columns, a stat card
 * beside a chart, a cover whose title box holds twenty characters. A fixture
 * written to suit the reader would agree with it by construction.
 */
const CORPUS = JSON.parse(readFileSync(new URL("./fixtures/design-corpus.json", import.meta.url), "utf8"));
const PAIRS = CORPUS.flatMap((document) => document.archetypes.map((archetype) => ({ document, archetype })));
assert.ok(PAIRS.length > 100, "the corpus is the point of this test");

const find = (predicate, what) => {
  const pair = PAIRS.find(({ document, archetype }) => predicate(sampleBrief(document, archetype), archetype));
  assert.ok(pair, `the corpus has no ${what}`);
  return pair;
};

/** The smallest box this binding is drawn in — the one the text must survive. */
const tightest = (document, archetype, binding) => Math.min(
  ...buildWritingBrief(document, archetype).slots
    .filter((slot) => slot.binding === binding)
    .map((slot) => slot.budget.maximumCharacters),
);

/**
 * An answer that respects every limit it was given.
 *
 * Sized per slot rather than one short word for all of them, because the corpus
 * has a statistics card whose value box holds four characters — and a fixture
 * that quietly overflows it would report the reader as broken when it is doing
 * exactly its job.
 */
const within = (slot) => "Qisqa matn namunasi".slice(0, Math.max(1, Math.min(9, slot.maxCharacters)));

const obedient = (brief) => {
  const answer = {};
  for (const slot of brief.slots) {
    answer[slot.binding] = slot.maxItems
      ? Array.from({ length: slot.maxItems }, () => within(slot))
      : within(slot);
  }
  if (brief.wantsImage) answer.image_query = "mountain lake sunrise";
  return answer;
};

/* ------------------------------------------------------------------ asking */

test("the brief asks only for what the design can draw", () => {
  for (const { document, archetype } of PAIRS) {
    const brief = sampleBrief(document, archetype);
    const asked = new Set();

    for (const slot of brief.slots) {
      assert.ok(slot.maxCharacters > 0, `${archetype.id}/${slot.binding} was given a box with no room`);
      assert.ok(slot.maxWords >= slot.idealWords, `${slot.binding} may not aim past its own maximum`);
      // A binding that always resolves to null would spend an answer on text
      // that cannot reach a slide.
      assert.ok(!["stat_2", "stat_3"].includes(slot.binding), `${slot.binding} is never drawn`);
      assert.ok(!asked.has(slot.binding), `${archetype.id} asked for ${slot.binding} twice`);
      asked.add(slot.binding);
    }
  }
});

test("a chart title and a title are one question, at the tighter budget", () => {
  const both = PAIRS.find(({ document, archetype }) => {
    const bindings = buildWritingBrief(document, archetype).slots.map((slot) => slot.binding);
    return bindings.includes("title") && bindings.some((b) => b === "chart_title" || b === "table_title");
  });
  if (!both) return; // Nothing in the corpus draws both; the merge is still covered below.

  const full = buildWritingBrief(both.document, both.archetype).slots
    .filter((slot) => ["title", "chart_title", "table_title"].includes(slot.binding));
  const merged = sampleBrief(both.document, both.archetype).slots
    .filter((slot) => ["title", "chart_title", "table_title"].includes(slot.binding));

  assert.equal(merged.length, 1, "one destination, one question");
  assert.equal(merged[0].maxCharacters, Math.min(...full.map((slot) => slot.budget.maximumCharacters)),
    "text sized for the wider box would overflow the narrower one");
});

test("the prompt names lengths and never geometry", () => {
  const { document, archetype } = find((brief) => brief.slots.length >= 3, "archetype with three slots");
  const brief = sampleBrief(document, archetype);
  const prompt = samplePrompt(brief, "Suvni tejash");

  assert.match(prompt, /Suvni tejash/);
  for (const slot of brief.slots) assert.ok(prompt.includes(slot.binding), `${slot.binding} was not asked for`);

  for (const leak of ["#", "px", "fontSize", "gradient", "rgba", "zIndex"]) {
    assert.ok(!prompt.includes(leak), `the prompt leaked layout: ${leak}`);
  }
});

test("the schema offers exactly the slots the brief asked for", () => {
  const { document, archetype } = find((brief) => brief.slots.some((slot) => slot.maxItems), "list slot");
  const brief = sampleBrief(document, archetype);
  const schema = sampleSchema(brief);

  const offered = Object.keys(schema.properties).filter((key) => !["image_query", "chart", "table"].includes(key));
  assert.deepEqual(offered.sort(), brief.slots.map((slot) => slot.binding).sort());

  const list = brief.slots.find((slot) => slot.maxItems);
  assert.equal(schema.properties[list.binding].type, "array");
  assert.equal(schema.properties[list.binding].maxItems, list.maxItems);
  assert.ok(schema.required.includes(list.binding));
});

/* ----------------------------------------------------------------- reading */

test("every answer that fits is readable back through the binding it was written for", () => {
  for (const { document, archetype } of PAIRS) {
    const brief = sampleBrief(document, archetype);
    const { slide, outcomes } = readSample(obedient(brief), document, archetype);

    for (const outcome of outcomes) {
      assert.ok(outcome.fits, `${archetype.id}/${outcome.binding} did not fit its own budget`);
      if (Array.isArray(outcome.text)) continue;
      assert.equal(
        resolveBinding(outcome.binding, slide),
        outcome.text,
        `${archetype.id}/${outcome.binding} was written but does not render`,
      );
    }
  }
});

test("what is kept always fits the box it was measured against", () => {
  const phrase = "Mamlakat iqtisodiyotini raqamlashtirish yo‘nalishidagi keng qamrovli islohotlar ";
  // Sized against each slot: the corpus has body boxes holding 350 characters,
  // and a fixed flood short enough for one of them proves nothing about it.
  const flood = (slot) => phrase.repeat(Math.ceil((slot.maxCharacters * 2) / phrase.length) + 1).trim();

  for (const { document, archetype } of PAIRS) {
    const brief = sampleBrief(document, archetype);
    const flooded = {};
    for (const slot of brief.slots) {
      flooded[slot.binding] = slot.maxItems
        ? Array.from({ length: slot.maxItems + 3 }, () => flood(slot))
        : flood(slot);
    }

    const { outcomes } = readSample(flooded, document, archetype);

    for (const outcome of outcomes) {
      assert.equal(outcome.fits, false, `${outcome.binding} claimed a flood of text fits`);
      // The tightest box, not the first one: a design that draws its section
      // label wide at the top and narrow in the corner has to satisfy both.
      const room = tightest(document, archetype, outcome.binding);
      for (const kept of [outcome.text].flat()) {
        assert.ok(kept.length <= room,
          `${archetype.id}/${outcome.binding} kept ${kept.length} of ${room}`);
        assert.ok(!kept.endsWith(" "), "a cut leaves no trailing space");
      }
    }
  }
});

test("an oversized answer is cut at a word boundary, keeping the opening", () => {
  const { document, archetype } = find((_, entry) =>
    buildWritingBrief(CORPUS.find((d) => d.archetypes.includes(entry)), entry)
      .slots.some((slot) => slot.binding === "title" && slot.budget.maximumCharacters > 25), "roomy title");

  const long = "Raqamli iqtisodiyot va yangi imkoniyatlar haqida uzun sarlavha matni";
  const brief = sampleBrief(document, archetype);
  const { slide, outcomes } = readSample({ ...obedient(brief), title: long }, document, archetype);

  const outcome = outcomes.find((entry) => entry.binding === "title");
  assert.equal(outcome.trimmedFrom, long.length);
  assert.ok(long.startsWith(slide.title), "the trim must keep the opening words");
  assert.equal(long[slide.title.length], " ", "the cut lands between words");

  const budget = buildWritingBrief(document, archetype).slots.find((slot) => slot.binding === "title");
  assert.ok(checkFit(budget, slide.title).fits, "what was kept must actually fit");
});

test("a list is capped at the number of items the design draws", () => {
  const { document, archetype } = find((brief) => brief.slots.some((slot) => slot.maxItems), "list slot");
  const brief = sampleBrief(document, archetype);
  const list = brief.slots.find((slot) => slot.maxItems);

  const many = Array.from({ length: list.maxItems + 4 }, (_, at) => `Nuqta ${at + 1}`);
  const { slide, outcomes } = readSample({ ...obedient(brief), [list.binding]: many }, document, archetype);

  assert.equal(slide.bullets.length, list.maxItems);
  assert.equal(outcomes.find((entry) => entry.binding === list.binding).trimmedFrom, many.length);
  assert.equal(slide.bullets[0], "Nuqta 1", "the first points are the ones kept");
});

test("column bindings fill the list in their own order", () => {
  /**
   * Built rather than found: `bullet_1..6` exist for decks imported from
   * PowerPoint, where a band of three peer text boxes is routine, and none of
   * the fifteen hand-authored designs uses them. Rebinding a real archetype's
   * own text boxes keeps the geometry honest — these are boxes the corpus
   * actually draws — while covering the shape the corpus does not have.
   */
  const source = find((brief) => brief.slots.filter((slot) => !slot.maxItems).length >= 3, "three text slots");
  const document = source.document;
  let column = 0;
  const archetype = {
    ...source.archetype,
    elements: source.archetype.elements.map((element) =>
      element.type === "text" && element.source?.bind && column < 3
        ? { ...element, source: { bind: `bullet_${++column}` } }
        : element),
  };

  const brief = sampleBrief(document, archetype);
  const columns = brief.slots.filter((slot) => /^bullet_\d$/.test(slot.binding));
  const answer = { ...obedient(brief) };
  for (const slot of columns) answer[slot.binding] = `Ustun ${slot.binding.slice(-1)}`;

  const { slide } = readSample(answer, document, archetype);
  for (const slot of columns) {
    const at = Number(slot.binding.slice("bullet_".length));
    assert.equal(slide.bullets[at - 1], `Ustun ${at}`, `${slot.binding} landed in the wrong column`);
    assert.equal(resolveBinding(slot.binding, slide), `Ustun ${at}`);
  }
});

test("a half-answered chart is dropped rather than drawn mislabelled", () => {
  const { document, archetype } = find(() => true, "archetype");
  const base = obedient(sampleBrief(document, archetype));

  const mismatched = readSample({ ...base, chart: { type: "bar", labels: ["A", "B", "C"], values: [1, 2] } }, document, archetype);
  assert.equal(mismatched.slide.chart, null, "three bars labelled by two names is not a chart");

  const good = readSample({ ...base, chart: { type: "pie", labels: ["A", "B"], values: [1, 2] } }, document, archetype);
  assert.deepEqual(good.slide.chart, { type: "pie", labels: ["A", "B"], values: [1, 2] });

  const odd = readSample({ ...base, chart: { type: "sunburst", labels: ["A", "B"], values: [1, 2] } }, document, archetype);
  assert.equal(odd.slide.chart.type, "bar", "an unknown type falls back rather than reaching the renderer");
});

test("a short table row is dropped rather than drawn under the wrong header", () => {
  const { document, archetype } = find(() => true, "archetype");
  const base = obedient(sampleBrief(document, archetype));
  const { slide } = readSample({
    ...base,
    table: { columns: ["Yil", "Foiz"], rows: [["2024", "12"], ["2025"]] },
  }, document, archetype);

  assert.deepEqual(slide.table, { columns: ["Yil", "Foiz"], rows: [["2024", "12"]] });
});

test("an image query is kept only where the design has somewhere to put a picture", () => {
  const withImage = find((brief) => brief.wantsImage, "design with an image slot");
  const without = find((brief) => !brief.wantsImage, "design without an image slot");

  const yes = readSample(
    { ...obedient(sampleBrief(withImage.document, withImage.archetype)), image_query: " city skyline " },
    withImage.document, withImage.archetype,
  );
  assert.equal(yes.imageQuery, "city skyline");

  const no = readSample(
    { ...obedient(sampleBrief(without.document, without.archetype)), image_query: "city skyline" },
    without.document, without.archetype,
  );
  assert.equal(no.imageQuery, null, "a design with no image slot must not send anyone searching");
});

test("a missing answer leaves the slide empty rather than inventing filler", () => {
  const { document, archetype } = find(() => true, "archetype");
  const { slide, outcomes } = readSample({}, document, archetype);

  assert.deepEqual(outcomes, []);
  assert.equal(slide.title, "");
  assert.deepEqual(slide.bullets, []);
  assert.equal(slide.quote, null);
  assert.equal(slide.statistic, null);
  assert.equal(slide.imageQuery, undefined, "the slide model has no such field to leak into");
});
