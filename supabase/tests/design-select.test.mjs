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

test("a catalogue that did not count pages does not rank every design last", () => {
  const wanted = new Map([["moliya", 3]]);
  const ranked = rankDesigns([
    { id: "counted", slug: "c", keywords: [{ keyword: "moliya", score: 60 }], pages: 12 },
    { id: "uncounted", slug: "u", keywords: [{ keyword: "moliya", score: 60 }], pages: 0 },
  ], wanted);
  // Within a point of each other: the difference must be the subject, not the
  // caller's choice of columns.
  assert.ok(Math.abs(ranked[0].score - ranked[1].score) <= 1);
});

/* ---------------------------------------------- the plan the writer is given */

const { planDeckLayout } = await import(`${edge}/layout-brief.js`);

/** The smallest document that can be planned against. */
function document(archetypes) {
  return {
    format: "JSLAYD", version: "1.0", kind: "design",
    design: { name: "T", slug: "t", tier: "great", description: "", premium: false, canvas: { width: 1000, height: 562.5 } },
    colors: {
      background: "#fff", surface: "#eee", surfaceAlt: "#ddd", contrast: "#111", primary: "#123456",
      secondary: "#345678", accent: "#ff0000", text: "#111", textSecondary: "#555",
      textOnPrimary: "#fff", textOnAccent: "#fff", textOnContrast: "#fff", muted: "#888", border: "#ccc",
    },
    colorFamilies: [], chartPalette: ["#123456"],
    fonts: [{ id: "font_1", name: "Inter", roles: ["display", "heading", "subheading", "body", "caption", "number", "quote"], family: "t-font_1", fallback: "Inter", faces: [] }],
    visualDNA: {
      rotationRange: { min: 0, max: 0 }, cornerRadiusFamily: [0], shadowFamily: [],
      spacingScale: [8], titleScale: { min: 30, max: 48 }, bodyScale: { min: 14, max: 20 },
      imageTreatment: "abstract", decorationDensity: "low",
    },
    archetypes,
  };
}

const archetype = (id, purpose) => ({
  id,
  purpose,
  background: { role: "background" },
  selection: { minText: 0, maxText: 4000, supportsImage: false, supportsChart: false, supportsTable: false, supportsStats: false, supportsQuote: false, priority: 50 },
  elements: [{
    type: "text", id: `${id}_title`, geometry: { x: 60, y: 60, width: 800, height: 120, rotation: 0, zIndex: 0, anchor: "top-left" },
    when: "always", opacity: 1, grow: false, source: { bind: "title" },
    text: {
      font: "font_1", fontSize: 40, fontWeight: 700, fontStyle: "normal", letterSpacing: 0, lineHeight: 1.2,
      align: "left", verticalAlign: "top", transform: "none", color: { role: "text" }, maxLines: 2,
      overflow: "shrink", minFontSize: 24, effect: "none", shadows: [], strokeWidth: 0,
      strokeColor: null, highlight: null, gradient: null, blur: 0,
    },
    background: null, corners: null, border: null, padding: 0,
  }],
});

test("without profiles the planner chooses by shape, as it always has", () => {
  const plan = planDeckLayout(document([archetype("a", "cover"), archetype("b", "title_content")]), [
    { layout: "cover", title: "T", purpose: "x" },
    { layout: "title_body", title: "U", purpose: "y" },
  ]);
  assert.equal(plan.slides.length, 2);
  assert.equal(plan.slides[0].role, undefined);
});

