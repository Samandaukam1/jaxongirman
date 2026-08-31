import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { generateDeck, GenerativeFailure } = await import(`${edge}/scene-pipeline.js`);

const library = [
  { name: "Playfair Display", category: "serif" },
  { name: "Inter", category: "sans-serif" },
  { name: "JetBrains Mono", category: "monospace" },
];

const sound = (title) => ({
  purpose: title,
  background: { kind: "solid", color: "background" },
  elements: [
    { type: "text", role: "title", place: { column: 0, span: 7, row: 1, rows: 2 }, typography: { font: "display", step: "title", color: "ink" }, text: title },
    { type: "text", role: "body", place: { column: 0, span: 6, row: 3, rows: 4 }, typography: { font: "body", step: "body", color: "ink" }, text: "Mazmunli jumla. ".repeat(10) },
    { type: "image", place: { column: 7, span: 5, row: 1, rows: 6 }, treatment: "rounded", intent: { query: `${title} rasmi`, orientation: "portrait" } },
  ],
});

/** A different arrangement, for decks that need a second slide. */
const other = (title) => ({
  purpose: title,
  background: { kind: "solid", color: "surface" },
  elements: [
    { type: "text", role: "title", place: { column: 2, span: 8, row: 0, rows: 2 }, typography: { font: "display", step: "heading", color: "ink" }, text: title },
    { type: "chart", place: { column: 2, span: 8, row: 2, rows: 5 }, chart: { kind: "bar", labels: ["a", "b", "c"], values: [3, 7, 5] } },
  ],
});

const colliding = (title) => {
  const scene = sound(title);
  scene.elements[1].place = { column: 0, span: 7, row: 1, rows: 2 };
  return scene;
};

/** A model that answers each schema with whatever the test hands it. */
const model = (answers) => {
  const calls = [];
  const ask = async ({ schemaName, prompt }) => {
    calls.push({ schemaName, prompt });
    const queue = answers[schemaName];
    if (!queue) throw new Error(`no answer for ${schemaName}`);
    return typeof queue === "function" ? queue(calls) : (queue.length > 1 ? queue.shift() : queue[0]);
  };
  return { ask, calls };
};

const deps = (over = {}) => ({
  fonts: async () => library,
  findImage: async () => ({ bucket: "stock-images", path: "a/b.jpg" }),
  ...over,
});

test("a deck is produced with a design language and one scene per slide", async () => {
  const { ask, calls } = model({
    design_direction: [{ mood: "editorial", ground: "near_black", brand: "#5A78F0", cornerLanguage: "soft", gradients: true, reason: "r" }],
    slide_brief: [{ slideGoal: "g", mainMessage: "m", supportingMessage: null, informationDensity: 0.6, visualPriority: 0.4, needs: { image: true, chart: false, statistic: false, quote: false, comparison: false, timeline: false, example: false } }],
    slide_scene: (seen) => {
      const at = seen.filter((call) => call.schemaName === "slide_scene").length;
      return at === 1 ? sound("Bir") : other("Ikki");
    },
  });
  const deck = await generateDeck(deps({ ask }), { topic: "Suv", slides: [{ title: "Bir" }, { title: "Ikki" }] });

  assert.equal(deck.engine, "generative_v1");
  assert.equal(deck.slides.length, 2);
  assert.ok(deck.slides.every((slide) => slide.accepted));
  assert.equal(deck.observability.repairCount, 0);
  // The visual language is settled once, not per slide.
  assert.equal(calls.filter((call) => call.schemaName === "design_direction").length, 1);
});

test("the fonts come from the library the operator enabled", async () => {
  const { ask } = model({
    design_direction: [{ mood: "geometric", ground: "cool_white", brand: "#123456", cornerLanguage: "sharp", gradients: false }],
    slide_brief: [{}],
    slide_scene: () => sound("Bir"),
  });
  const deck = await generateDeck(deps({ ask }), { topic: "Robotlar", slides: [{ title: "Bir" }] });
  for (const name of Object.values(deck.dna.fonts)) {
    assert.ok(library.some((family) => family.name === name), `invented ${name}`);
  }
  assert.equal(deck.observability.fontSelection.display, deck.dna.fonts.display);
});

