import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { dealAcrossBoxes, readTemplateSlots } = await import(`${edge}/pptx-slots.js`);
const { asksFor, bindingsFromSlots, readTemplateAnswer } = await import(`${edge}/pptx-writer.js`);

/**
 * Reading a template slide as a set of boxes to write into.
 *
 * The rule these exist to hold is that **every** editable box is found. The
 * design before this one let a closed binding vocabulary decide which boxes
 * existed, so a cover with eleven text boxes had three that nothing could ever
 * address — and those three kept the template's own English in every deck ever
 * exported from it.
 *
 * The second rule is that a box is measured, not guessed at. What the designer
 * put in it says what fits; the room it has says what is possible. Copy is
 * written to the first and checked against the second.
 */

const box = (id, text, name = `TextBox ${id}`) =>
  `<p:sp><p:nvSpPr><p:cNvPr name="${name}" id="${id}"/></p:nvSpPr><p:spPr/>`
  + `<p:txBody><a:bodyPr/>${text.split("\n").map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>`;

const slide = (inner) => `<p:sld><p:cSld><p:spTree>${inner}</p:spTree></p:cSld></p:sld>`;

const geometry = (entries) => new Map(entries.map(([id, x, y, width, height, fontSize]) =>
  [String(id), { x, y, width, height, fontSize }]));

const canvas = { canvasWidth: 960, canvasHeight: 540 };

test("every text box of the part becomes a slot, whatever the vocabulary holds", () => {
  const markup = slide(Array.from({ length: 11 }, (_, index) => box(index + 2, `Box ${index}`)).join(""));
  const slots = readTemplateSlots(markup, geometry(
    Array.from({ length: 11 }, (_, index) => [index + 2, 10, index * 40, 300, 40, 18])), canvas);
  assert.equal(slots.length, 11);
  assert.equal(new Set(slots.map((slot) => slot.shapeId)).size, 11);
});

test("a box the parser never measured is still a slot", () => {
  const slots = readTemplateSlots(slide(box(2, "Sarlavha")), new Map(), canvas);
  assert.equal(slots.length, 1);
  assert.ok(slots[0].characterCapacity > 0);
});

test("the largest type is the display, the smallest the caption", () => {
  const markup = slide(box(2, "JOURNALISM") + box(3, "Kichik izoh matni") + box(4, "Oddiy tanadagi matn"));
  const slots = readTemplateSlots(markup, geometry([
    [2, 10, 10, 800, 200, 180], [3, 10, 300, 300, 30, 10], [4, 10, 400, 600, 60, 18],
  ]), canvas);
  const byId = new Map(slots.map((slot) => [slot.shapeId, slot.role]));
  assert.equal(byId.get("2"), "display");
  assert.equal(byId.get("4"), "label");
  assert.equal(byId.get("3"), "caption");
});

test("a placeholder says what it is without being measured", () => {
  const markup = slide(
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>`
    + `<p:spPr/><p:txBody><a:p><a:r><a:t>Sarlavha</a:t></a:r></a:p></p:txBody></p:sp>`);
  const slots = readTemplateSlots(markup, geometry([[2, 10, 10, 400, 60, 20]]), canvas);
  assert.equal(slots[0].role, "title");
});

test("single letters side by side are one spaced-out word, not six bullets", () => {
  const markup = slide("CAMPUS".split("").map((letter, index) => box(index + 10, letter)).join(""));
  const slots = readTemplateSlots(markup, geometry(
    "CAMPUS".split("").map((_, index) => [index + 10, index * 40, 200, 30, 40, 26])), canvas);
  assert.equal(slots.length, 6);
  assert.ok(slots.every((slot) => slot.role === "letter"));
  assert.equal(new Set(slots.map((slot) => slot.letterGroup)).size, 1);
  assert.notEqual(slots[0].letterGroup, null);
});

test("two lone letters are not a word — a run needs three", () => {
  const markup = slide(box(10, "A") + box(11, "B"));
  const slots = readTemplateSlots(markup, geometry([[10, 0, 0, 30, 40, 26], [11, 40, 0, 30, 40, 26]]), canvas);
  assert.ok(slots.every((slot) => slot.letterGroup === null));
});

test("a page number is a number, and never asked for as a sentence", () => {
  const slots = readTemplateSlots(slide(box(2, "04")), geometry([[2, 900, 500, 40, 20, 12]]), canvas);
  assert.equal(slots[0].role, "number");
});

test("capacity comes from the box and the aim from what the designer wrote", () => {
  const slots = readTemplateSlots(slide(box(2, "Qisqa sarlavha")), geometry([[2, 0, 0, 600, 120, 20]]), canvas);
  const slot = slots[0];
  assert.equal(slot.characters, "Qisqa sarlavha".length);
  assert.ok(slot.charactersPerLine > 20);
  assert.ok(slot.lines >= 4);
  assert.ok(slot.characterCapacity > slot.characters);
  assert.ok(slot.wordCapacity >= 1);
});

test("paragraphs and bullets are counted from the box, not guessed", () => {
  const markup = slide(
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="List"/></p:nvSpPr><p:spPr/><p:txBody>`
    + `<a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:t>Birinchi</a:t></a:r></a:p>`
    + `<a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:t>Ikkinchi</a:t></a:r></a:p>`
    + `</p:txBody></p:sp>`);
  const slots = readTemplateSlots(markup, geometry([[2, 0, 0, 400, 120, 16]]), canvas);
  assert.equal(slots[0].paragraphs, 2);
  assert.equal(slots[0].bullets, 2);
  assert.equal(slots[0].role, "bullet");
});