test("with profiles the writer is told what each slide is doing", () => {
  const doc = document([archetype("a", "cover"), archetype("b", "title_content"), archetype("z", "thank_you")]);
  const profiles = [
    { archetypeId: "a", role: "welcome", alternativeRoles: [], recommendedStoryPosition: 1, layoutSignature: "cover", isTerminal: false, supportsImage: false, supportsChart: false, supportsTable: false, supportsQuote: false, supportsStats: false, minText: 0, maxText: 4000 },
    { archetypeId: "b", role: "key_concepts", alternativeRoles: ["analysis"], recommendedStoryPosition: 6, layoutSignature: "body", isTerminal: false, supportsImage: false, supportsChart: false, supportsTable: false, supportsQuote: false, supportsStats: false, minText: 0, maxText: 4000 },
    { archetypeId: "z", role: "thanks", alternativeRoles: [], recommendedStoryPosition: 999, layoutSignature: "end", isTerminal: true, supportsImage: false, supportsChart: false, supportsTable: false, supportsQuote: false, supportsStats: false, minText: 0, maxText: 4000 },
  ];
  const plan = planDeckLayout(doc, [
    { layout: "cover", title: "T", purpose: "x" },
    { layout: "title_body", title: "U", purpose: "y" },
    { layout: "thanks", title: "V", purpose: "z" },
  ], { profiles });

  assert.equal(plan.slides[0].role, "welcome");
  assert.equal(plan.slides[2].role, "thanks");
  // And the sign-off page is only used for the sign-off.
  assert.equal(plan.slides[2].archetypeId, "z");
  assert.notEqual(plan.slides[1].archetypeId, "z");
});

test("a brief is built for every archetype the plan actually uses", () => {
  const doc = document([archetype("a", "cover"), archetype("b", "title_content")]);
  const profiles = [
    { archetypeId: "a", role: "welcome", alternativeRoles: [], recommendedStoryPosition: 1, layoutSignature: "cover", isTerminal: false, supportsImage: false, supportsChart: false, supportsTable: false, supportsQuote: false, supportsStats: false, minText: 0, maxText: 4000 },
    { archetypeId: "b", role: "key_concepts", alternativeRoles: [], recommendedStoryPosition: 6, layoutSignature: "body", isTerminal: false, supportsImage: false, supportsChart: false, supportsTable: false, supportsQuote: false, supportsStats: false, minText: 0, maxText: 4000 },
  ];
  const plan = planDeckLayout(doc, [
    { layout: "cover", title: "T", purpose: "x" },
    { layout: "title_body", title: "U", purpose: "y" },
  ], { profiles });

  const used = new Set(plan.slides.map((slide) => slide.archetypeId));
  for (const id of used) {
    assert.ok(plan.briefs.some((brief) => brief.archetypeId === id), `no brief for ${id}`);
  }
});

test("a profile naming a page the document lost does not lose the slide", () => {
  const doc = document([archetype("a", "cover")]);
  const profiles = [
    { archetypeId: "gone", role: "key_concepts", alternativeRoles: [], recommendedStoryPosition: 6, layoutSignature: "x", isTerminal: false, supportsImage: false, supportsChart: false, supportsTable: false, supportsQuote: false, supportsStats: false, minText: 0, maxText: 4000 },
  ];
  const plan = planDeckLayout(doc, [{ layout: "title_body", title: "U", purpose: "y" }], { profiles });
  assert.equal(plan.slides.length, 1);
  assert.equal(plan.slides[0].archetypeId, "a");
});

/* ---------------------------------------- when the copy still will not fit */

const { reseatOverflowing } = await import(`${edge}/layout-brief.js`);

/** An archetype whose title box is a given size, so overflow is controllable. */
function sized(id, purpose, width, height, fontSize = 40) {
  const base = archetype(id, purpose);
  return {
    ...base,
    elements: [{
      ...base.elements[0],
      geometry: { ...base.elements[0].geometry, width, height },
      text: { ...base.elements[0].text, fontSize, maxLines: Math.max(1, Math.floor(height / (fontSize * 1.2))) },
    }],
  };
}

const profile = (id, role, overrides = {}) => ({
  archetypeId: id, role, alternativeRoles: [], recommendedStoryPosition: 6,
  layoutSignature: id, isTerminal: overrides.isTerminal ?? false,
  supportsImage: false, supportsChart: false, supportsTable: false,
  supportsQuote: false, supportsStats: false, minText: 0, maxText: 4000,
});

const longTitle = "Kardiologiyada zamonaviy diagnostika usullari va ularning amaliy natijalari haqida batafsil";

