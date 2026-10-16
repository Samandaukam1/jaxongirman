import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Three languages, one table each, and the same holes in every sentence.
 *
 * The `translations()` type already refuses a key one language has and another
 * lacks. What it cannot see is inside the strings: an English sentence that
 * spells `{{count}}` as `{{n}}`, or a Russian one that drops the `<b>` a
 * `<Trans>` fills, renders without an error and says something wrong. So the
 * tables are compiled and read here, every string compared across languages.
 */

const root = new URL("..", import.meta.url).pathname;
const repoRoot = new URL("../..", import.meta.url).pathname;
const cache = join(root, "node_modules", ".cache");
mkdirSync(cache, { recursive: true });
const out = mkdtempSync(join(cache, "i18n-"));

writeFileSync(join(out, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "CommonJS", moduleResolution: "node", esModuleInterop: true,
    lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir: out,
    rootDir: join(root, "src", "i18n"),
  },
  files: [join(root, "src", "i18n", "resources.ts")],
}));
execFileSync(join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", join(out, "tsconfig.json")], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));
const { resources } = await import(join(out, "resources.js"));

/** Every string in a table, by its dotted path. */
function flatten(node, prefix = "", into = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") into.set(path, value);
    else flatten(value, path, into);
  }
  return into;
}

const holes = (text) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).sort();
const tags = (text) => [...text.matchAll(/<\/?(\w+)>/g)].map((match) => match[0]).sort();

const uz = flatten(resources.uz);
const others = { en: flatten(resources.en), ru: flatten(resources.ru) };

test("every language has every string", () => {
  for (const [language, table] of Object.entries(others)) {
    assert.deepEqual([...table.keys()].sort(), [...uz.keys()].sort(), `${language}: kalitlar to‘plami farq qiladi`);
  }
});

test("every string leaves the same holes for the same values", () => {
  const problems = [];
  for (const [path, text] of uz) {
    for (const [language, table] of Object.entries(others)) {
      const other = table.get(path) ?? "";
      if (holes(text).join() !== holes(other).join()) problems.push(`${language} ${path}: ${holes(text)} ≠ ${holes(other)}`);
      if (tags(text).join() !== tags(other).join()) problems.push(`${language} ${path}: teglar farq qiladi`);
    }
  }
  assert.deepEqual(problems, []);
});

test("no translated string is left empty or in Uzbek by mistake", () => {
  const problems = [];
  for (const [language, table] of Object.entries(others)) {
    for (const [path, text] of table) {
      if (!text.trim()) problems.push(`${language} ${path}: bo‘sh`);
      // Uzbek-only letters in a Russian string mean a line was pasted untranslated.
      if (language === "ru" && /[a-z]{2,}[‘’][a-z]/i.test(text) && !/O‘yingoh|o‘g‘li|ishga|Taqdimot qilish|O‘yingohni/.test(text)) {
        problems.push(`${language} ${path}: “${text}”`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
