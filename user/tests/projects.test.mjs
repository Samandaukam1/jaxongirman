import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

/** The matching rules are pure; the reads are not, and are not tested here. */
const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-projects-"));
const configPath = path.join(outDir, "tsconfig.json");
writeFileSync(configPath, JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "bundler",
    lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir,
    rootDir: path.join(repoRoot, "user", "src", "lib"),
  },
  include: [path.join(repoRoot, "user", "src", "lib", "project-search.ts")],
}, null, 2));
execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));

const { normalise, searchProjects } = await import(`${outDir}/project-search.js`);

const items = [
  { title: "Formula 1 haqida ma’limotlar", detail: "7 slayd", kind: "Taqdimot" },
  { title: "Tish davolatish bosqichlari", detail: "10 slayd", kind: "Taqdimot" },
  { title: "Qurbonnazarov Jaxongir", detail: "Ma’lumotnoma", kind: "Obyektivka" },
  { title: "O‘quv jarayonida raqamli vositalar", detail: "Ilmiy maqola", kind: "Ilmiy ish" },
];

/**
 * Uzbek is written with four different apostrophes depending on the keyboard,
 * and somebody looking for "o‘quv" types whichever their phone gives them. A
 * search that respects the difference finds nothing and looks broken.
 */
test("every apostrophe on every keyboard finds the same thing", () => {
  for (const typed of ["o‘quv", "o'quv", "o’quv", "oʻquv", "O‘QUV"]) {
    assert.equal(searchProjects(items, typed).length, 1, typed);
  }
});

test("searching finds a project by what kind it is", () => {
  assert.equal(searchProjects(items, "obyektivka").length, 1);
  assert.equal(searchProjects(items, "ilmiy").length, 1);
  assert.equal(searchProjects(items, "taqdimot").length, 2);
});

test("several words all have to match, in any order", () => {
  assert.equal(searchProjects(items, "tish bosqichlari").length, 1);
  assert.equal(searchProjects(items, "bosqichlari tish").length, 1);
  assert.equal(searchProjects(items, "tish formula").length, 0);
});

test("an empty query is not a filter", () => {
  assert.equal(searchProjects(items, "").length, items.length);
  assert.equal(searchProjects(items, "   ").length, items.length);
});

test("normalising folds case, apostrophes, both alphabets and runs of spaces", () => {
  assert.equal(normalise("  O‘QUV   Jarayoni "), "oquv jarayoni");
  assert.equal(normalise("Öquv jarayoni"), "oquv jarayoni");
  assert.equal(normalise("Ma’lumot"), "ma'lumot");
});

test("a title in either alphabet is found by a query in either alphabet", () => {
  const titles = [
    { title: "Toshkent shahri tarixi", detail: "", kind: "" },
    { title: "Özbekiston çöllari", detail: "", kind: "" },
  ];
  for (const typed of ["Şahri", "shahri", "toşkent"]) assert.equal(searchProjects(titles, typed).length, 1, typed);
  for (const typed of ["o‘zbekiston", "Özbekiston", "ozbekiston", "chollari", "çöllari"]) {
    assert.equal(searchProjects(titles, typed).length, 1, typed);
  }
});