test("a slide that overflows is moved to a page that holds it", () => {
  const doc = document([sized("tight", "title_content", 260, 60), sized("roomy", "title_content", 900, 260, 28)]);
  const plan = planDeckLayout(doc, [{ layout: "title_body", title: longTitle, purpose: "p" }]);
  plan.slides[0].archetypeId = "tight";

  const written = new Map([[0, { title: longTitle, subtitle: null, body: null, bullets: [], purpose: "p", layout: "title_body" }]]);
  const moved = reseatOverflowing(doc, plan, written);

  assert.equal(moved.reseats.length, 1);
  assert.equal(moved.reseats[0].to, "roomy");
  // The plan itself is what the renderer is handed, so the move must land there.
  assert.equal(plan.slides[0].archetypeId, "roomy");
});

test("a slide that already fits is left where it is", () => {
  const doc = document([sized("roomy", "title_content", 900, 260, 28), sized("other", "title_content", 900, 300, 28)]);
  const plan = planDeckLayout(doc, [{ layout: "title_body", title: "Qisqa", purpose: "p" }]);
  const before = plan.slides[0].archetypeId;
  const written = new Map([[0, { title: "Qisqa", subtitle: null, body: null, bullets: [], purpose: "p", layout: "title_body" }]]);

  assert.deepEqual(reseatOverflowing(doc, plan, written).reseats, []);
  assert.equal(plan.slides[0].archetypeId, before);
});

test("nothing moves when every other page is worse", () => {
  const doc = document([sized("tight", "title_content", 260, 60), sized("tighter", "title_content", 160, 40)]);
  const plan = planDeckLayout(doc, [{ layout: "title_body", title: longTitle, purpose: "p" }]);
  plan.slides[0].archetypeId = "tight";
  const written = new Map([[0, { title: longTitle, subtitle: null, body: null, bullets: [], purpose: "p", layout: "title_body" }]]);

  assert.deepEqual(reseatOverflowing(doc, plan, written).reseats, []);
  assert.equal(plan.slides[0].archetypeId, "tight");
});

test("a page doing the same job wins over a merely roomier one", () => {
  const doc = document([
    sized("tight", "title_content", 260, 60),
    sized("same_job", "title_content", 880, 240, 28),
    sized("huge", "title_content", 960, 400, 22),
  ]);
  const plan = planDeckLayout(doc, [{ layout: "title_body", title: longTitle, purpose: "p" }]);
  plan.slides[0].archetypeId = "tight";
  plan.slides[0].role = "analysis";
  const written = new Map([[0, { title: longTitle, subtitle: null, body: null, bullets: [], purpose: "p", layout: "title_body" }]]);

  const moved = reseatOverflowing(doc, plan, written, {
    profiles: [profile("tight", "analysis"), profile("same_job", "analysis"), profile("huge", "thanks")],
  });
  assert.equal(moved.reseats[0].to, "same_job");
});

test("the page that closes a deck is not taken for a slide in the middle", () => {
  const doc = document([sized("tight", "title_content", 260, 60), sized("closing", "thank_you", 940, 380, 24)]);
  const plan = planDeckLayout(doc, [
    { layout: "title_body", title: longTitle, purpose: "p" },
    { layout: "title_body", title: "Qisqa", purpose: "q" },
  ]);
  plan.slides[0].archetypeId = "tight";
  plan.slides[1].archetypeId = "tight";
  const written = new Map([
    [0, { title: longTitle, subtitle: null, body: null, bullets: [], purpose: "p", layout: "title_body" }],
    [1, { title: "Qisqa", subtitle: null, body: null, bullets: [], purpose: "q", layout: "title_body" }],
  ]);

  const moved = reseatOverflowing(doc, plan, written, { profiles: [profile("closing", "thanks", { isTerminal: true })] });
  assert.ok(!moved.reseats.some((entry) => entry.index === 0 && entry.to === "closing"));
});

test("a brief comes back for every page the plan now uses", () => {
  const doc = document([sized("tight", "title_content", 260, 60), sized("roomy", "title_content", 900, 260, 28)]);
  const plan = planDeckLayout(doc, [{ layout: "title_body", title: longTitle, purpose: "p" }]);
  plan.slides[0].archetypeId = "tight";
  const written = new Map([[0, { title: longTitle, subtitle: null, body: null, bullets: [], purpose: "p", layout: "title_body" }]]);

  const moved = reseatOverflowing(doc, plan, written);
  assert.ok(moved.briefs.some((brief) => brief.archetypeId === plan.slides[0].archetypeId));
});

