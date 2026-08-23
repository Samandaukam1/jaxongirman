import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { FIELDS, RELATIVE_COLUMNS, missingFields, objectiveBlocks } = await import(`${edge}/objective.js`);
const { buildDocx, cmToEmu, cmToTwips, escapeXml } = await import(`${edge}/docx.js`);
const { unzip } = await import(`${edge}/unzip.js`);

/**
 * The obyektivka is a specific document, not a form somebody designed here.
 *
 * An institution hands it over with the fields already named, and a document
 * that is nearly the expected one is refused at the desk exactly like one that
 * is nothing like it. So the tests are about fidelity to the sample: the
 * headings it has, the order of its fields, the pairs that share a line, the
 * second page, and the five columns of the relatives table.
 */

const sample = {
  fullName: "Abdusattorov Pahlavon Abdurashid o‘g‘li",
  fields: {
    issued_on: "2024-yil 9-sentabr",
    institution: "O‘zbekiston jurnalistika va ommaviy kommunikatsiyalar universiteti",
    birth_date: "24.01.2001",
    birth_place: "Sirdaryo viloyati Boyovut tumani",
    nationality: "O‘zbek",
    party: "O‘zbekiston Liberal Demokratik Partiyasi a’zosi",
    education: "O‘rta maxsus",
    graduated: "Boyovut tuman qishloq xo‘jaligi kasb-hunar kolleji",
    speciality: "Qishloq xo‘jaligini mexanizatsiyalashtirish",
    academic_degree: "yo‘q",
    academic_title: "yo‘q",
    languages: "-",
    awards: "Jangovar tayyorgarliklar a’lochisi",
    elected_office: "yo‘q",
  },
  work: [{ period: "2022-2024 yy.", detail: "Nuriston qo‘rg‘oni 01404 harbiy qism" }],
  relatives: [{
    relation: "Otasi",
    name: "Shukurov Abdurashid Abdusattorovich",
    born: "1968-yil Sirdaryo viloyatida tug‘ilgan",
    work: "Boyovut tuman qishloq xo‘jaligi kasb-hunar kolleji",
    address: "Sirdaryo viloyati Boyovut tumani Sarmich MFY",
  }],
};

const blocks = () => objectiveBlocks(sample, { textWidthCm: 16.5 });
const flatten = (list) => list.flatMap((block) => block.kind === "table"
  ? block.rows.flatMap((row) => row.cells.flatMap((cell) => flatten(cell.blocks)))
  : [block]);
const words = (list) => flatten(list)
  .filter((block) => block.kind === "paragraph")
  .map((block) => block.runs.map((run) => run.text).join(""));

test("the document carries the three headings the form has", () => {
  const all = words(blocks());
  assert.ok(all.includes("MA’LUMOTNOMA"));
  assert.ok(all.includes("MEHNAT FAOLIYATI"));
  assert.ok(all.includes("MA’LUMOT"), "qarindoshlar sahifasining sarlavhasi");
});

test("the relatives page starts on a new page and names the person again", () => {
  const broken = blocks().filter((block) => block.kind === "paragraph" && block.pageBreakBefore);
  assert.equal(broken.length, 1);
  assert.match(broken[0].runs.map((run) => run.text).join(""), /yaqin qarindoshlari haqida/);
});

test("every field the form names is present, in its order", () => {
  const all = words(blocks());
  for (const field of FIELDS) {
    assert.ok(all.includes(field.label), `"${field.label}" yo‘q`);
  }
  assert.ok(all.indexOf("Tug‘ilgan yili:") < all.indexOf("Millati:"));
  assert.ok(all.indexOf("Millati:") < all.indexOf("Ilmiy darajasi:"));
});

test("paired fields share a line, and full-width ones do not", () => {
  const tables = blocks().filter((block) => block.kind === "table" && !block.borders);
  // The header (date beside photograph) plus one per pair of paired fields.
  const pairs = FIELDS.filter((field) => field.layout === "pair").length / 2;
  assert.equal(tables.length, 1 + pairs);
  for (const laid of tables) assert.equal(laid.rows[0].cells.length, 2);
});

test("an empty field prints as a dash rather than as nothing", () => {
  const bare = objectiveBlocks(
    { fullName: "A", fields: {}, work: [], relatives: [] },
    { textWidthCm: 16.5 },
  );
  const all = words(bare);
  assert.ok(all.filter((text) => text === "-").length >= FIELDS.length);
});

test("the relatives table has the five columns of the sample, with a repeating header", () => {
  const bordered = blocks().find((block) => block.kind === "table" && block.borders);
  assert.ok(bordered);
  assert.equal(bordered.rows[0].cells.length, RELATIVE_COLUMNS.length);
  assert.equal(bordered.rows[0].header, true);
  assert.deepEqual(
    bordered.rows[0].cells.map((cell) => cell.blocks[0].runs[0].text),
    [...RELATIVE_COLUMNS],
  );
});

test("a photograph is placed only when one was chosen", () => {
  const without = blocks();
  assert.equal(flatten(without).some((block) => block.kind === "image"), false);

  const withPhoto = objectiveBlocks({ ...sample, photoIndex: 0 }, { textWidthCm: 16.5 });
  const picture = flatten(withPhoto).find((block) => block.kind === "image");
  assert.ok(picture);
  // 3 by 4 centimetres, which is the size the paper form leaves for it.
  assert.equal(picture.widthCm, 3);
  assert.equal(picture.heightCm, 4);
});

test("what is still missing is named, so the form can say so", () => {
  assert.deepEqual(missingFields(sample), []);
  const missing = missingFields({ fullName: "", fields: {}, work: [], relatives: [] });
  assert.ok(missing.includes("F.I.Sh."));
  assert.ok(missing.includes("Tug‘ilgan yili"));
});

/* ------------------------------------------------------------------ docx */

test("the units are the ones OOXML uses, not the ones a person would assume", () => {
  // 1440 twips per inch, 2.54 cm per inch.
  assert.equal(cmToTwips(2.54), 1440);
  assert.equal(cmToEmu(2.54), 914400);
});

test("a built document is a real package Word can open", async () => {
  const bytes = await buildDocx({ blocks: blocks() });
  const entries = await unzip(bytes);

  for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels"]) {
    assert.ok(entries.has(part), `${part} yo‘q`);
  }
  const document = new TextDecoder().decode(entries.get("word/document.xml"));
  assert.match(document, /<w:body>/);
  assert.match(document, /MA’LUMOTNOMA/);
  // A4 with the margins a submitted document is expected to have.
  assert.match(document, new RegExp(`w:w="${cmToTwips(21)}"`));
});

test("a photograph is carried into the package and pointed at", async () => {
  const bytes = await buildDocx({
    blocks: objectiveBlocks({ ...sample, photoIndex: 0 }, { textWidthCm: 16.5 }),
    images: [{ bytes: new Uint8Array([1, 2, 3, 4]), extension: "jpeg" }],
  });
  const entries = await unzip(bytes);
  assert.ok(entries.has("word/media/image1.jpeg"));
  const rels = new TextDecoder().decode(entries.get("word/_rels/document.xml.rels"));
  assert.match(rels, /rIdImage1/);
  assert.match(rels, /media\/image1\.jpeg/);
});

test("text that would break the XML is escaped rather than shipped", () => {
  assert.equal(escapeXml('a & b < c > "d"'), "a &amp; b &lt; c &gt; &quot;d&quot;");
});
