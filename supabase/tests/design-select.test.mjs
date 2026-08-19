import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { matchTopics, normalise, planStory, rankDesigns, selectPages } =
  await import(`${edge}/design-select.js`);

/**
 * Which design, and which of its pages.
 *
 * The failure being prevented is specific: a family of twenty-five pages,
 * composed as a sequence, reduced to ten by shape alone — five openings and no
 * ending. Everything here is about the sequence being visible to the chooser.
 */

const page = (id, overrides = {}) => ({
  archetypeId: id,
  role: overrides.role ?? "key_concepts",
  alternativeRoles: overrides.alternativeRoles ?? [],
  recommendedStoryPosition: overrides.recommendedStoryPosition ?? 6,
  layoutSignature: overrides.layoutSignature ?? id,
  isTerminal: overrides.isTerminal ?? false,
  supportsImage: overrides.supportsImage ?? false,
  supportsChart: overrides.supportsChart ?? false,
  supportsTable: overrides.supportsTable ?? false,
  supportsQuote: overrides.supportsQuote ?? false,
  supportsStats: overrides.supportsStats ?? false,
  minText: overrides.minText ?? 0,
  maxText: overrides.maxText ?? 4000,
});

const needs = (count, overrides = {}) =>
  Array.from({ length: count }, () => ({
    purpose: overrides.purpose ?? "title_content",
    textVolume: overrides.textVolume ?? 300,
    hasImage: overrides.hasImage ?? false,
  }));

/* ------------------------------------------------------------ normalising */

test("every Uzbek apostrophe collapses onto one spelling", () => {
  const spellings = ["o‘zbekiston", "oʻzbekiston", "o'zbekiston", "o`zbekiston", "ozbekiston"];
  const normalised = new Set(spellings.map(normalise));
  assert.equal(normalised.size, 1, [...normalised].join(" | "));
});

test("case and punctuation do not make two subjects out of one", () => {
  assert.equal(normalise("Kardiologiya, 2026!"), normalise("kardiologiya 2026"));
});

/* ----------------------------------------------------------------- topics */

const taxonomy = [
  { slug: "kardiologiya", label: "Kardiologiya", synonyms: ["yurak", "yurak kasalliklari"] },
  { slug: "biologiya", label: "Biologiya", synonyms: ["bio"] },
  { slug: "moliya", label: "Moliya", synonyms: ["budjet"] },
];

test("a subject named outright is found", () => {
  const found = matchTopics("Kardiologiya asoslari", taxonomy);
  assert.equal(found.get("kardiologiya"), 3);
});

test("a synonym counts for less than the subject's own name", () => {
  const own = matchTopics("kardiologiya", taxonomy).get("kardiologiya");
  const synonym = matchTopics("yurak kasalliklari haqida", taxonomy).get("kardiologiya");
  assert.ok(own > synonym, `${own} should beat ${synonym}`);
});

test("a word inside a longer word is not a match", () => {
  // `bio` must not claim a deck about a biography.
  assert.equal(matchTopics("Alisher Navoiy biografiyasi", taxonomy).has("biologiya"), false);
});

test("a two-letter synonym is ignored rather than matching everything", () => {
  const short = [{ slug: "it", label: "IT", synonyms: ["it"] }];
  assert.equal(matchTopics("it sohasi", short).size, 0);
});

test("nothing recognised is an empty answer, not a guess", () => {
  assert.equal(matchTopics("qandaydir mavzu", taxonomy).size, 0);
});

/* --------------------------------------------------------------- families */

test("a design claiming the subject strongly beats one claiming it weakly", () => {
  const wanted = new Map([["kardiologiya", 3]]);
  const ranked = rankDesigns([
    { id: "weak", slug: "w", keywords: [{ keyword: "kardiologiya", score: 40 }], pages: 10 },
    { id: "strong", slug: "s", keywords: [{ keyword: "kardiologiya", score: 100 }], pages: 10 },
  ], wanted);
  assert.equal(ranked[0].id, "strong");
});

test("a design claiming nothing still ranks, because a catalogue must answer", () => {
  const ranked = rankDesigns([{ id: "plain", slug: "p", keywords: [], pages: 12 }], new Map());
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].score > 0);
});

test("range counts for something, but never as much as suiting the subject", () => {
  const wanted = new Map([["moliya", 3]]);
  const ranked = rankDesigns([
    { id: "big", slug: "b", keywords: [], pages: 25 },
    { id: "right", slug: "r", keywords: [{ keyword: "moliya", score: 90 }], pages: 4 },
  ], wanted);
  assert.equal(ranked[0].id, "right");
});

test("the ranking does not depend on the order the catalogue came back in", () => {
  const wanted = new Map([["moliya", 2]]);
  const first = [
    { id: "a", slug: "a", keywords: [{ keyword: "moliya", score: 50 }], pages: 8 },
    { id: "b", slug: "b", keywords: [{ keyword: "moliya", score: 50 }], pages: 8 },
  ];
  assert.deepEqual(
    rankDesigns(first, wanted).map((entry) => entry.id),
    rankDesigns([...first].reverse(), wanted).map((entry) => entry.id),
  );
});

test("which topics matched is reported, so a choice can be explained", () => {
  const ranked = rankDesigns(
    [{ id: "a", slug: "a", keywords: [{ keyword: "moliya", score: 80 }, { keyword: "biologiya", score: 20 }], pages: 6 }],
    new Map([["moliya", 3]]),
  );
  assert.deepEqual(ranked[0].matched, ["moliya"]);
});

/* ------------------------------------------------------------------ story */