/* ------------------------------------------- no page twice, close together */

/**
 * A deck must not show the same source slide again while a reader still
 * remembers it.
 *
 * This was a penalty and penalties lose. A page matching the wanted role scores
 * a hundred and repetition cost eight, so a family with one obvious page for a
 * role used it over and over — every individual choice defensible, the deck as
 * a whole reading as one slide repeated. It is now a hard exclusion.
 *
 * The window narrows to what the family can deliver, which is the only sane
 * behaviour for a template with three pages and a deck with twelve slides:
 * they rotate, and no rotation is tighter than it has to be.
 */

const sourcePage = (id, role, over = {}) => ({
  archetypeId: id,
  role,
  alternativeRoles: [],
  recommendedStoryPosition: 8,
  layoutSignature: id,
  isTerminal: false,
  supportsImage: true,
  supportsChart: true,
  supportsTable: true,
  supportsQuote: true,
  supportsStats: true,
  minText: 0,
  maxText: 5000,
  ...over,
});

const anySlide = () => ({ purpose: "title_content", textVolume: 200, hasImage: false });

/** The closest two uses of any one page, in slides. */
function tightestRepeat(choices) {
  const seen = new Map();
  let tightest = Infinity;
  choices.forEach((choice, index) => {
    const at = seen.get(choice.archetypeId);
    if (at !== undefined) tightest = Math.min(tightest, index - at);
    seen.set(choice.archetypeId, index);
  });
  return tightest;
}

test("a page every slide wants is still not used twice within seven", () => {
  // Eight pages, one of which answers the wanted role outright. The old
  // scoring picked it for all ten slides.
  const profiles = [
    sourcePage("p1", "analysis"),
    ...Array.from({ length: 7 }, (_, index) => sourcePage(`q${index}`, "overview")),
  ];
  const plan = Array.from({ length: 10 }, () => "analysis");
  const choices = selectPages(profiles, plan, plan.map(anySlide));

  assert.equal(choices.length, 10);
  assert.ok(tightestRepeat(choices) >= 7, `repeated after ${tightestRepeat(choices)} slides`);
});

test("a small family rotates as tightly as it can and no tighter", () => {
  const profiles = [sourcePage("p1", "analysis"), sourcePage("p2", "analysis"), sourcePage("p3", "analysis")];
  const plan = Array.from({ length: 9 }, () => "analysis");
  const choices = selectPages(profiles, plan, plan.map(anySlide));

  // Three pages cannot put seven between repeats; three is the ceiling and it
  // reaches it rather than falling back to one page over and over.
  assert.equal(tightestRepeat(choices), 3);
  assert.equal(new Set(choices.map((choice) => choice.archetypeId)).size, 3);
});

test("a single-page family still produces a deck", () => {
  const profiles = [sourcePage("only", "analysis")];
  const plan = Array.from({ length: 4 }, () => "analysis");
  const choices = selectPages(profiles, plan, plan.map(anySlide));
  assert.deepEqual(choices.map((choice) => choice.archetypeId), ["only", "only", "only", "only"]);
});

test("pages already written for are kept, and the rest are spaced around them", () => {
  const profiles = Array.from({ length: 8 }, (_, index) => sourcePage(`p${index}`, "analysis"));
  const plan = Array.from({ length: 8 }, () => "analysis");
  // Slides 2 and 5 were written for p3 and cannot move.
  const fixed = [null, null, "p3", null, null, "p3", null, null];
  const choices = selectPages(profiles, plan, plan.map(anySlide), { fixed });

  assert.equal(choices[2].archetypeId, "p3");
  assert.equal(choices[5].archetypeId, "p3");
  // The free slides never reuse a settled page while it is still recent.
  const free = choices.filter((_, index) => fixed[index] === null);
  assert.ok(!free.some((choice) => choice.archetypeId === "p3"));
});