test("an empty font library stops the deck instead of guessing a face", async () => {
  const { ask } = model({ design_direction: [{}], slide_brief: [{}], slide_scene: () => sound("Bir") });
  await assert.rejects(
    () => generateDeck(deps({ ask, fonts: async () => [] }), { topic: "T", slides: [{ title: "Bir" }] }),
    (error) => error instanceof GenerativeFailure && error.code === "no_font_library",
  );
});

test("a faulty composition is repaired, and the repair is counted", async () => {
  let scenes = 0;
  const { ask } = model({
    design_direction: [{ mood: "civic", ground: "warm_white", brand: "#5A78F0", cornerLanguage: "soft", gradients: true }],
    slide_brief: [{}],
    slide_scene: () => { scenes += 1; return scenes === 1 ? colliding("Bir") : sound("Bir"); },
  });
  const deck = await generateDeck(deps({ ask }), { topic: "T", slides: [{ title: "Bir" }] });
  assert.equal(deck.slides[0].accepted, true);
  assert.equal(deck.slides[0].attempts, 2);
  assert.equal(deck.observability.repairCount, 1);
});

test("a slide that never passes is replaced, and says so", async () => {
  const { ask } = model({
    design_direction: [{ mood: "civic", ground: "warm_white", brand: "#5A78F0", cornerLanguage: "soft", gradients: true }],
    slide_brief: [{}],
    slide_scene: () => colliding("Bir"),
  });
  const deck = await generateDeck(deps({ ask }), { topic: "T", slides: [{ title: "Bir" }], maxAttempts: 2 });
  // Not accepted — the model never produced a sound page — but what ships is
  // the plain one built from the brief rather than the broken one.
  assert.equal(deck.slides[0].accepted, false);
  assert.equal(deck.slides[0].synthesised, true);
  assert.deepEqual(deck.observability.unacceptedSlides, [0]);
  assert.ok(deck.slides[0].score >= 90, `shipped a page scoring ${deck.slides[0].score}`);
  // The attempt's own faults stay in the history, where an audit can see them.
  assert.ok(deck.slides[0].attempts >= 2);
});

test("pictures are asked for once, and only for a composition that was kept", async () => {
  const asked = [];
  let scenes = 0;
  const { ask } = model({
    design_direction: [{ mood: "civic", ground: "warm_white", brand: "#5A78F0", cornerLanguage: "soft", gradients: true }],
    slide_brief: [{}],
    slide_scene: () => { scenes += 1; return scenes === 1 ? colliding("Bir") : sound("Bir"); },
  });
  await generateDeck(deps({ ask, findImage: async (intent) => { asked.push(intent.query); return null; } }), {
    topic: "T", slides: [{ title: "Bir" }],
  });
  // One request, despite two compositions having been generated.
  assert.deepEqual(asked, ["Bir rasmi"]);
});

test("an image the service cannot find costs the picture, not the deck", async () => {
  const { ask } = model({
    design_direction: [{ mood: "civic", ground: "warm_white", brand: "#5A78F0", cornerLanguage: "soft", gradients: true }],
    slide_brief: [{}],
    slide_scene: () => sound("Bir"),
  });
  const deck = await generateDeck(deps({ ask, findImage: async () => { throw new Error("provider down"); } }), {
    topic: "T", slides: [{ title: "Bir" }],
  });
  assert.equal(deck.slides[0].accepted, true);
  const image = deck.slides[0].rendered.elements.find((row) => row.type === "image");
  assert.equal(image.content.storagePath, undefined, "the frame is drawn empty");
});

