import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { runSceneCycle, validateScene } = await import(`${edge}/scene-cycle.js`);

const sound = () => ({
  purpose: "explain",
  background: { kind: "solid", color: "background" },
  elements: [
    { type: "text", role: "title", place: { column: 0, span: 7, row: 1, rows: 2 }, typography: { font: "display", step: "title", color: "ink" }, text: "Sarlavha" },
    { type: "text", role: "body", place: { column: 0, span: 6, row: 3, rows: 4 }, typography: { font: "body", step: "body", color: "ink" }, text: "Mazmunli jumla. ".repeat(10) },
    { type: "image", place: { column: 7, span: 5, row: 1, rows: 6 }, treatment: "rounded", intent: { query: "Orol", orientation: "portrait" } },
  ],
});

const colliding = () => {
  const scene = sound();
  scene.elements[1].place = { column: 0, span: 7, row: 1, rows: 2 };
  return scene;
};

test("a sound slide is accepted on the first attempt", async () => {
  let calls = 0;
  const result = await runSceneCycle(async () => { calls += 1; return sound(); });
  assert.equal(result.accepted, true);
  assert.equal(calls, 1, "no repair is asked for when nothing is wrong");
  assert.equal(result.report.score, 100);
});

test("a faulty slide is repaired and the repair is what ships", async () => {
  const answers = [colliding(), sound()];
  const seen = [];
  const result = await runSceneCycle(async (previous) => {
    seen.push(previous ? previous.report.score : null);
    return answers.shift();
  });
  assert.equal(result.accepted, true);
  assert.equal(result.attempts, 2);
  // The repair call is told what the previous attempt scored.
  assert.equal(seen[0], null);
  assert.ok(seen[1] < 90);
});

test("a slide that never passes is reported, not shipped as ready", async () => {
  const result = await runSceneCycle(async () => colliding(), { maxAttempts: 3 });
  assert.equal(result.accepted, false);
  assert.equal(result.attempts, 3);
  assert.ok(result.scene, "the best attempt is still returned for the caller to decide");
  assert.ok(result.report.score < 90);
});

test("the best attempt ships, not the last one", async () => {
  // A repair that makes things worse must not win by being last.
  const answers = [colliding(), sound(), { elements: [] }];
  const result = await runSceneCycle(async () => answers.shift(), { threshold: 200, maxAttempts: 3 });
  assert.equal(result.accepted, false, "an impossible threshold is never met");
  assert.equal(result.report.score, 100, "the sound attempt is the one kept");
});

test("a scene that does not read is an attempt with a named problem", async () => {
  const result = await runSceneCycle(async () => ({ background: {}, elements: [{ type: "text" }] }), { maxAttempts: 1 });
  assert.equal(result.accepted, false);
  assert.equal(result.scene, null);
  assert.ok(result.history[0].faults.some((fault) => fault.includes("placement is missing")), JSON.stringify(result.history));
});

test("every attempt's score is kept for the audit", async () => {
  const answers = [colliding(), colliding(), sound()];
  const result = await runSceneCycle(async () => answers.shift());
  assert.deepEqual(result.history.map((entry) => entry.attempt), [1, 2, 3]);
  assert.ok(result.history[0].faults.includes("collision"));
  assert.equal(result.history[2].score, 100);
});

test("validation refuses to score a scene it could not read", () => {
  const validation = validateScene({ elements: "not an array" });
  assert.equal(validation.report, null);
  assert.ok(validation.problems.length > 0);
});
