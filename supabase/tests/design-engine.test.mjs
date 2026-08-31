import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

/**
 * How a deck stops being made by the engine it is supposed to be made by.
 *
 * Not by anybody deciding to go back. The generative engine was written, wired,
 * switched on by a setting and tested — and new decks kept coming out of the
 * old template path, because everything around that switch still belonged to
 * the old one: the switch read "absent" as "off", a template was required
 * before a credit was reserved, the design was loaded before the outline and
 * named in the planning prompt, and the restriction that was meant to stop all
 * of that was read by the admin panel and by no backend path at all.
 *
 * Every one of those is silent. So each is a test.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");

const PIPELINE = read("supabase/functions/_shared/pipeline.ts");
const ENTRY = read("supabase/functions/generate-presentation/index.ts");
const MIGRATION = read("supabase/migrations/202609010001_generative_default.sql");

const edge = buildEdgeModules();
const { engineSwitchOn, DESIGN_SETTINGS } = await import(`${edge}/design-engine.js`);

test("only a real `false` turns the engine off — absence never does", () => {
  assert.equal(engineSwitchOn({ value: true }), true, "an explicit true is on");
  assert.equal(engineSwitchOn({ value: false }), false, "an explicit false is the one way off");

  // The three ways the answer goes missing, which used to mean "old engine".
  assert.equal(engineSwitchOn(null), true, "a missing row is not a vote");
  assert.equal(engineSwitchOn(undefined), true, "an absent answer is not a vote");
  assert.equal(engineSwitchOn(null, true), true, "an unreadable setting is not a vote");
  assert.equal(engineSwitchOn({ value: true }, true), true, "a failed read stays on even with a row in hand");

  // A value that is not a boolean is a misconfiguration, and a misconfiguration
  // must not be able to switch the product back to the old engine by accident.
  for (const odd of [null, undefined, "false", 0, ""]) {
    assert.equal(engineSwitchOn({ value: odd }), true, `${JSON.stringify(odd)} is not false`);
  }

  assert.equal(DESIGN_SETTINGS.generative, "design.generative_enabled");
  assert.equal(DESIGN_SETTINGS.legacyRestricted, "design.legacy_restricted");
});

test("the engine is chosen before a design is read, not after", () => {
  /**
   * The ordering *is* the bug. While the design was resolved first, a deck the
   * generative engine would compose still could not be made unless a legacy
   * template loaded — so a withdrawn design could fail a generation that was
   * never going to use one.
   */
  const decided = PIPELINE.indexOf("design_engine_selected");
  const loaded = PIPELINE.indexOf("await loadJslaydDesign(");
  assert.ok(decided > 0, "the engine decision is not logged");
  assert.ok(loaded > 0, "the design load moved — this test needs rewriting");
  assert.ok(decided < loaded, "a JSLAYD design is still resolved before the engine is chosen");

  assert.match(
    PIPELINE,
    /const jslayd = engine\.generative \? null : await loadJslaydDesign\(/,
    "the generative path still loads a legacy design",
  );
});

test("the planner is told about a design only when there is one", () => {
  // The prompt used to name the chosen design and forbid the model from
  // proposing colours or fonts — under an engine whose whole job is to propose
  // colours and fonts, from the plan this prompt produces.
  assert.ok(
    !/\nTanlangan dizayn: \$\{jslayd\.document/.test(PIPELINE),
    "the outline prompt names a design unconditionally",
  );
  assert.match(
    PIPELINE,
    /\$\{jslayd \? `\\nTanlangan dizayn:/,
    "the design line is not conditional on a design existing",
  );
  assert.match(PIPELINE, /const system = jslayd\s*\n?\s*\?/, "the planner's system prompt does not vary by engine");
});

test("the legacy restriction is enforced in the pipeline, not just drawn in the admin panel", () => {
  assert.match(PIPELINE, /import \{[^}]*legacyRestricted[^}]*\} from "\.\/scene-generation\.ts"/,
    "the pipeline does not read the restriction");
  assert.match(
    PIPELINE,
    /if \(!engine\.generative && engine\.legacyRestricted\) \{\s*\n\s*throw new Error\(/,
    "a restricted legacy run is not refused",
  );
});

test("no silent fallback: the generative path returns, it never falls through to templates", () => {
  const branch = PIPELINE.indexOf("if (engine.generative) {");
  assert.ok(branch > 0, "the generative branch is gone");
  const body = PIPELINE.slice(branch, branch + 1600);
  assert.match(body, /await runGenerative\(\{/, "the branch does not run the generative engine");
  assert.match(body, /\n      return;\n/, "the generative branch can fall through into the template path");
  // A `catch` around the generative run that continued into JSLAYD would be the
  // fallback the brief forbids, wearing a different shape.
  assert.ok(!/catch[\s\S]{0,200}planDeckLayout/.test(PIPELINE), "a failed generative run falls back to layout planning");
});

test("the template selector does not run when there is no template to select", () => {
  assert.match(ENTRY, /const generative = await generativeEnabled\(context\.serviceClient\);/,
    "the entry point does not ask which engine is running");
  assert.match(ENTRY, /if \(generative\) \{[\s\S]{0,400}?\} else \{[\s\S]*?await chooseDesign\(/,
    "chooseDesign still runs on generative requests");
  assert.match(ENTRY, /design_selection_skipped/, "a skipped selection is not logged");
});

test("a reservation stops demanding a template for a deck that will not use one", () => {
  assert.match(MIGRATION, /if v_generative then[\s\S]{0,400}?v_design_id := null;/,
    "the RPC still pins a design under the generative engine");
  // And the legacy branch keeps the rule it was written for.
  assert.match(MIGRATION, /raise exception 'Dizayn tanlanmagan\.'/,
    "the legacy path no longer requires a published design");
  assert.match(MIGRATION, /coalesce\(v_generative, true\)/,
    "a missing setting does not default to the generative engine in SQL");
  assert.match(MIGRATION, /on conflict \(key\) do update/,
    "the settings are seeded rather than set, so a wrong value would survive");
});

test("every run says which engine made it, in terms that can be grepped", () => {
  for (const field of ["DESIGN_ENGINE", "LEGACY_RESTRICTED", "LEGACY_TEMPLATE_USED", "JSLAYD_DESIGN_AUTHORITY"]) {
    assert.ok(PIPELINE.includes(field), `${field} is not logged`);
  }
  assert.match(PIPELINE, /DESIGN_ENGINE: engine\.generative \? "generative_v1" : "jslayd"/,
    "the logged engine name is not derived from the decision");
});