test("reading order bands rows, so columns read left to right", () => {
  const markup = slide(box(2, "O‘ng ustun") + box(3, "Chap ustun") + box(4, "Pastdagi"));
  const slots = readTemplateSlots(markup, geometry([
    [2, 500, 100, 200, 40, 16], [3, 100, 104, 200, 40, 16], [4, 100, 400, 200, 40, 16],
  ]), canvas);
  assert.deepEqual(slots.map((slot) => slot.shapeId), ["3", "2", "4"]);
});

/* -------------------------------------------------------------- the writer */

const slotOf = (over = {}) => ({
  shapeId: "2", role: "body", originalText: "Campus journalism matters",
  paragraphs: 1, bullets: 0, characters: 25, words: 3,
  width: 400, height: 60, fontSize: 16,
  charactersPerLine: 47, lines: 3, characterCapacity: 141, wordCapacity: 20,
  letterGroup: null, binding: "body", elementId: "page_01_body", ...over,
});

test("the ask carries the designer's length as the aim and the box as the limit", () => {
  const [ask] = asksFor([slotOf()]);
  assert.equal(ask.aim, 25);
  assert.equal(ask.limit, 141);
  assert.equal(ask.sample, "Campus journalism matters");
});

test("a spaced-out word is asked for once, not once per letter", () => {
  const letters = "CAMPUS".split("").map((letter, index) => slotOf({
    shapeId: String(index + 10), role: "letter", originalText: letter,
    characters: 1, words: 1, letterGroup: 1, binding: null, elementId: null,
  }));
  const asks = asksFor(letters);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].shapeIds.length, 6);
  assert.equal(asks[0].sample, "CAMPUS");
});

test("a word is dealt evenly across the boxes that spell it", () => {
  assert.deepEqual(dealAcrossBoxes("JURNALISTIKA", 6), ["JU", "RN", "AL", "IS", "TI", "KA"]);
  // Fewer letters than boxes spreads them across the same span the composition
  // used, rather than bunching them at one end and leaving a gap.
  assert.deepEqual(dealAcrossBoxes("OAV", 6), ["O", "", "A", "", "V", ""]);
  assert.deepEqual(dealAcrossBoxes("", 3), ["", "", ""]);
});

test("a box the model skipped is filled rather than left saying English", () => {
  const slots = [slotOf(), slotOf({ shapeId: "3", role: "title" })];
  const fill = readTemplateAnswer({ boxes: [{ id: "2", text: "Yangi matn" }] }, slots, { title: "Sarlavha" });
  assert.equal(fill.texts.get("2"), "Yangi matn");
  assert.equal(fill.texts.get("3"), "Sarlavha");
  assert.deepEqual(fill.filled, ["3"]);
  assert.equal(fill.texts.size, 2);
});

test("an answer longer than the box is cut at a word, and the cut is reported", () => {
  const slots = [slotOf({ characterCapacity: 20, characters: 12 })];
  const long = "Talabalar jurnalistikasi bugungi kunda juda muhim";
  const fill = readTemplateAnswer({ boxes: [{ id: "2", text: long }] }, slots, { title: "X" });
  assert.ok(fill.texts.get("2").length <= 20);
  assert.ok(!fill.texts.get("2").endsWith(" "));
  assert.deepEqual(fill.trimmed, ["2"]);
});

test("every slot comes back with something, whatever the model returned", () => {
  const slots = [slotOf(), slotOf({ shapeId: "3" }), slotOf({ shapeId: "4" })];
  const fill = readTemplateAnswer({ boxes: [] }, slots, { title: "Sarlavha" });
  assert.equal(fill.texts.size, 3);
  assert.ok([...fill.texts.keys()].every((id) => ["2", "3", "4"].includes(id)));
});

test("a rubbish answer is not trusted into the file", () => {
  const fill = readTemplateAnswer(null, [slotOf()], { title: "Sarlavha" });
  assert.equal(fill.texts.size, 1);
  assert.deepEqual(fill.filled, ["2"]);
});

