import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const {
  deckHasVisualStatistic, isVisualStatistic, requireVisualStatistic, diversifyChartTypes } = await import(`${edge}/visual-statistic.js`);
const { slideSchema } = await import(`${edge}/plan-schema.js`);

const slide = (title, layout = "title_body", purpose = "Mavzuni tushuntirish") => ({
  title, layout, purpose, visualPrompt: null,
});

test("an existing chart plan is preserved", () => {
  const input = [slide("Kirish"), slide("Taqqoslash", "chart")];
  const output = requireVisualStatistic(input);
  assert.deepEqual(output, input);
  assert.notEqual(output, input, "the normaliser must not mutate the model answer");
});

test("a numeric/statistic slide becomes the required chart", () => {
  const output = requireVisualStatistic([
    slide("Ta’rif"),
    slide("Asosiy ko‘rsatkich", "statistic", "Natijani raqam bilan ko‘rsatish"),
    slide("Xulosa", "conclusion"),
  ]);
  assert.equal(output[1].layout, "chart");
  assert.match(output[1].purpose, /2–8/);
  assert.equal(output[0].layout, "title_body");
  assert.equal(output[2].layout, "conclusion");
});

test("a narrative outline receives a middle chart without losing its title", () => {
  const input = [slide("A"), slide("B"), slide("C"), slide("D"), slide("E", "conclusion")];
  const output = requireVisualStatistic(input);
  const at = output.findIndex((entry) => entry.layout === "chart");
  assert.ok(at > 0 && at < output.length - 1);
  assert.equal(output[at].title, input[at].title);
});

test("only drawable bar or donut datasets satisfy the invariant", () => {
  const bar = { type: "bar", labels: ["2024", "2025"], values: [12, 18] };
  const donut = { type: "donut", labels: ["A", "B"], values: [40, 60] };
  assert.equal(isVisualStatistic(bar), true);
  assert.equal(isVisualStatistic(donut), true);
  assert.equal(deckHasVisualStatistic([{ chart: null }, { chart: bar }]), true);

  for (const invalid of [
    null,
    { type: "line", labels: ["A", "B"], values: [1, 2] },
    { type: "bar", labels: ["A"], values: [1] },
    { type: "bar", labels: ["A", "B"], values: [1] },
    { type: "donut", labels: ["A", "B"], values: [0, 0] },
    { type: "donut", labels: ["A", "B"], values: [-1, 2] },
  ]) assert.equal(isVisualStatistic(invalid), false, JSON.stringify(invalid));
});

test("the required slide schema makes chart non-null and limits it to pie/bar", () => {
  const schema = slideSchema({ requireVisualStatistic: true });
  const chart = schema.properties.chart;
  assert.equal(chart.type, "object");
  assert.deepEqual(chart.properties.type.enum, ["bar", "donut"]);
  assert.equal("anyOf" in chart, false, "null must not be accepted on the required slide");
});

test("every code-design corpus member has a visible chart archetype", () => {
  const corpus = JSON.parse(readFileSync(new URL("../../packages/jslayd/tests/fixtures/design-corpus.json", import.meta.url), "utf8"));
  assert.ok(corpus.length >= 3);
  for (const document of corpus) {
    assert.ok(document.archetypes.some((archetype) =>
      archetype.selection?.supportsChart
      && archetype.elements?.some((element) => element.type === "chart")),
    `${document.design?.slug ?? "unknown"} must be able to render the mandatory chart`);
  }
});

test("two charts in a row are not the same chart", () => {
  const slides = [
    { chart: { type: "bar", labels: ["a", "b"], values: [3, 4] } },
    { chart: { type: "bar", labels: ["c", "d"], values: [5, 6] } },
  ];
  const out = diversifyChartTypes(slides);
  assert.equal(out[0].chart.type, "bar");
  assert.equal(out[1].chart.type, "donut");
  // The numbers are never touched, only the shape they are drawn in.
  assert.deepEqual(out[1].chart.values, [5, 6]);
});

test("charts separated by text slides still alternate", () => {
  const slides = [
    { chart: { type: "donut", labels: ["a", "b"], values: [3, 4] } },
    { chart: null },
    { chart: { type: "donut", labels: ["c", "d"], values: [5, 6] } },
  ];
  const out = diversifyChartTypes(slides);
  assert.equal(out[0].chart.type, "donut");
  assert.equal(out[2].chart.type, "bar");
});

test("a series a doughnut cannot draw stays a bar", () => {
  const slides = [
    { chart: { type: "bar", labels: ["a", "b"], values: [3, 4] } },
    { chart: { type: "bar", labels: ["c", "d"], values: [-2, 6] } },
  ];
  const out = diversifyChartTypes(slides);
  // A negative share has no geometry. A repeated shape is the honest answer.
  assert.equal(out[1].chart.type, "bar");
});

test("three charts alternate rather than settling on one shape", () => {
  const slides = [1, 2, 3].map(() => ({ chart: { type: "bar", labels: ["a", "b"], values: [3, 4] } }));
  const out = diversifyChartTypes(slides);
  assert.deepEqual(out.map((slide) => slide.chart.type), ["bar", "donut", "bar"]);
});
