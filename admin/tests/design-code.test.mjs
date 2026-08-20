import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(here, "..");
const repoRoot = path.resolve(adminRoot, "..");

function build() {
  const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-design-code-"));
  const configPath = path.join(outDir, "tsconfig.json");
  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      lib: ["ES2022", "DOM"], strict: true, skipLibCheck: true, types: [], outDir,
      rootDir: path.join(adminRoot, "src", "lib"),
    },
    files: [path.join(adminRoot, "src", "lib", "design-code.ts")],
  }, null, 2));
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
  return outDir;
}

const dir = build();
const { MAX_KEYWORDS, STORY_ROLES, buildPrompt, readDesignCode } = await import(`${dir}/design-code.js`);

/**
 * The analysis somebody did somewhere else, brought back as a code.
 *
 * The reader is forgiving about shape and unforgiving about vocabulary. A chat
 * window wraps answers in fences, writes a sentence first, and turns quotes
 * curly — none of that is the analyst's mistake. A subject nobody recognises
 * is: it lands in a foreign key, and one invented spelling is a design that
 * quietly never matches anything.
 */

const TOPICS = [
  { slug: "jurnalistika", label: "Jurnalistika" },
  { slug: "marketing", label: "Marketing" },
  { slug: "texnologiya", label: "Texnologiya" },
];

const read = (text, pageCount = 12) => readDesignCode(text, { topics: TOPICS, pageCount });

const GOOD = JSON.stringify({
  keywords: [
    { keyword: "jurnalistika", score: 100 },
    { keyword: "marketing", score: 60 },
    { keyword: "texnologiya", score: 50 },
  ],
  pages: [
    { page: 1, role: "welcome", note: "muqova" },
    { page: 2, role: "agenda", note: "mundarija" },
    { page: 3, role: "introduction", note: "kirish" },
  ],
});

/* ------------------------------------------------------------- the prompt */

test("the prompt spells the taxonomy out rather than describing it", () => {
  const prompt = buildPrompt({ designName: "Studio", pageCount: 9, topics: TOPICS });
  for (const topic of TOPICS) assert.ok(prompt.includes(`${topic.slug} — ${topic.label}`), topic.slug);
});

test("the prompt names every role that can be stored", () => {
  const prompt = buildPrompt({ designName: "Studio", pageCount: 9, topics: TOPICS });
  for (const role of STORY_ROLES) assert.ok(prompt.includes(role), `${role} missing`);
});

test("the prompt says how many pages to describe, which is the mistake worth preventing", () => {
  assert.ok(buildPrompt({ designName: "S", pageCount: 9, topics: TOPICS }).includes("9 ta"));
});

test("an unknown page count simply is not claimed", () => {
  const prompt = buildPrompt({ designName: "S", pageCount: null, topics: TOPICS });
  assert.ok(!prompt.includes("Sahifalar soni"));
});

/* -------------------------------------------------------------- the reader */

test("a clean answer is read whole", () => {
  const result = read(GOOD);
  assert.equal(result.problem, null);
  assert.deepEqual(result.keywords.map((entry) => entry.keyword), ["jurnalistika", "marketing", "texnologiya"]);
  assert.equal(result.keywords[0].score, 100);
  assert.equal(result.pages.length, 3);
  assert.equal(result.pages[1].role, "agenda");
});

test("the label comes from the taxonomy, not from the answer", () => {
  const result = read(GOOD);
  assert.equal(result.keywords[0].label, "Jurnalistika");
});

test("a fenced block is unwrapped", () => {
  const result = read("Mana tahlil natijasi:\n\n```json\n" + GOOD + "\n```\n\nSavollar bo'lsa yozing.");
  assert.equal(result.keywords.length, 3);
  assert.equal(result.pages.length, 3);
});

test("a sentence of introduction containing braces does not become the answer", () => {
  const text = "Men {shablon} ni ko'rib chiqdim.\n\n```\n" + GOOD + "\n```";
  assert.equal(read(text).keywords.length, 3);
});

test("curly quotes from a reformatted block are repaired", () => {
  const curly = '{ “keywords”: [ { “keyword”: “marketing”, “score”: 80 } ], “pages”: [] }';
  assert.equal(read(curly).keywords[0].keyword, "marketing");
});

test("a trailing comma is repaired rather than refused", () => {
  const text = '{"keywords":[{"keyword":"marketing","score":70},],"pages":[]}';
  assert.equal(read(text).keywords.length, 1);
});

test("topics come back strongest first, so the phone takes the closest match", () => {
  const text = JSON.stringify({ keywords: [
    { keyword: "marketing", score: 40 },
    { keyword: "jurnalistika", score: 95 },
  ], pages: [] });
  assert.deepEqual(read(text).keywords.map((entry) => entry.keyword), ["jurnalistika", "marketing"]);
});

