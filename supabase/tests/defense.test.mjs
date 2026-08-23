import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { defensePrompt, isUsable, readDefense } = await import(`${edge}/defense.js`);

/**
 * The script a person reads while standing beside their deck.
 *
 * What matters here is not the prose — that is the model's job — but that the
 * document always lines up with the deck it describes. A section placed against
 * the wrong slide is worse than a section missing: the speaker discovers it
 * mid-sentence, in front of a room.
 */

const deck = (count) => Array.from({ length: count }, (_, index) => ({
  position: index,
  title: `${index + 1}-slayd sarlavhasi`,
  text: index === 0 ? "" : `Slaydning matni ${index}`,
}));

const section = (n, over = {}) => ({
  slide_number: n,
  slide_title: `${n}-slayd sarlavhasi`,
  speaker_text: `Bu ${n}-slayd uchun yetarlicha uzun nutq matni.`,
  key_point: "Asosiy fikr",
  transition_to_next: "Endi keyingisiga o‘tamiz.",
  ...over,
});

test("there is one section per slide, whatever the model returned", () => {
  const slides = deck(5);
  // Three sections for five slides, out of order, one numbered beyond the deck.
  const script = readDefense({
    introduction: "Kirish",
    conclusion: "Xulosa",
    sections: [section(4), section(1), section(9)],
  }, slides);

  assert.equal(script.sections.length, 5);
  assert.deepEqual(script.sections.map((entry) => entry.slide_number), [1, 2, 3, 4, 5]);
});

test("a gap is left as a gap, never closed up", () => {
  const script = readDefense({
    introduction: "Kirish",
    conclusion: "Xulosa",
    sections: [section(1), section(3)],
  }, deck(3));

  // Slide 2 has nothing to say. Closing the gap would put slide 3's speech
  // against slide 2 and leave the speaker a sentence behind for the rest of it.
  assert.equal(script.sections[1].speaker_text, "");
  assert.match(script.sections[2].speaker_text, /3-slayd/);
});

test("a section with no title falls back to the slide's own", () => {
  const script = readDefense({
    introduction: "K", conclusion: "X",
    sections: [section(1, { slide_title: "" })],
  }, deck(1));
  assert.equal(script.sections[0].slide_title, "1-slayd sarlavhasi");
});

test("rubbish from the model is not shipped as a script", () => {
  assert.equal(isUsable(readDefense(null, deck(4))), false);
  assert.equal(isUsable(readDefense({ introduction: "Kirish", sections: [] }, deck(4))), false);
});

test("half the deck written is enough to show somebody", () => {
  const script = readDefense({
    introduction: "Kirish matni",
    conclusion: "Xulosa",
    sections: [section(1), section(2)],
  }, deck(4));
  assert.equal(isUsable(script), true);
});

test("an opening with no sections behind it is not a script", () => {
  const script = readDefense({ introduction: "", sections: [section(1)], conclusion: "" }, deck(1));
  assert.equal(isUsable(script), false);
});

/**
 * The prompt asks for a length per slide rather than one length for all of them.
 *
 * A cover needs a greeting; a slide of six bullets needs a minute. Asking for
 * "30–60 soniya" everywhere pads the title slide and rushes the one that
 * mattered.
 */
test("a fuller slide is given more time to talk than an empty one", () => {
  const prompt = defensePrompt({
    topic: "Test",
    authorName: null,
    teacherName: null,
    organization: null,
    slides: [
      { position: 0, title: "Muqova", text: "" },
      { position: 1, title: "Tahlil", text: "bir ".repeat(60) },
    ],
  });
  const seconds = [...prompt.matchAll(/"soniya":(\d+)/g)].map((match) => Number(match[1]));
  assert.equal(seconds.length, 2);
  assert.ok(seconds[1] > seconds[0], `${seconds[1]} should exceed ${seconds[0]}`);
  assert.ok(seconds[1] <= 75);
});

test("the prompt refuses invented numbers out loud", () => {
  const prompt = defensePrompt({
    topic: "Test", authorName: null, teacherName: null, organization: null,
    slides: [{ position: 0, title: "A", text: "b" }],
  });
  assert.match(prompt, /O‘YLAB TOPMANG/);
  assert.match(prompt, /takrori EMAS/);
});
