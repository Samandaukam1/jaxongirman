import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

function build() {
  const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-jelement-dup-"));
  const configPath = path.join(outDir, "tsconfig.json");
  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir,
      rootDir: repoRoot, allowImportingTsExtensions: false, rewriteRelativeImportExtensions: true,
      paths: { "@jaxongirman/jslayd": [path.join(repoRoot, "packages", "jslayd", "src", "index.ts")] },
    },
    include: [
      path.join(packageRoot, "src", "*.ts"),
      path.join(repoRoot, "packages", "jslayd", "src", "*.ts"),
    ],
  }, null, 2));
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
  const link = path.join(outDir, "node_modules", "@jaxongirman", "jslayd");
  mkdirSync(link, { recursive: true });
  writeFileSync(path.join(link, "package.json"), JSON.stringify({
    name: "@jaxongirman/jslayd", type: "module",
    main: path.join(outDir, "packages", "jslayd", "src", "index.js"),
  }));
  return path.join(outDir, "packages", "jelement", "src");
}

const dir = build();
const { findDuplicates, findInternalDuplicates } = await import(`${dir}/duplicates.js`);

/**
 * Two elements for one object make the library worse than one.
 *
 * A query matches both, neither is the answer, and the planner takes whichever
 * sorted first. A false positive here costs an admin a click; a false negative
 * costs the library a duplicate forever, so the bar catches the obvious cases
 * loudly rather than the subtle ones quietly.
 */
const element = (canonicalName, semantic = {}) => ({
  canonicalName,
  semantic: {
    aliases: [], uzbekTerms: [], englishTerms: [], russianTerms: [],
    industries: [], concepts: [], actions: [], contexts: [], ...semantic,
  },
});

const EXISTING = [
  element("mining haul truck", { aliases: ["dump truck"], uzbekTerms: ["kon yuk mashinasi"] }),
  element("mining loader", { aliases: ["front loader"] }),
  element("survey total station", { uzbekTerms: ["geodezik asbob"] }),
];

test("the same name is caught with certainty", () => {
  const [match] = findDuplicates([element("mining haul truck")], EXISTING);
  assert.ok(match);
  assert.equal(match.confidence, 1);
  assert.equal(match.existing, "mining haul truck");
});

test("case and apostrophes do not hide a duplicate", () => {
  // Somebody typing on a different keyboard produces a different byte sequence
  // for the same word, and a check that misses it lets the duplicate through.
  const existing = [element("kon oʻchoqlari")];
  const [match] = findDuplicates([element("Kon O'choqlari")], existing);
  assert.ok(match, "both apostrophes are the same letter");
  assert.equal(match.confidence, 1);
});

test("an object already answering to the incoming name is caught", () => {
  // This is what a rename looks like from the outside.
  const [match] = findDuplicates([element("dump truck")], EXISTING);
  assert.ok(match);
  assert.equal(match.existing, "mining haul truck");
  assert.ok(match.confidence >= 0.9);
  assert.match(match.reason, /dump truck/);
});

test("a shared Uzbek term is caught too", () => {
  const [match] = findDuplicates(
    [element("field survey instrument", { uzbekTerms: ["geodezik asbob"] })],
    EXISTING,
  );
  assert.ok(match, "the library is used in Uzbek, so its terms count as names");
  assert.equal(match.existing, "survey total station");
});

test("a near-identical name is raised as a question", () => {
  const [match] = findDuplicates([element("wheel loader")], EXISTING);
  assert.ok(match, "«wheel loader» and «mining loader» are probably one object");
  assert.ok(match.confidence >= 0.5 && match.confidence < 0.9, "reported as a likelihood, not a certainty");
});

test("two different objects sharing a word are not confused", () => {
  // "mining truck" and "mining drill" share a qualifier and are not the same
  // thing. A check that flagged them would make expansion unusable.
  const matches = findDuplicates([element("mining drill")], EXISTING);
  assert.deepEqual(matches, []);
});

test("an unrelated element is left alone", () => {
  assert.deepEqual(findDuplicates([element("ventilation fan")], EXISTING), []);
});

test("duplicates inside one specification are caught before it is saved", () => {
  // An analyzer asked for twelve siblings can repeat itself within the batch.
  const batch = [
    element("conveyor belt"),
    element("ventilation fan"),
    element("belt conveyor", { aliases: ["conveyor belt"] }),
  ];
  const matches = findInternalDuplicates(batch);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].candidate, "belt conveyor");
  assert.equal(matches[0].existing, "conveyor belt");
});

test("matches arrive strongest first, so the clearest is read first", () => {
  const matches = findDuplicates(
    [element("wheel loader"), element("mining haul truck")],
    EXISTING,
  );
  assert.equal(matches[0].confidence, 1);
  assert.ok(matches[1].confidence < 1);
});

test("an empty family collides with nothing", () => {
  assert.deepEqual(findDuplicates([element("anything")], []), []);
  assert.deepEqual(findInternalDuplicates([]), []);
});