test("a deck opens and closes whatever its middle is", () => {
  const plan = planStory(["cover", "title_content", "title_content", "conclusion"]);
  assert.equal(plan[0], "welcome");
  assert.equal(plan[3], "conclusion");
});

test("a purpose that names its own job keeps it", () => {
  const plan = planStory(["cover", "quote", "chart", "thank_you"]);
  assert.deepEqual(plan, ["welcome", "quote", "chart", "thanks"]);
});

test("the middle of a long deck progresses instead of repeating one role", () => {
  const plan = planStory(["cover", ...Array(10).fill("title_content"), "conclusion"]);
  const middle = plan.slice(1, 11);
  assert.ok(new Set(middle).size >= 6, `only ${new Set(middle).size} distinct roles: ${middle.join(", ")}`);
});

test("a short deck takes the opening of the sequence rather than its end", () => {
  const plan = planStory(["cover", "title_content", "conclusion"]);
  assert.equal(plan[1], "introduction");
});

/* ------------------------------------------------------------------ pages */

test("a sign-off page is never scheduled in the middle", () => {
  const profiles = [
    page("thanks", { role: "thanks", isTerminal: true, recommendedStoryPosition: 999 }),
    page("body", { role: "key_concepts" }),
  ];
  const plan = planStory(["cover", "title_content", "title_content", "thank_you"]);
  const chosen = selectPages(profiles, plan, needs(4));
  assert.ok(!chosen.slice(0, 3).some((entry) => entry.archetypeId === "thanks"));
  assert.equal(chosen[3].archetypeId, "thanks");
});

test("the page whose role matches wins over one that merely can hold the text", () => {
  const profiles = [
    page("generic", { role: "key_concepts" }),
    page("quoted", { role: "quote", supportsQuote: true }),
  ];
  const chosen = selectPages(profiles, ["quote"], [{ purpose: "quote", textVolume: 200, hasImage: false }]);
  assert.equal(chosen[0].archetypeId, "quoted");
});

test("an alternative role is used when nothing claims the job outright", () => {
  const profiles = [
    page("far", { role: "thanks", isTerminal: true }),
    page("alt", { role: "analysis", alternativeRoles: ["comparison"] }),
  ];
  const chosen = selectPages(profiles, ["comparison"], needs(1));
  assert.equal(chosen[0].archetypeId, "alt");
  assert.equal(chosen[0].substituted, true);
});

test("the same composition is not used twice in a row when another exists", () => {
  const profiles = [
    page("a", { role: "key_concepts", layoutSignature: "left-right" }),
    page("b", { role: "key_concepts", layoutSignature: "stacked" }),
  ];
  const chosen = selectPages(profiles, ["key_concepts", "key_concepts"], needs(2));
  assert.notEqual(chosen[0].archetypeId, chosen[1].archetypeId);
});

test("a page composed for the end is not chosen for the start", () => {
  const profiles = [
    page("late", { role: "key_concepts", recommendedStoryPosition: 17, layoutSignature: "late" }),
    page("early", { role: "key_concepts", recommendedStoryPosition: 2, layoutSignature: "early" }),
  ];
  const chosen = selectPages(profiles, ["key_concepts", "key_concepts", "key_concepts"], needs(3));
  assert.equal(chosen[0].archetypeId, "early");
});

test("a slide with a picture prefers a page that has somewhere to put it", () => {
  const profiles = [
    page("plain", { role: "key_concepts", layoutSignature: "plain" }),
    page("pictured", { role: "key_concepts", supportsImage: true, layoutSignature: "pictured" }),
  ];
  const chosen = selectPages(profiles, ["key_concepts"], [{ purpose: "title_content", textVolume: 200, hasImage: true }]);
  assert.equal(chosen[0].archetypeId, "pictured");
});

test("a slide with no picture prefers a page that does not leave a hole", () => {
  const profiles = [
    page("plain", { role: "key_concepts", layoutSignature: "plain" }),
    page("pictured", { role: "key_concepts", supportsImage: true, layoutSignature: "pictured" }),
  ];
  const chosen = selectPages(profiles, ["key_concepts"], [{ purpose: "title_content", textVolume: 200, hasImage: false }]);
  assert.equal(chosen[0].archetypeId, "plain");
});

test("a deck always gets a page for every slide, even with one page to give", () => {
  const chosen = selectPages([page("only")], planStory(["cover", "title_content", "conclusion"]), needs(3));
  assert.equal(chosen.length, 3);
  assert.ok(chosen.every((entry) => entry.archetypeId === "only"));
});

test("no pages at all is an empty answer rather than a throw", () => {
  assert.deepEqual(selectPages([], ["welcome"], needs(1)), []);
});

test("the same inputs choose the same pages every time", () => {
  const profiles = [page("a", { layoutSignature: "s" }), page("b", { layoutSignature: "s" }), page("c")];
  const plan = planStory(["cover", "title_content", "title_content", "conclusion"]);
  const first = selectPages(profiles, plan, needs(4)).map((entry) => entry.archetypeId);
  const second = selectPages([...profiles].reverse(), plan, needs(4)).map((entry) => entry.archetypeId);
  assert.deepEqual(first, second);
});

test("a family of many pages does not spend a deck on one of them", () => {
  const profiles = Array.from({ length: 12 }, (_, index) =>
    page(`p${index}`, { role: "key_concepts", layoutSignature: `sig${index}` }));
  const plan = planStory(["cover", ...Array(8).fill("title_content"), "conclusion"]);
  const chosen = selectPages(profiles, plan, needs(10));
  assert.ok(new Set(chosen.map((entry) => entry.archetypeId)).size >= 6);
});
