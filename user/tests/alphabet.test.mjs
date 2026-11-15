import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Uzbek in the updated alphabet: O‘ → Ö, G‘ → Ğ, Sh → Ş, Ch → Ç.
 *
 * The app's Uzbek tables stay in the current alphabet and are respelled when
 * they load; the server respells what the models write with a byte-for-byte
 * copy of the same file. These are the rules both rely on.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const source = path.join(repoRoot, "user", "src", "lib", "alphabet.ts");
const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-alphabet-"));
writeFileSync(path.join(outDir, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "bundler",
    lib: ["ES2022"], strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true, types: [], outDir,
    rootDir: path.dirname(source),
  },
  include: [source],
}));
execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", path.join(outDir, "tsconfig.json")], { stdio: "inherit" });
writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
const { toNewAlphabet, deepNewAlphabet } = await import(path.join(outDir, "alphabet.js"));

test("the four letters change, in either case and with any apostrophe", () => {
  assert.equal(toNewAlphabet("O‘zbekiston"), "Özbekiston");
  assert.equal(toNewAlphabet("o'quv oʻqituvchi o’g’il o`rin"), "öquv öqituvçi öğil örin");
  assert.equal(toNewAlphabet("tog‘ bog‘ G‘alaba"), "toğ boğ Ğalaba");
  assert.equal(toNewAlphabet("Toshkent shahri"), "Toşkent şahri");
  assert.equal(toNewAlphabet("Chiroq, ichimlik"), "Çiroq, içimlik");
  assert.equal(toNewAlphabet("O‘ZBEKISTON SHAHAR CHIROQ"), "ÖZBEKISTON ŞAHAR ÇIROQ");
  assert.equal(toNewAlphabet("F.I.Sh."), "F.I.Ş.");
});

test("the tutuq belgisi stays, and so does s'h written apart", () => {
  assert.equal(toNewAlphabet("ma’lumot, san’at, ta'lim"), "ma’lumot, san’at, ta'lim");
  assert.equal(toNewAlphabet("Is’hoq"), "Is’hoq");
});

test("placeholders, tags, links, addresses and usernames are untouched", () => {
  assert.equal(toNewAlphabet("{{chars}} ta belgi, {{shown}} ko‘rsatildi"), "{{chars}} ta belgi, {{shown}} körsatildi");
  assert.equal(toNewAlphabet("<b>Shahar</b>"), "<b>Şahar</b>");
  assert.equal(toNewAlphabet("https://jaxongirman.app/shop?ch=1 ochish"), "https://jaxongirman.app/shop?ch=1 oçiş");
  assert.equal(toNewAlphabet("shoh@example.com ga yozing"), "shoh@example.com ga yozing");
  assert.equal(toNewAlphabet("@shohjahon uchun"), "@shohjahon uçun");
});

test("words that are plainly not Uzbek keep their spelling", () => {
  for (const word of ["ChatGPT", "PowerPoint", "iPhone", "Washington", "Chicago", "Chrome", "Schubert", "Smith", "Google's"]) {
    assert.equal(toNewAlphabet(word), word, word);
  }
  // Uzbek words that only look foreign at a glance still change.
  assert.equal(toNewAlphabet("kichraytirish uchrab okeanshunos"), "kiçraytiriş uçrab okeanşunos");
});

test("a quote around a word is not an o‘ or a g‘", () => {
  assert.equal(toNewAlphabet("'ming' so‘m"), "'ming' söm");
  assert.equal(toNewAlphabet("‘tog‘’"), "‘toğ’");
});

test("running it twice is running it once, and Cyrillic passes through", () => {
  const once = toNewAlphabet("O‘zbekiston — go‘zal yurt, Toshkent shahri");
  assert.equal(toNewAlphabet(once), once);
  assert.equal(toNewAlphabet("Ўзбекистон шаҳри"), "Ўзбекистон шаҳри");
  assert.equal(toNewAlphabet(""), "");
});

test("a whole table is respelled and its keys are kept", () => {
  assert.deepEqual(deepNewAlphabet({ save: "Saqlash", nested: { list: ["Ochish", "Yo‘q"] }, count: 3 }),
    { save: "Saqlaş", nested: { list: ["Oçiş", "Yöq"] }, count: 3 });
});

test("the server's copy is the same file", () => {
  const server = path.join(repoRoot, "supabase", "functions", "_shared", "alphabet.ts");
  assert.equal(readFileSync(server, "utf8"), readFileSync(source, "utf8"));
});
