import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * One engine, and no way back to the retired ones.
 *
 * Every deck is composed by the Liquid Glass engine, which invents the deck's
 * design during generation. The published JSLAYD designs, the PowerPoint
 * templates and the scene engine are retired — and "retired" has to mean that
 * no path reaches them: not a setting, not a slug an old build sends, not a
 * fallback added in a hurry. These read the source, because a regression here
 * does not fail loudly; it quietly ships a deck in an old design.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");

const PIPELINE = read("supabase/functions/_shared/pipeline.ts");
const GENERATE = read("supabase/functions/generate-presentation/index.ts");
const CREATE_SCREEN = read("user/app/(app)/create.tsx");
const latestMigrationDefining = (name) => {
  const folder = path.join(repoRoot, "supabase/migrations");
  const files = readdirSync(folder).filter((file) => file.endsWith(".sql")).sort();
  const hits = files.filter((file) => new RegExp(`function public\\.${name}\\(`).test(readFileSync(path.join(folder, file), "utf8")));
  return readFileSync(path.join(folder, hits.at(-1)), "utf8");
};

test("every generation is composed by the Liquid Glass engine", () => {
  assert.match(PIPELINE, /totalCost \+= await runGlass\(/, "the pipeline does not hand the deck to runGlass");
  assert.match(PIPELINE, /DESIGN_ENGINE: "glass_v1"/, "the run does not say which engine made it");
  assert.match(PIPELINE, /design_engine: "glass_v1"/, "the deck is not recorded as a glass deck");
});

test("no retired engine is reachable from the pipeline", () => {
  for (const retired of ["planDeckLayout", "buildJslaydSlides", "loadJslaydDesign", "composeGenerativeDeck", "chooseDesign", "templatePrompt", "generativeEnabled", "legacyRestricted"]) {
    assert.ok(!new RegExp(`\\b${retired}\\b`).test(PIPELINE), `pipeline still references ${retired}`);
  }
  for (const retired of ["chooseDesign", "generativeEnabled", "designSlug(body", "designCode("]) {
    assert.ok(!GENERATE.includes(retired), `generate-presentation still references ${retired}`);
  }
});

test("a design slug or palette from an older build is never forwarded", () => {
  assert.match(GENERATE, /p_palette_code: null,\s*p_design_slug: null,/, "the RPC is still given a design");
});

test("a reservation never resolves a published design", () => {
  const sql = latestMigrationDefining("start_generation");
  const body = sql.slice(sql.indexOf("function public.start_generation("));
  const fn = body.slice(0, body.indexOf("$$;"));
  assert.ok(!/presentation_designs/.test(fn), "start_generation still reads the design catalogue");
  assert.match(fn, /'glass_v1'/, "start_generation does not mark the deck as a glass deck");
});

test("the author's requirements reach the prompts", () => {
  assert.match(GENERATE, /requirementsOf\(body\.requirements\)/, "generate-presentation drops the requirements");
  assert.match(PIPELINE, /requirements/, "the pipeline never reads the requirements");
});

test("the create screen offers no design picker, and sources and requirements are buttons", () => {
  assert.ok(!/DesignPicker|loadRemoteDesigns|generativeDesign/.test(CREATE_SCREEN), "a design catalogue is still offered");
  assert.match(CREATE_SCREEN, /title="Manbalar"/, "Manbalar is not a button");
  assert.match(CREATE_SCREEN, /title="Talablar"/, "Talablar is not a button");
  assert.match(CREATE_SCREEN, /requirements: requirements\.trim\(\) \|\| null/, "requirements are not sent");
  assert.ok(!/<FormField[^>]*label="Foydalanilgan manbalar"/.test(CREATE_SCREEN), "sources are still an inline text area");
});