test("what was written reads back as the fields the preview draws", () => {
  const slots = [
    slotOf({ shapeId: "2", binding: "title", elementId: "p_title" }),
    slotOf({ shapeId: "3", binding: "bullet_1", elementId: "p_b1" }),
    slotOf({ shapeId: "4", binding: "bullet_2", elementId: "p_b2" }),
    slotOf({ shapeId: "5", binding: null, elementId: null }),
  ];
  const texts = new Map([["2", "Sarlavha"], ["3", "Birinchi"], ["4", "Ikkinchi"], ["5", "Ko‘rinmaydi"]]);
  const bound = bindingsFromSlots(slots, texts);
  assert.equal(bound.title, "Sarlavha");
  assert.deepEqual(bound.bullets, ["Birinchi", "Ikkinchi"]);
});

/* ------------------------------------------------------- the cover picture */

const { readCoverImage } = await import(`${edge}/pptx.js`);

/**
 * A JPEG shaped enough to be walked: two marker segments and a scan whose byte
 * values are the thing under test.
 */
function jpeg(scanBytes) {
  const head = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
  for (let index = 0; index < 14; index += 1) head.push(0x00);
  head.push(0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00);
  return new Uint8Array([...head, ...scanBytes]);
}

test("a blank thumbnail is refused rather than shown as the template", () => {
  // What Canva and Google Slides write: a white rectangle, a handful of values.
  const scan = Array.from({ length: 1400 }, (_, index) => index % 9);
  assert.equal(readCoverImage(new Map([["docProps/thumbnail.jpeg", jpeg(scan)]])), null);
});

test("a real cover is taken, because nothing else here can rasterise a slide", () => {
  const scan = Array.from({ length: 1400 }, (_, index) => (index * 37) % 256);
  const bytes = jpeg(scan);
  assert.equal(readCoverImage(new Map([["docProps/thumbnail.jpeg", bytes]])), bytes);
});

test("a package with no thumbnail is not an error", () => {
  assert.equal(readCoverImage(new Map()), null);
});

/* --------------------------------------------- a design imported too early */

const { usableSlots } = await import(`${edge}/pptx-writer.js`);

test("slots from an older import are not written against", () => {
  // What the column held before the boxes were measured.
  const old = [{ shapeId: "2", binding: "title", elementId: "page_01_title", paragraphs: 1 }];
  assert.deepEqual(usableSlots(old), []);
});

test("measured slots are taken, and rubbish in the column is not", () => {
  assert.equal(usableSlots([slotOf(), null, {}, { shapeId: "" }]).length, 1);
});

/* ---------------------------------------- slides the server assembles itself */

const { fillFromSlide } = await import(`${edge}/pptx-writer.js`);

test("an assembled slide fills every box the template has", () => {
  const slots = [
    slotOf({ shapeId: "2", role: "display", characterCapacity: 40 }),
    slotOf({ shapeId: "3", role: "subtitle" }),
    slotOf({ shapeId: "4", role: "label" }),
    slotOf({ shapeId: "5", role: "number" }),
    slotOf({ shapeId: "6", role: "caption" }),
  ];
  const texts = fillFromSlide(slots, {
    title: "Talabalar jurnalistikasi",
    subtitle: "Maktab nashri",
    bullets: ["Tahririyat"],
  });
  // Every box, without exception: one left out keeps the template's English.
  assert.equal(texts.size, 5);
  assert.equal(texts.get("2"), "Talabalar jurnalistikasi");
  assert.equal(texts.get("3"), "Maktab nashri");
  assert.equal(texts.get("4"), "Tahririyat");
  assert.equal(texts.get("5"), "");
  assert.equal(texts.get("6"), "");
});

test("a spaced-out word on an assembled cover gets the first word of its title", () => {
  const letters = "CAMPUS".split("").map((letter, index) => slotOf({
    shapeId: String(index + 10), role: "letter", originalText: letter,
    characters: 1, letterGroup: 1, binding: null, elementId: null,
  }));
  const texts = fillFromSlide(letters, { title: "Jurnalistika asoslari" });
  assert.equal(texts.size, 6);
  assert.equal([...texts.values()].join(""), "JURNALISTIKA");
});

test("a title longer than the box is cut, not overflowed", () => {
  const texts = fillFromSlide([slotOf({ role: "title", characterCapacity: 12, characters: 12 })], {
    title: "Talabalar jurnalistikasining ahamiyati",
  });
  assert.ok(texts.get("2").length <= 12);
});

test("an answer that hands the sample back is not shipped as an answer", () => {
  const slots = [slotOf({ role: "label", originalText: "www.reallygreatsite.com", characters: 23 })];
  const fill = readTemplateAnswer(
    { boxes: [{ id: "2", text: "www.reallygreatsite.com" }] },
    slots,
    { title: "Sarlavha" },
  );
  // Blank, not the template's own words: a leftover fails the whole export.
  assert.equal(fill.texts.get("2"), "");
  assert.deepEqual(fill.filled, ["2"]);
});

test("a short repeat is left alone — a year is the right answer twice", () => {
  const slots = [slotOf({ role: "number", originalText: "2026", characters: 4 })];
  const fill = readTemplateAnswer({ boxes: [{ id: "2", text: "2026" }] }, slots, { title: "S" });
  assert.equal(fill.texts.get("2"), "2026");
  assert.deepEqual(fill.filled, []);
});
