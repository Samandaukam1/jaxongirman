import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const {
  WORK_KINDS, documentBlocks, planPrompt, readPlan, readSection,
  referenceLine, sectionPrompt, skeletonFor, wordCount,
} = await import(`${edge}/academic.js`);

/**
 * Two rules run through the academic engine and neither is negotiable.
 *
 * Nothing is invented — not a source, an author, a year, a page number, and
 * above all not a finding. And a page number is a claim: written only when the
 * research actually established it, because a citation that looks precise and
 * is guessed invites somebody to go and check.
 */

const sources = [
  { title: "Kitob", author: "Aliyev A.", publisher: "Fan", year: "2020", url: "", page: "" },
  { title: "Maqola", author: "Bekova B.", publisher: "Jurnal", year: "2023", url: "https://x", page: "45" },
];

test("an article about something nobody measured has no Results section", () => {
  const review = skeletonFor("article", false).map((section) => section.key);
  assert.ok(!review.includes("results"), "nazariy maqolada natijalar bo‘limi bo‘lmasin");
  assert.ok(!review.includes("methods"), "o‘tkazilmagan usullar tasvirlanmasin");
  assert.ok(review.includes("review"));

  const empirical = skeletonFor("article", true).map((section) => section.key);
  assert.ok(empirical.includes("results"));
  assert.ok(empirical.includes("methods"));
});

test("every kind has a structure, and they are not the same one", () => {
  const shapes = WORK_KINDS.map((entry) => skeletonFor(entry.kind, false).map((section) => section.key).join(","));
  assert.equal(new Set(shapes).size, WORK_KINDS.length);
  for (const entry of WORK_KINDS) {
    const keys = skeletonFor(entry.kind, false).map((section) => section.key);
    assert.ok(keys.includes("conclusion"), `${entry.kind} xulosasiz`);
    assert.equal(new Set(keys).size, keys.length, `${entry.kind}: takroriy kalit`);
  }
});

test("the keys are the work's spine and the model cannot rename them", () => {
  const skeleton = skeletonFor("referat", false);
  const plan = readPlan({
    empirical: false,
    sections: [
      // A renamed key would orphan whatever was already written into it.
      { key: "totally_different", heading: "Boshqa", brief: "…" },
      { key: "introduction", heading: "Kirish qismi", brief: "Moslashtirilgan" },
    ],
    sources: [],
  }, skeleton);

  assert.deepEqual(plan.sections.map((section) => section.key), skeleton.map((section) => section.key));
  // A heading may be adapted to the topic, which is wanted.
  assert.equal(plan.sections.find((section) => section.key === "introduction").heading, "Kirish qismi");
});

test("a source with no title is not a source", () => {
  const plan = readPlan({
    empirical: false,
    sections: [],
    sources: [{ title: "", author: "X" }, { title: "Haqiqiy manba", author: "Y", year: "2021" }],
  }, skeletonFor("referat", false));
  assert.equal(plan.sources.length, 1);
  assert.equal(plan.sources[0].title, "Haqiqiy manba");
});

test("a citation pointing past the list is dropped, which is how a made-up one arrives", () => {
  const written = readSection({ body: "Matn [1] va [7].", citations: [1, 7, 2, 2, 0, -3] }, 2);
  assert.deepEqual(written.citations, [1, 2]);
});

test("an empty answer is not a section", () => {
  assert.equal(readSection({ body: "   ", citations: [] }, 2).body, "");
  assert.equal(readSection(null, 2).body, "");
});

test("the plan prompt refuses invented sources out loud", () => {
  const prompt = planPrompt({
    kind: "article", topic: "T", field: "F", requirements: "",
    skeleton: skeletonFor("article", true),
  });
  assert.match(prompt, /O‘YLAB TOPMANG/);
  assert.match(prompt, /faqat sahifa raqamini ishonch bilan bilsangiz/i);
  assert.match(prompt, /empirical/);
});

test("a section is given the earlier sections in summary, not in full", () => {
  const prompt = sectionPrompt({
    kind: "coursework", topic: "T", field: "", heading: "II bob", brief: "Tahlil",
    earlier: [{ heading: "Kirish", summary: "qisqacha" }],
    next: "III bob", sources, words: 700,
  });
  assert.match(prompt, /OLDINGI BO‘LIMLAR/);
  assert.match(prompt, /takrorlamang/);
  assert.match(prompt, /\[1\]/);
  assert.match(prompt, /700 so‘z/);
});

