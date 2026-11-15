import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { mapTestQuestion, spreadAnswers } = await import(`${edge}/test-questions.js`);
const same = (text) => text;

test("a question keeps its right answer and as many wrong ones as the sheet has bubbles", () => {
  const row = mapTestQuestion({ prompt: "2 + 2?", options: ["3", "4", "5", "6", "7"], correct_index: 1, explanation: "" }, 4, same);
  assert.equal(row.options.length, 4);
  assert.equal(row.options[row.correct], "4");
  assert.equal(new Set(row.options).size, 4);
});

test("a question that cannot be fair is dropped: too few options, a repeated option, no right one", () => {
  assert.equal(mapTestQuestion({ prompt: "x?", options: ["a", "b"], correct_index: 0, explanation: "" }, 4, same), null);
  assert.equal(mapTestQuestion({ prompt: "x?", options: ["a", "A", "b", "c"], correct_index: 0, explanation: "" }, 4, same), null);
  assert.equal(mapTestQuestion({ prompt: "x?", options: ["a", "b", "c", "d"], correct_index: 7, explanation: "" }, 4, same), null);
  assert.equal(mapTestQuestion({ prompt: "", options: ["a", "b", "c", "d"], correct_index: 0, explanation: "" }, 4, same), null);
});

test("the right answers are spread over every letter, and the same test always lays out the same", () => {
  const questions = Array.from({ length: 40 }, (_, at) => ({ prompt: `q${at}`, options: [`r${at}`, "w1", "w2", "w3"], correct: 0, explanation: "" }));
  const spread = spreadAnswers(questions, "test-id");
  const counts = [0, 0, 0, 0];
  spread.forEach((question, at) => {
    counts[question.correct] += 1;
    assert.equal(question.options[question.correct], `r${at}`, "the right answer moves with its letter");
  });
  assert.deepEqual(counts, [10, 10, 10, 10]);
  assert.deepEqual(spreadAnswers(questions, "test-id"), spread);
  assert.notDeepEqual(spreadAnswers(questions, "another"), spread);
});
