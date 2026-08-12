import assert from "node:assert/strict";
import test from "node:test";

import { buildJslayd } from "./build.mjs";

const dir = buildJslayd();
const { compile } = await import(`${dir}/compile.js`);
const { decompile } = await import(`${dir}/decompile.js`);
const { serialize } = await import(`${dir}/serialize.js`);
const { SAMPLE_PROMPT } = await import(`${dir}/standard.js`);
const jslayd = await import(`${dir}/serialize.js`);
const { convert } = await import("../../../supabase/scripts/migrate-designs-to-jslayd.mjs");
const { buildEdgeModules } = await import("../../../supabase/scripts/build-edge.mjs");

const edge = buildEdgeModules();
const { slideTemplates } = await import(`${edge}/templates/index.js`);

/**
 * A design opened for editing must be the design, not something like it.
 *
 * The built-in designs were translated from TypeScript and carry no prompt, and
 * an imported `.jslayd` was compiled elsewhere. Both are edited through the text
 * the decompiler produces, so if that text compiles to anything other than the
 * document it came from, editing quietly rewrites the design. Byte equality is
 * the only check worth making here.
 */
function roundTrip(document, label) {
  const prompt = decompile(document);
  const { document: again, diagnostics } = compile(prompt);
  assert.ok(again, `${label}: the decompiled prompt did not compile:\n${
    diagnostics.errors.slice(0, 8).map((item) => `  line ${item.line}: ${item.message}`).join("\n")}`);
  const before = serialize(document);
  const after = serialize(again);
  if (before !== after) {
    const at = [...before].findIndex((ch, index) => ch !== after[index]);
    assert.fail(`${label}: the round trip changed the design at byte ${at}\n`
      + `  was: …${before.slice(Math.max(0, at - 90), at + 90)}…\n`
      + `  now: …${after.slice(Math.max(0, at - 90), at + 90)}…`);
  }
  return prompt;
}

test("the sample design survives a decompile and recompile unchanged", () => {
  const { document } = compile(SAMPLE_PROMPT);
  roundTrip(document, "sample");
});

test("every built-in design can be edited as text without changing", () => {
  for (const template of slideTemplates) {
    roundTrip(convert(template), template.code);
  }
});

test("the decompiled prompt is a prompt, not a dump", () => {
  const { document } = compile(SAMPLE_PROMPT);
  const prompt = decompile(document);
  assert.ok(prompt.startsWith("JSLAYD-DESIGN 1.0"), "it must open with the header the compiler requires");
  for (const section of ["[DESIGN]", "[COLOR_FAMILY]", "[CHART_PALETTE]", "[FONTS]", "[VISUAL_DNA]", "[SLIDE "]) {
    assert.ok(prompt.includes(section), `missing ${section}`);
  }
  // Written for a person to edit: the colours are named by role, not by hex.
  assert.ok(/\ncolor: text\n/.test(prompt), "element colours should still name their role");
});

test("a design with several colour families keeps all of them", () => {
  const document = convert(slideTemplates[0]);
  const prompt = roundTrip(document, "families");
  assert.equal(document.colorFamilies.length, 8);
  for (const family of document.colorFamilies.slice(1)) {
    assert.ok(prompt.includes(`[COLOR_FAMILY ${family.code}]`), `missing family ${family.code}`);
  }
});

/**
 * Production stores the compiled document in a `jsonb` column, and Postgres does
 * not keep key order. What comes back out of the database is therefore not the
 * object that went in — it is the same data, shuffled. The editor reads it
 * through `readDocument` for exactly that reason, and this is the check that the
 * path an admin actually takes recovers the design, not merely the path a test
 * takes.
 */
function shuffleKeys(value) {
  if (Array.isArray(value)) return value.map(shuffleKeys);
  if (value && typeof value === "object") {
    const keys = Object.keys(value).reverse();
    return Object.fromEntries(keys.map((key) => [key, shuffleKeys(value[key])]));
  }
  return value;
}

test("a design read back out of the database is still exactly itself", () => {
  const { readDocument } = jslayd;
  for (const template of slideTemplates) {
    const stored = shuffleKeys(JSON.parse(JSON.stringify(convert(template))));
    const { document, diagnostics } = readDocument(stored);
    assert.ok(document, `${template.code}: the stored document did not read back:\n${
      diagnostics.errors.slice(0, 5).map((item) => `  ${item.message}`).join("\n")}`);
    roundTrip(document, `${template.code} (jsonb)`);
  }
});

test("editing the decompiled text changes the design and nothing else", () => {
  const { document } = compile(SAMPLE_PROMPT);
  const edited = decompile(document).replace("name: Apelsen Futuristik", "name: Apelsen Tungi");
  const { document: after, diagnostics } = compile(edited);
  assert.deepEqual(diagnostics.errors, []);
  assert.equal(after.design.name, "Apelsen Tungi");
  // Everything but the name is untouched, which is what makes the editor safe.
  assert.equal(serialize({ ...after, design: document.design }), serialize(document));
});
