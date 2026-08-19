import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const {
  DESIGN_CLASSIFIER_SCHEMA, MAX_KEYWORDS, SLIDE_CLASSIFIER_SCHEMA, STORY_ROLES,
  designClassifierPrompt, layoutSignatureOf, positionFor, readDesignKeywords,
  readSlideProfiles, roleFromPurpose, slideClassifierPrompt,
} = await import(`${edge}/pptx-classify.js`);
const { geminiSchemaProblems, toGeminiSchema } = await import(`${edge}/gemini-schema.js`);

/**
 * What a template's page is for.
 *
 * The classifier's answers land in a Postgres enum and a foreign key, so the
 * question these tests really ask is not "did the model get it right" but "can
 * the model's answer break an import". It must not: every value is checked
 * against the closed list, and every field has a guess computed before the
 * model was asked.
 */

const page = (index, overrides = {}) => ({
  archetype: {
    id: `page_${String(index + 1).padStart(2, "0")}`,
    purpose: overrides.purpose ?? "title_content",
    background: { role: "background" },
    selection: {
      minText: 60, maxText: overrides.maxText ?? 400,
      supportsImage: false, supportsChart: false, supportsTable: false,
      supportsStats: overrides.supportsStats ?? false, supportsQuote: false, priority: 50,
    },
    elements: overrides.elements ?? [
      { type: "text", id: "t", geometry: { x: 0, y: 0, width: 100, height: 40 } },
    ],
  },
  sourceIndexInFile: index,
  sourceTitle: overrides.title ?? null,
  purpose: overrides.purpose ?? "title_content",
  textSlots: overrides.textSlots ?? 1,
  imageSlots: overrides.imageSlots ?? 0,
  artwork: [],
});

/* ------------------------------------------------------------------ schemas */

test("both schemas survive the translation Gemini's own vocabulary needs", () => {
  for (const [name, schema] of [["slide", SLIDE_CLASSIFIER_SCHEMA], ["design", DESIGN_CLASSIFIER_SCHEMA]]) {
    const problems = geminiSchemaProblems(toGeminiSchema(schema));
    assert.deepEqual(problems, [], `${name}: ${problems.map((entry) => `${entry.path} ${entry.problem}`).join("; ")}`);
  }
});

test("neither schema asks for an exact count of composite items", () => {
  // The shape that took the writing stage down: a request for exactly N of a
  // composite thing is refused, and the refusal names nothing.
  const serialised = JSON.stringify([SLIDE_CLASSIFIER_SCHEMA, DESIGN_CLASSIFIER_SCHEMA]);
  assert.ok(!serialised.includes("minItems"), "minItems is back");
});

test("the role list is exactly the database's, in its order", () => {
  assert.equal(STORY_ROLES.length, 29);
  assert.equal(STORY_ROLES[0], "welcome");
  assert.equal(STORY_ROLES[STORY_ROLES.length - 1], "references");
});

/* ------------------------------------------------------------- the fallback */

test("the layout alone answers for the pages whose construction is obvious", () => {
  assert.equal(roleFromPurpose("cover", 0, 12), "welcome");
  assert.equal(roleFromPurpose("statistics", 5, 12), "big_number");
  assert.equal(roleFromPurpose("thank_you", 11, 12), "thanks");
  assert.equal(roleFromPurpose("timeline", 4, 12), "timeline");
});

test("an unremarkable page opens a family early and closes one late", () => {
  assert.equal(roleFromPurpose("title_content", 0, 12), "welcome");
  assert.equal(roleFromPurpose("title_content", 1, 12), "introduction");
  assert.equal(roleFromPurpose("title_content", 6, 12), "key_concepts");
  assert.equal(roleFromPurpose("title_content", 11, 12), "conclusion");
});

test("a closing role sits at the end whatever position it is offered", () => {
  assert.equal(positionFor("thanks"), 999);
  assert.equal(positionFor("welcome"), 1);
});

/* ------------------------------------------------------- reading the answer */

