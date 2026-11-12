import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The legal pages (/privacy, /terms, /support, /delete-account, /refund) are
 * the URLs App Store Connect and Google Play hold. These run their real rules
 * from `lib/legal-text.ts`, compiled on the spot.
 */

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(path.join(webRoot, "..", "package.json"))("typescript");
const source = readFileSync(path.join(webRoot, "lib", "legal-text.ts"), "utf8");
const dir = mkdtempSync(path.join(tmpdir(), "legal-text-"));
const file = path.join(dir, "legal-text.mjs");
writeFileSync(file, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const { fillPlaceholders, pageLanguage, parseBlocks, safeHref } = await import(pathToFileURL(file).href);
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

test("a line quoting an empty value leaves the page whole, never half-filled", () => {
  const body = "- Email: {{support_email}}\n- Telefon: {{phone}}\n- Telegram: [{{telegram}}]({{telegram_url}})\nMatn qoladi.";
  const filled = fillPlaceholders(body, { support_email: "help@example.uz", phone: "", telegram: "", telegram_url: "" });
  assert.equal(filled, "- Email: help@example.uz\nMatn qoladi.");
  assert.doesNotMatch(filled, /\{\{/);
});

test("a heading left with nothing under it is dropped, an empty ### and then its ##", () => {
  const blocks = parseBlocks("## Aloqa\n\n### Telefon\n\n## Savollar\n\nJavob.");
  assert.deepEqual(blocks.map((block) => block.kind), ["h2", "p"]);
  assert.equal(blocks[0].text, "Savollar");
});

test("the console's Markdown is read as lists, tables and paragraphs", () => {
  const blocks = parseBlocks("Kirish matni\ndavomi.\n\n- bir\n- ikki\n\n1. birinchi\n2. ikkinchi\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n---");
  assert.deepEqual(blocks.map((block) => block.kind), ["p", "ul", "ol", "table", "hr"]);
  assert.equal(blocks[0].text, "Kirish matni davomi.");
  assert.deepEqual(blocks[3].rows, [["1", "2"]]);
});

test("a link may only go to this site, http(s), mailto: or tel:", () => {
  assert.equal(safeHref("/terms"), "/terms");
  assert.equal(safeHref("https://t.me/jaxongirman"), "https://t.me/jaxongirman");
  assert.equal(safeHref("mailto:help@example.uz"), "mailto:help@example.uz");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("//evil.example/x"), null);
  assert.equal(safeHref("data:text/html,x"), null);
});

test("?lang= is a choice; the browser's language is only a guess", () => {
  assert.deepEqual(pageLanguage("ru", "en-US"), { language: "ru", chosen: true });
  assert.deepEqual(pageLanguage(undefined, "en-US,en;q=0.9"), { language: "en", chosen: false });
  assert.deepEqual(pageLanguage(undefined, "de-DE"), { language: "uz", chosen: false });
  assert.deepEqual(pageLanguage("xx", null), { language: "uz", chosen: false });
});

test("the operator is named on every legal page, and its two documents ship with the site", () => {
  const page = readFileSync(path.join(webRoot, "app", "_legal", "LegalPage.tsx"), "utf8");
  const company = readFileSync(path.join(webRoot, "lib", "company.ts"), "utf8");
  assert.match(page, /tasarrufidagi loyiha/);
  assert.match(company, /MUKAMMAL MEDIA GROUP/);
  for (const name of ["mukammal-media-group-guvohnoma", "mukammal-media-group-noshirlik-tasdiqnoma"]) {
    for (const extension of ["pdf", "webp"]) {
      assert.ok(readFileSync(path.join(webRoot, "public", "legal", `${name}.${extension}`)).length > 1000, `${name}.${extension}`);
    }
  }
});