test("a brief the model could not write falls back to what the outline knew", async () => {
  const { ask } = model({
    design_direction: [{ mood: "civic", ground: "warm_white", brand: "#5A78F0", cornerLanguage: "soft", gradients: true }],
    slide_brief: () => { throw new Error("refused"); },
    slide_scene: () => sound("Bir"),
  });
  const deck = await generateDeck(deps({ ask }), { topic: "T", slides: [{ title: "Suv taqchilligi" }] });
  assert.equal(deck.slides[0].brief.mainMessage, "Suv taqchilligi");
  assert.equal(deck.slides[0].accepted, true);
});

test("a malformed brand colour does not fail the deck", async () => {
  const { ask } = model({
    design_direction: [{ mood: "editorial", ground: "near_black", brand: "ko'k", cornerLanguage: "soft", gradients: true }],
    slide_brief: [{}],
    slide_scene: () => sound("Bir"),
  });
  const deck = await generateDeck(deps({ ask }), { topic: "T", slides: [{ title: "Bir" }] });
  assert.match(deck.dna.colors.primary, /^#[0-9a-f]{6}$/i);
});

test("a slide arranged like the one before it is repaired rather than kept", async () => {
  let scenes = 0;
  const { ask } = model({
    design_direction: [{ mood: "civic", ground: "warm_white", brand: "#5A78F0", cornerLanguage: "soft", gradients: true }],
    slide_brief: [{}],
    // The same arrangement twice, then a different one when asked again.
    slide_scene: () => { scenes += 1; return scenes <= 2 ? sound(`Slayd ${scenes}`) : other("Boshqacha"); },
  });
  const deck = await generateDeck(deps({ ask }), { topic: "T", slides: [{ title: "a" }, { title: "b" }] });
  assert.equal(deck.slides[1].accepted, true);
  assert.ok(deck.slides[1].attempts > 1, "the repeat was noticed while the slide was still being made");
  assert.deepEqual(deck.observability.repeatedCompositions, []);
});

test("a repeat the mirror cannot break survives to the audit", async () => {
  // A full-width composition has no side to flip: mirroring it changes
  // nothing, which is exactly when the deck-wide detector has to speak up.
  const centred = (title) => ({
    purpose: title,
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "text", role: "title", place: { column: 0, span: 12, row: 0, rows: 2 }, typography: { font: "display", step: "title", color: "ink" }, text: title },
      { type: "text", role: "body", place: { column: 0, span: 12, row: 2, rows: 5 }, typography: { font: "body", step: "body", color: "ink" }, text: "Jumla. ".repeat(30) },
    ],
  });
  const { ask } = model({
    design_direction: [{ mood: "civic", ground: "warm_white", brand: "#5A78F0", cornerLanguage: "soft", gradients: true }],
    slide_brief: [{}],
    slide_scene: () => centred("Bir"),
  });
  const deck = await generateDeck(deps({ ask }), { topic: "T", slides: [{ title: "a" }, { title: "b" }], maxAttempts: 1 });
  assert.deepEqual(deck.observability.mirroredSlides, [], "there was nothing to gain by flipping it");
  // The repeat cost it fifteen points, which put it under the line, so the
  // plain page built from the brief shipped instead — and that page is not a
  // repeat of anything.
  assert.equal(deck.slides[1].synthesised, true);
  assert.deepEqual(deck.observability.repeatedCompositions, []);
});

test("a repeat the mirror can break is broken", async () => {
  const { ask } = model({
    design_direction: [{ mood: "civic", ground: "warm_white", brand: "#5A78F0", cornerLanguage: "soft", gradients: true }],
    slide_brief: [{}],
    slide_scene: () => sound("Bir"),
  });
  const deck = await generateDeck(deps({ ask }), { topic: "T", slides: [{ title: "a" }, { title: "b" }], maxAttempts: 1 });
  assert.deepEqual(deck.observability.mirroredSlides, [1]);
  assert.deepEqual(deck.observability.repeatedCompositions, []);
  // Same words, same sizes, other way round.
  const first = deck.slides[0].scene.elements.find((one) => one.type === "image");
  const second = deck.slides[1].scene.elements.find((one) => one.type === "image");
  assert.equal(first.place.span, second.place.span);
  assert.notEqual(first.place.column, second.place.column);
});