test("a closing page is still held back for the last slide", () => {
  const profiles = [
    sourcePage("body1", "analysis"), sourcePage("body2", "analysis"),
    sourcePage("end", "thanks", { isTerminal: true }),
  ];
  const plan = ["analysis", "analysis", "thanks"];
  const choices = selectPages(profiles, plan, plan.map(anySlide));
  assert.equal(choices[2].archetypeId, "end");
  assert.ok(!choices.slice(0, 2).some((choice) => choice.archetypeId === "end"));
});

/* ------------------------------------------- a cover that can say the topic */

const claiming = (slug, keyword, score, over = {}) => ({
  id: slug, slug, keywords: [{ keyword, score }], pages: 10, featured: false, ...over,
});

test("between equal matches, the design that can show the title wins", () => {
  /**
   * The failure a real deck exposed. An architecture template's cover word is
   * "Architecture" — twelve characters — and handed a forty-six character topic
   * the writer's honest best is the topic's first word cut where the box ends.
   * The customer opens a deck whose cover says "Karrupsiyaga".
   */
  const wanted = new Map([["huquq", 3]]);
  const ranked = rankDesigns([
    claiming("tight", "huquq", 80, { coverRoom: 12, titleLength: 46 }),
    claiming("roomy", "huquq", 80, { coverRoom: 60, titleLength: 46 }),
  ], wanted);

  assert.equal(ranked[0].id, "roomy");
});

test("a relevant template with a tight cover still beats an irrelevant roomy one", () => {
  // The penalty is capped on purpose: a reader would rather have the right
  // subject in a short title than the wrong subject in a long one.
  const wanted = new Map([["tibbiyot", 3]]);
  const ranked = rankDesigns([
    claiming("medical", "tibbiyot", 90, { coverRoom: 12, titleLength: 46 }),
    claiming("unrelated", "sport", 90, { coverRoom: 80, titleLength: 46 }),
  ], wanted);

  assert.equal(ranked[0].id, "medical");
});

test("a design whose cover room is unknown is not treated as tight", () => {
  // A written design's type resizes to what it is given; there is no fixed box
  // to measure, so measuring it as zero would penalise every one of them.
  const wanted = new Map([["huquq", 3]]);
  const ranked = rankDesigns([
    claiming("written", "huquq", 80),
    claiming("template", "huquq", 80, { coverRoom: 12, titleLength: 46 }),
  ], wanted);

  assert.equal(ranked[0].id, "written");
});

test("a short topic is not a shortfall", () => {
  const wanted = new Map([["huquq", 3]]);
  const [first, second] = rankDesigns([
    claiming("tight", "huquq", 80, { coverRoom: 12, titleLength: 9 }),
    claiming("roomy", "huquq", 80, { coverRoom: 60, titleLength: 9 }),
  ], wanted);
  assert.equal(first.score, second.score, "nothing to penalise when the title fits");
});

test("an unrecognised topic gets a design that claims no subject", () => {
  /**
   * The choice this got wrong. "Alisher Naboo hayoti va ijodi" — a misspelled
   * name — matched nothing in the taxonomy, so every design scored the same and
   * the winner was whichever sorted first. A deck about a poet's life came out
   * in a biology template.
   *
   * A design claiming "biologiya: 100" asserts what it is for; a design
   * claiming nothing asserts nothing wrong.
   */
  const nothing = new Map();
  const ranked = rankDesigns([
    claiming("biologiya", "biologiya", 100),
    { id: "neutral", slug: "neutral", keywords: [], pages: 10, featured: false },
  ], nothing);

  assert.equal(ranked[0].id, "neutral");
});

test("a recognised topic still goes to the design that claims it", () => {
  // The step-back only applies when nothing matched. A design that claims the
  // subject in front of it is exactly what should win.
  const wanted = new Map([["biologiya", 3]]);
  const ranked = rankDesigns([
    claiming("biologiya", "biologiya", 100),
    { id: "neutral", slug: "neutral", keywords: [], pages: 10, featured: false },
  ], wanted);

  assert.equal(ranked[0].id, "biologiya");
});

test("a lightly tagged design steps back less than a loudly tagged one", () => {
  const nothing = new Map();
  const ranked = rankDesigns([
    claiming("loud", "biologiya", 100),
    claiming("quiet", "biologiya", 20),
  ], nothing);

  assert.equal(ranked[0].id, "quiet");
});