test("a page number is printed only when the research established one", () => {
  assert.match(referenceLine(sources[1], 1), /— B\. 45\./);
  assert.ok(!referenceLine(sources[0], 0).includes("B."));
});

/**
 * The typography is the requirement, not a preference.
 *
 * A paper handed in at single spacing comes back, and so does one set in
 * Calibri — which is what a word processor gives you if nobody says otherwise.
 */
test("body text is justified, 1.5, indented 1.25 and has no space around it", () => {
  const blocks = documentBlocks({
    kind: "referat", topic: "Mavzu", field: "Fan", authorName: "A B",
    organization: "OTM",
    sections: [{ key: "introduction", heading: "Kirish", body: "Birinchi abzas.\n\nIkkinchi abzas." }],
    sources,
  });
  const body = blocks.filter((block) => block.kind === "paragraph"
    && block.runs.some((run) => run.text.startsWith("Birinchi") || run.text.startsWith("Ikkinchi")));
  // Paragraphs are split, not shipped as one block with newlines in it.
  assert.equal(body.length, 2);
  for (const block of body) {
    assert.equal(block.align, "both");
    assert.equal(block.lineSpacing, 1.5);
    assert.equal(block.indent, 1.25);
    assert.equal(block.spaceAfter, 0);
  }
});

test("the title is capitals, bold, centred and larger than the body", () => {
  const [title] = documentBlocks({
    kind: "article", topic: "Kimyoviy xavfsizlik", field: "", authorName: null,
    organization: null, sections: [], sources: [],
  });
  assert.equal(title.align, "center");
  assert.equal(title.runs[0].text, "KIMYOVIY XAVFSIZLIK");
  assert.equal(title.runs[0].bold, true);
  assert.ok(title.runs[0].size >= 16);
});

test("the abstract carries one labelled line per language", () => {
  /**
   * A journal here asks for the abstract and the keywords in Uzbek, Russian and
   * English, and the submission form has a box for each. One language is a
   * paper handed back.
   */
  const blocks = documentBlocks({
    kind: "article", topic: "T", field: "", authorName: null, organization: null,
    sections: [{
      key: "abstract",
      heading: "Annotatsiya",
      body: "Annotatsiya: Qisqacha mazmun.\nАннотация: Краткое содержание.\nAbstract: A short summary.",
    }],
    sources: [],
  });

  const labelled = blocks.filter((block) => block.kind === "paragraph" && block.runs.length === 2);
  assert.equal(labelled.length, 3, "uch til uchun uchta qator");
  assert.deepEqual(labelled.map((block) => block.runs[0].text.trim()),
    ["Annotatsiya:", "Аннотация:", "Abstract:"]);

  for (const line of labelled) {
    assert.equal(line.runs[0].bold, true, "yorliq qalin bo‘lsin");
    assert.equal(line.runs[1].bold, undefined, "matn qalin bo‘lmasin");
  }
  assert.equal(labelled[0].runs[1].text, "Qisqacha mazmun.");
});

test("a body that arrives without labels is printed as it came", () => {
  // A wrong label is worse than none, so nothing is guessed at.
  const blocks = documentBlocks({
    kind: "article", topic: "T", field: "", authorName: null, organization: null,
    sections: [{ key: "keywords", heading: "Kalit so‘zlar", body: "jurnalistika, matbuot" }],
    sources: [],
  });
  const line = blocks.find((block) => block.kind === "paragraph"
    && block.runs.some((run) => run.text.includes("jurnalistika")));
  assert.ok(line);
  assert.equal(line.runs.length, 1);
});

test("an article's bibliography follows on; a bound work's starts a page", () => {
  const referencesOf = (kind) => documentBlocks({
    kind, topic: "T", field: "", authorName: null, organization: null,
    sections: [{ key: "introduction", heading: "Kirish", body: "Matn." }],
    sources,
  }).find((block) => block.kind === "paragraph"
    && block.runs.some((run) => run.text === "Foydalanilgan adabiyotlar"));

  assert.ok(!referencesOf("article").pageBreakBefore);
  assert.equal(referencesOf("coursework").pageBreakBefore, true);

  const lines = documentBlocks({
    kind: "article", topic: "T", field: "", authorName: null, organization: null,
    sections: [], sources,
  }).filter((block) => block.kind === "paragraph" && block.runs.some((run) => /^\d+\./.test(run.text)));
  assert.equal(lines.length, sources.length);
});

test("words are counted, so a short section can be told from a long one", () => {
  assert.equal(wordCount("bir ikki uch"), 3);
  assert.equal(wordCount("   "), 0);
});