test("every slide's score is kept, whatever happened to it", async () => {
  const { ask } = model({
    design_direction: [{ mood: "civic", ground: "warm_white", brand: "#5A78F0", cornerLanguage: "soft", gradients: true }],
    slide_brief: [{}],
    slide_scene: () => sound("Bir"),
  });
  const deck = await generateDeck(deps({ ask }), { topic: "T", slides: [{ title: "a" }, { title: "b" }, { title: "c" }], maxAttempts: 1 });
  assert.equal(deck.observability.scores.length, 3);
  assert.ok(deck.observability.scores.every((score) => score > 0));
});

test("a slide the model could not produce is built from its own brief", async () => {
  const { ask } = model({
    design_direction: [{ mood: "civic", ground: "warm_white", brand: "#5A78F0", cornerLanguage: "soft", gradients: true }],
    slide_brief: [{ slideGoal: "yakunlash", mainMessage: "Suv tejash hammaning ishi.", supportingMessage: "Kichik odat katta natija beradi.", informationDensity: 0.5, visualPriority: 0.2, needs: { image: false, chart: false, statistic: false, quote: false, comparison: false, timeline: false, example: false } }],
    // Everything empty, three times: what a real model did on a conclusion.
    slide_scene: () => ({ background: { kind: "solid", color: "background" }, elements: [{ type: "text", place: { column: 0, span: 6, row: 0, rows: 2 }, text: "  " }] }),
  });
  const deck = await generateDeck(deps({ ask }), { topic: "Suv", slides: [{ title: "Xulosa" }] });

  const slide = deck.slides[0];
  assert.equal(slide.synthesised, true, "the engine built the page");
  assert.equal(slide.accepted, false, "and does not pretend the model designed it");
  assert.ok(slide.scene, "a deck missing its conclusion is worse than a plain one");
  assert.equal(slide.score, 100, "what it built is sound");
  assert.deepEqual(deck.observability.synthesisedSlides, [0]);
  // The words are the brief's own; nothing was invented to fill the page.
  const body = slide.scene.elements.find((element) => element.role === "body");
  assert.match(body.text, /Suv tejash hammaning ishi/);
});

test("a slide the model produced is never overwritten by the fallback", async () => {
  const { ask } = model({
    design_direction: [{ mood: "civic", ground: "warm_white", brand: "#5A78F0", cornerLanguage: "soft", gradients: true }],
    slide_brief: [{}],
    slide_scene: () => sound("Bir"),
  });
  const deck = await generateDeck(deps({ ask }), { topic: "T", slides: [{ title: "Bir" }] });
  assert.equal(deck.slides[0].synthesised, false);
  assert.deepEqual(deck.observability.synthesisedSlides, []);
});

test("a page that never reaches the line is replaced rather than shipped", async () => {
  const { ask } = model({
    design_direction: [{ mood: "civic", ground: "warm_white", brand: "#5A78F0", cornerLanguage: "soft", gradients: true }],
    slide_brief: [{ slideGoal: "g", mainMessage: "Suv tejash muhim.", supportingMessage: null, informationDensity: 0.5, visualPriority: 0.3, needs: { image: false, chart: false, statistic: false, quote: false, comparison: false, timeline: false, example: false } }],
    // Two elements on top of each other, every time: a page scoring 40.
    slide_scene: () => colliding("Bir"),
  });
  const deck = await generateDeck(deps({ ask }), { topic: "T", slides: [{ title: "Bir" }], maxAttempts: 2 });
  const slide = deck.slides[0];
  assert.equal(slide.synthesised, true, "the broken page was replaced");
  assert.equal(slide.score, 100, "and what replaced it is sound");
  assert.deepEqual(slide.faults, [], "with nothing left wrong");
});