/* ------------------------------------------------- what cannot be stored --*/

test("a subject outside the taxonomy is named, not silently dropped", () => {
  const text = JSON.stringify({ keywords: [
    { keyword: "jurnalistika", score: 100 },
    { keyword: "meditsina", score: 90 },
  ], pages: [] });
  const result = read(text);
  assert.deepEqual(result.keywords.map((entry) => entry.keyword), ["jurnalistika"]);
  assert.deepEqual(result.unknownTopics, ["meditsina"]);
});

test("a role nobody recognises is named too", () => {
  const text = JSON.stringify({ keywords: [], pages: [{ page: 1, role: "intro_slide" }] });
  const result = read(text);
  assert.equal(result.pages.length, 0);
  assert.deepEqual(result.unknownRoles, ["intro_slide"]);
});

test("a page beyond the family is ignored", () => {
  const text = JSON.stringify({ keywords: [], pages: [{ page: 40, role: "welcome" }] });
  assert.equal(read(text, 12).pages.length, 0);
});

test("the same page twice is counted once", () => {
  const text = JSON.stringify({ keywords: [], pages: [
    { page: 2, role: "agenda" }, { page: 2, role: "quote" },
  ] });
  const result = read(text);
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].role, "agenda");
});

test("no more topics are kept than the column allows", () => {
  const many = Array.from({ length: 14 }, (_, index) => ({ keyword: `t${index}`, score: index }));
  const topics = many.map((entry) => ({ slug: entry.keyword, label: entry.keyword }));
  const result = readDesignCode(JSON.stringify({ keywords: many, pages: [] }), { topics, pageCount: 5 });
  assert.equal(result.keywords.length, MAX_KEYWORDS);
});

/* ------------------------------------------------------ different spellings */

test("`topic` and `slug` are read as the same field, because both come back", () => {
  const byTopic = read('{"keywords":[{"topic":"marketing","score":70}],"pages":[]}');
  const bySlug = read('{"keywords":[{"slug":"marketing","score":70}],"pages":[]}');
  assert.equal(byTopic.keywords[0].keyword, "marketing");
  assert.equal(bySlug.keywords[0].keyword, "marketing");
});

test("`slide` is read as `page`, and a percent as a score", () => {
  const result = read('{"keywords":[{"keyword":"marketing","percent":88}],"pages":[{"slide":2,"role":"quote"}]}');
  assert.equal(result.keywords[0].score, 88);
  assert.equal(result.pages[0].page, 2);
});

test("a capitalised or spaced role still resolves to the stored spelling", () => {
  // The enum is `key_concepts`; an analyst writes "Key Concepts" and a chat
  // window may hyphenate it. All three are one role.
  for (const written of ["Key Concepts", "key-concepts", "KEY_CONCEPTS"]) {
    const result = read(`{"keywords":[],"pages":[{"page":1,"role":"${written}"}]}`);
    assert.equal(result.pages[0]?.role, "key_concepts", written);
  }
});

test("a topic written with a space or an underscore still resolves", () => {
  const topics = [{ slug: "ijtimoiy-fanlar", label: "Ijtimoiy fanlar" }];
  for (const written of ["ijtimoiy fanlar", "Ijtimoiy_Fanlar", "IJTIMOIY-FANLAR"]) {
    const result = readDesignCode(`{"keywords":[{"keyword":"${written}","score":80}],"pages":[]}`, { topics, pageCount: 4 });
    assert.equal(result.keywords[0]?.keyword, "ijtimoiy-fanlar", written);
  }
});

test("a score outside 0–100 is clamped rather than refused", () => {
  const result = read('{"keywords":[{"keyword":"marketing","score":480}],"pages":[]}');
  assert.equal(result.keywords[0].score, 100);
});

test("a missing score is a middling one, not a dropped subject", () => {
  assert.equal(read('{"keywords":[{"keyword":"marketing"}],"pages":[]}').keywords[0].score, 50);
});

/* ---------------------------------------------------------------- failures */

test("nothing pasted says so plainly", () => {
  assert.match(read("   ").problem, /kiritilmadi/i);
});

test("prose with no JSON in it says what to do about it", () => {
  assert.match(read("Bu dizayn juda chiroyli, marketingga mos.").problem, /JSON/);
});

test("broken JSON is reported as broken, not as an empty analysis", () => {
  assert.match(read('{"keywords": [ {"keyword": ').problem, /o'qilmadi|JSON/i);
});

test("valid JSON that recognises nothing is a problem, not a silent success", () => {
  assert.ok(read('{"keywords":[{"keyword":"astronomiya","score":90}],"pages":[]}').problem);
});
