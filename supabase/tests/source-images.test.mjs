import assert from "node:assert/strict";
import test from "node:test";
import { buildEdgeModules } from "../scripts/build-edge.mjs";

/*
 * The author's own pictures on their slides: each gets a page, keeps it
 * through the copy, and the composed page draws the picture from the deck's
 * own folder.
 */

const edge = buildEdgeModules();
const { placeSourceImages, readOutline, readSlide, slideFromOutline, isSourceImageKey, outlinePrompt } = await import(`${edge}/glass/content.js`);
const { buildDNA, readArtDirection, candidateFaces } = await import(`${edge}/glass/dna.js`);
const { composeDeck, pageFaults } = await import(`${edge}/glass/compose.js`);

const outlineOf = (slides) => readOutline({ shortTitle: "Qisqa", subtitle: "Izoh", coverQuery: "school", slides }, { topic: "Samarqand", count: slides.length });
const page = (title, kind, imageQuery = null) => ({ title, kind, focus: `${title} haqida`, imageQuery });
const images = [
  { key: "user-image-1", caption: "Registon maydoni kechqurun" },
  { key: "user-image-2", caption: "Shohi Zinda ko‘chasi" },
];

test("the keys the model named are kept, read leniently, and once each", () => {
  const outline = outlineOf([
    page("Registon", "photo", "User image 1"),
    page("Tarix", "cards"),
    page("Me’morchilik", "photo", "user_image_1"),
    page("Ko‘chalar", "bullets", "user-image-9"),
  ]);
  const placed = placeSourceImages(outline, images);
  assert.equal(placed.slides[0].imageQuery, "user-image-1");
  assert.equal(placed.slides[0].kind, "photo");
  // The same key twice: the second page gives it up. An unknown key is dropped.
  assert.notEqual(placed.slides[2].imageQuery, "user-image-1");
  assert.equal(placed.slides[3].imageQuery === "user-image-9", false);
  const keys = placed.slides.map((slide) => slide.imageQuery).filter(isSourceImageKey);
  assert.deepEqual([...keys].sort(), ["user-image-1", "user-image-2"], "every picture is on exactly one page");
});

test("a picture the model left out takes a stock photo page first, then the cheapest page far from the others", () => {
  const withStock = placeSourceImages(outlineOf([
    page("Kirish", "statement"), page("Raqamlar", "stats"), page("Manzara", "photo", "samarkand city"), page("Xulosa", "bullets"),
  ]), [images[0]]);
  assert.equal(withStock.slides[2].imageQuery, "user-image-1", "the stock search gives way to the author's picture");
  assert.equal(withStock.slides[1].kind, "stats", "a page of numbers is left alone");

  const spread = placeSourceImages(outlineOf([
    page("A", "bullets"), page("B", "chart"), page("C", "stats"), page("D", "chart"), page("E", "bullets"),
  ]), images);
  const at = spread.slides.map((slide, index) => isSourceImageKey(slide.imageQuery) ? index : -1).filter((index) => index >= 0);
  assert.deepEqual(at, [0, 4], "two pictures sit as far apart as the deck allows");
  assert.ok(spread.slides.filter((slide) => slide.kind === "chart").length === 2, "and no chart was given up");
});

test("the writer is told what the picture shows", () => {
  const placed = placeSourceImages(outlineOf([page("Registon", "photo", "user-image-1"), page("Tarix", "cards")]), [images[0]]);
  assert.match(placed.slides[0].focus, /Rasmda: Registon maydoni kechqurun/);
  const prompt = outlinePrompt({ topic: "Samarqand", count: 2, research: "", requirements: "", attachments: true, images });
  assert.match(prompt, /user-image-2 — Shohi Zinda ko‘chasi/);
});

test("a thin photo page keeps the author's picture; a thin stock one does not", () => {
  const own = readSlide({ title: "Registon", lead: "", points: [{ title: "", text: "Bitta tezis" }] }, { title: "Registon", kind: "photo", focus: "f", imageQuery: "user-image-1" });
  assert.equal(own.kind, "photo");
  assert.ok(own.lead.length > 0, "and it still has a line of text");
  const stock = readSlide({ title: "Shahar", lead: "", points: [{ title: "", text: "Bitta tezis" }] }, { title: "Shahar", kind: "photo", focus: "f", imageQuery: "city" });
  assert.equal(stock.kind, "statement");
  assert.equal(slideFromOutline({ title: "Registon", kind: "photo", focus: "Registon haqida", imageQuery: "user-image-1" }).kind, "photo",
    "a page whose copy failed still shows the picture");
});

test("the composed page draws the author's picture from the deck's folder", () => {
  const allFaces = new Set(candidateFaces().flatMap((entry) => entry.weights.map((weight) => `${entry.family}|${weight}`)));
  const available = (family, weight) => allFaces.has(`${family}|${weight}`);
  const face = (pick) => ({ fontFamily: `jx_${pick.family.toLowerCase().replace(/[^a-z0-9]/g, "")}_${pick.weight}`, fontWeight: String(pick.weight) });
  const outline = placeSourceImages(outlineOf([page("Registon", "photo", "user-image-1"), page("Tarix", "cards")]), [images[0]]);
  const slides = outline.slides.map((entry) => readSlide({
    title: entry.title, lead: "Registon — Samarqandning markaziy maydoni.",
    points: [1, 2, 3].map((n) => ({ title: `Tezis ${n}`, text: "Qisqa izoh matni." })),
  }, entry));
  const path = "71000000-0000-0000-0000-000000000001/73000000-0000-0000-0000-000000000003/source-1.jpg";
  for (const style of ["glass", "editorial", "corporate", "naqsh"]) {
    const dna = buildDNA({ direction: readArtDirection({ mode: "light", hue: 30, mood: "classic", typography: "serif", energy: "calm" }, "t"), seed: 3, available, style });
    const deck = composeDeck({ dna, face, topic: "Samarqand", shortTitle: "Qisqa", subtitle: "Izoh", author: "A", teacher: null, year: 2026,
      slides, sources: [], cover: null, pictures: new Map([["user-image-1", { bucket: "presentation-assets", path }]]) });
    const pictured = deck.filter((one) => one.rows.some((row) => row.type === "image" && row.content.storagePath === path));
    assert.equal(pictured.length, 1, `${style}: the picture is on its page`);
    assert.deepEqual(pageFaults(pictured[0].rows), [], `${style}: and nothing overlaps it`);
  }
});
