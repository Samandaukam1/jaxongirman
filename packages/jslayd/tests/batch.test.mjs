import assert from "node:assert/strict";
import test from "node:test";

import { buildJslayd } from "./build.mjs";

const dir = buildJslayd();
const { inspectBatch, readBatch, summarise } = await import(`${dir}/batch.js`);
const { SAMPLE_PROMPT } = await import(`${dir}/standard.js`);

/**
 * A hundred designs arriving at once, and the report that has to come back
 * before any of them is written anywhere.
 */

const batchOf = (...sources) => ({ schemaVersion: 1, slides: sources.map((source) => ({ source })) });

test("a batch is read, and anything that is not one is refused by name", () => {
  const good = readBatch(JSON.stringify(batchOf(SAMPLE_PROMPT)));
  assert.equal(good.error, null);
  assert.equal(good.batch.slides.length, 1);

  // The mistake to plan for: one design pasted into the box that wants many.
  const single = readBatch(SAMPLE_PROMPT);
  assert.equal(single.batch, null);
  assert.match(single.error, /bitta dizayn/);

  assert.match(readBatch("{}").error, /schemaVersion/);
  assert.match(readBatch(JSON.stringify({ schemaVersion: 1, slides: [] })).error, /bo‘sh/);
  assert.match(readBatch("not json at all").error, /JSON/);
});

test("a slide may be a bare string or an object, and both mean the same thing", () => {
  const asObjects = readBatch(JSON.stringify({ schemaVersion: 1, slides: [{ source: SAMPLE_PROMPT }] }));
  const asStrings = readBatch(JSON.stringify({ schemaVersion: 1, slides: [SAMPLE_PROMPT] }));
  assert.equal(asObjects.batch.slides[0].source, asStrings.batch.slides[0].source);
});

test("the shipped sample compiles, and the report describes it", () => {
  const report = inspectBatch(batchOf(SAMPLE_PROMPT));
  assert.equal(report.total, 1);
  assert.equal(report.valid, 1, report.entries[0].errors.map((d) => d.message).join("; "));
  assert.equal(report.invalid, 0);
  assert.ok(report.entries[0].document, "no document came back");
  assert.ok(report.entries[0].health, "no health report");
  assert.ok(report.fonts.length > 0, "a design with no fonts is not a design");
});

test("one bad design in a batch does not take the good ones with it", () => {
  /**
   * The failure this exists to prevent: ninety-one saves and a surprise. The
   * batch is judged whole, before anything is written.
   */
  const report = inspectBatch(batchOf(SAMPLE_PROMPT, "JSLAYD-DESIGN 1.0\n[DESIGN]\nname = ", SAMPLE_PROMPT));
  assert.equal(report.total, 3);
  assert.equal(report.valid, 2);
  assert.equal(report.invalid, 1);
  assert.equal(report.entries[1].valid, false);
  assert.ok(report.entries[1].errors.length > 0, "an invalid design with no error to show");
  assert.ok(report.entries[0].valid && report.entries[2].valid);
});

test("an entry can be found again by its position and its name", () => {
  const report = inspectBatch(batchOf("nonsense", SAMPLE_PROMPT));
  assert.deepEqual(report.entries.map((entry) => entry.index), [0, 1]);
  assert.equal(report.entries[0].name, "#1", "a nameless failure still has to be identifiable");
  assert.ok(report.entries[1].name.length > 1);
});

test("the report counts what generation will need, not what the file contains", () => {
  const report = inspectBatch(batchOf(SAMPLE_PROMPT));
  const entry = report.entries[0];
  // Counted off the archetypes' own selection rules — the same rules the
  // generator consults — rather than by looking for image elements.
  assert.equal(typeof entry.needsImage, "number");
  assert.equal(typeof entry.dataCapable, "number");
  assert.ok(entry.needsImage <= entry.document.archetypes.length);
  assert.ok(entry.dataCapable <= entry.document.archetypes.length);
});

test("the summary says the things somebody decides on", () => {
  const lines = summarise(inspectBatch(batchOf(SAMPLE_PROMPT, "broken")));
  assert.ok(lines.some((line) => /1 ta yaroqli/.test(line)));
  assert.ok(lines.some((line) => /1 ta xato/.test(line)));
  assert.ok(lines.some((line) => /shrift oilasi/.test(line)));
});