test("an invented role is dropped for the guess, not stored", () => {
  const pages = [page(0, { purpose: "cover" })];
  const profiles = readSlideProfiles({ pages: [{ index: 1, role: "intro_slide", recommendedStoryPosition: 1 }] }, pages);
  assert.equal(profiles[0].role, "welcome");
});

test("a recognised role is taken over the guess", () => {
  const pages = [page(3, { purpose: "title_content" })];
  const profiles = readSlideProfiles({ pages: [{ index: 1, role: "challenges", recommendedStoryPosition: 13 }] }, pages);
  assert.equal(profiles[0].role, "challenges");
  assert.equal(profiles[0].recommendedStoryPosition, 13);
});

test("no answer at all still produces a complete, insertable profile", () => {
  const pages = [page(0, { purpose: "cover" }), page(1, { purpose: "conclusion" })];
  const profiles = readSlideProfiles(null, pages);
  assert.equal(profiles.length, 2);
  for (const profile of profiles) {
    assert.ok(STORY_ROLES.includes(profile.role));
    assert.ok(["low", "medium", "high"].includes(profile.density));
    assert.ok(Number.isInteger(profile.recommendedStoryPosition));
  }
});

test("an answer about a page that does not exist is ignored", () => {
  const pages = [page(0, { purpose: "cover" })];
  const profiles = readSlideProfiles({ pages: [{ index: 9, role: "quote" }] }, pages);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].role, "welcome");
});

test("a closing page is marked terminal and pinned last, whatever was suggested", () => {
  const pages = [page(0, { purpose: "thank_you" })];
  const profiles = readSlideProfiles({ pages: [{ index: 1, role: "thanks", recommendedStoryPosition: 3 }] }, pages);
  assert.equal(profiles[0].isTerminal, true);
  assert.equal(profiles[0].recommendedStoryPosition, 999);
});

test("a middle page is not terminal", () => {
  const profiles = readSlideProfiles({ pages: [{ index: 1, role: "analysis" }] }, [page(4)]);
  assert.equal(profiles[0].isTerminal, false);
});

test("alternative roles are filtered, deduplicated and never repeat the main one", () => {
  const answer = { pages: [{ index: 1, role: "types", alternativeRoles: ["types", "comparison", "comparison", "nonsense"] }] };
  const profiles = readSlideProfiles(answer, [page(2)]);
  assert.deepEqual(profiles[0].alternativeRoles, ["comparison"]);
});

test("a scale outside the three allowed falls back to what the page measures", () => {
  const answer = { pages: [{ index: 1, role: "analysis", density: "enormous", textCapacity: "", visualWeight: "high" }] };
  const profiles = readSlideProfiles(answer, [page(2)]);
  assert.ok(["low", "medium", "high"].includes(profiles[0].density));
  assert.equal(profiles[0].visualWeight, "high");
});

test("a position outside 1–18 is replaced by the role's own place", () => {
  const profiles = readSlideProfiles({ pages: [{ index: 1, role: "agenda", recommendedStoryPosition: 400 }] }, [page(1)]);
  assert.equal(profiles[0].recommendedStoryPosition, positionFor("agenda"));
});

test("what a page supports is read from the page, never from the model", () => {
  const pages = [page(0, { imageSlots: 2, supportsStats: true })];
  const profiles = readSlideProfiles({ pages: [{ index: 1, role: "data", supportsImage: false }] }, pages);
  assert.equal(profiles[0].supportsImage, true);
  assert.equal(profiles[0].supportsStats, true);
});

/* -------------------------------------------------------------- signatures */

test("two pages built the same way share a signature", () => {
  const image = { type: "image", id: "i", geometry: { x: 520, y: 40, width: 400, height: 400 } };
  const text = { type: "text", id: "t", geometry: { x: 40, y: 40, width: 400, height: 300 } };
  const first = page(2, { purpose: "text_image", elements: [text, image] });
  const second = page(7, { purpose: "text_image", elements: [text, image] });
  assert.equal(layoutSignatureOf(first), layoutSignatureOf(second));
});

test("the same composition mirrored is a different signature", () => {
  const text = { type: "text", id: "t", geometry: { x: 40, y: 40, width: 400, height: 300 } };
  const right = page(2, { purpose: "text_image", elements: [text, { type: "image", id: "i", geometry: { x: 520, y: 40, width: 400, height: 400 } }] });
  const left = page(3, { purpose: "text_image", elements: [text, { type: "image", id: "i", geometry: { x: 20, y: 40, width: 400, height: 400 } }] });
  assert.notEqual(layoutSignatureOf(right), layoutSignatureOf(left));
});

/* ---------------------------------------------------------------- keywords */

test("a topic outside the taxonomy is dropped rather than stored", () => {
  const allowed = new Set(["tibbiyot", "talim"]);
  const kept = readDesignKeywords({ topics: [{ slug: "tibbiyot", score: 90 }, { slug: "meditsina", score: 80 }] }, allowed);
  assert.deepEqual(kept, [{ slug: "tibbiyot", score: 90 }]);
});

test("topics come back strongest first, however they were sent", () => {
  const allowed = new Set(["a", "b", "c"]);
  const kept = readDesignKeywords({ topics: [{ slug: "a", score: 10 }, { slug: "b", score: 95 }, { slug: "c", score: 50 }] }, allowed);
  assert.deepEqual(kept.map((entry) => entry.slug), ["b", "c", "a"]);
});

test("a score outside 0–100 is clamped rather than refused", () => {
  const kept = readDesignKeywords({ topics: [{ slug: "a", score: 480 }, { slug: "b", score: -3 }] }, new Set(["a", "b"]));
  assert.equal(kept[0].score, 100);
  assert.equal(kept[1].score, 0);
});

test("a missing score is a middling one, not a dropped topic", () => {
  const kept = readDesignKeywords({ topics: [{ slug: "a" }] }, new Set(["a"]));
  assert.deepEqual(kept, [{ slug: "a", score: 50 }]);
});

test("no more topics are kept than the column allows", () => {
  const slugs = Array.from({ length: 20 }, (_, index) => `t${index}`);
  const kept = readDesignKeywords({ topics: slugs.map((slug, index) => ({ slug, score: index })) }, new Set(slugs));
  assert.equal(kept.length, MAX_KEYWORDS);
});

test("a duplicate topic is counted once", () => {
  const kept = readDesignKeywords({ topics: [{ slug: "a", score: 90 }, { slug: "a", score: 10 }] }, new Set(["a"]));
  assert.equal(kept.length, 1);
});

test("nothing usable in the answer is an empty list, never a throw", () => {
  assert.deepEqual(readDesignKeywords(null, new Set(["a"])), []);
  assert.deepEqual(readDesignKeywords({ topics: "hammasi" }, new Set(["a"])), []);
});

/* ----------------------------------------------------------------- prompts */

test("the family is described in one request, so a page's role can be relative", () => {
  const prompt = slideClassifierPrompt([
    { index: 0, total: 2, purpose: "cover", heading: "Kirish", sample: "", textSlots: 2, imageSlots: 0, largestFontSize: 44, smallestFontSize: 18, shapes: 1, archetypeId: "page_01", layoutSignature: "" },
    { index: 1, total: 2, purpose: "conclusion", heading: "", sample: "", textSlots: 1, imageSlots: 0, largestFontSize: 32, smallestFontSize: 18, shapes: 0, archetypeId: "page_02", layoutSignature: "" },
  ]);
  assert.ok(prompt.includes("#1/2"));
  assert.ok(prompt.includes("#2/2"));
  // The whole vocabulary is named, so the model is not guessing at spellings.
  for (const role of STORY_ROLES) assert.ok(prompt.includes(role), `${role} missing`);
});

test("the design is judged on how it looks, and the taxonomy is spelled out", () => {
  const prompt = designClassifierPrompt({
    name: "Studio",
    pages: [],
    palette: ["#0b1020", "#ff2d55"],
    fonts: ["Playfair Display"],
    topics: [{ slug: "tibbiyot", label: "Tibbiyot" }],
  });
  assert.ok(prompt.includes("#0b1020"));
  assert.ok(prompt.includes("Playfair Display"));
  assert.ok(prompt.includes("tibbiyot — Tibbiyot"));
});
