import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { dealAcrossRuns, readTextObjects, remainingTemplateText, replaceText } =
  await import(`${edge}/pptx-text.js`);
const { unzip } = await import(`${edge}/unzip.js`);
const { zip } = await import(`${edge}/zip.js`);

/**
 * Changing the words in a slide and nothing else.
 *
 * PPTX template mode rests on one decision: the original OOXML is the design,
 * so it is edited rather than rebuilt. These tests are about the two ways that
 * goes wrong — markup lost around the edit, and a heading cut into pieces
 * because PowerPoint had split it across runs for reasons of its own.
 */

const SLIDE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="ppt" xmlns:a="draw"><p:cSld><p:spTree>
  <p:sp>
    <p:nvSpPr><p:cNvPr id="7" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
      <p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
    <p:spPr><a:xfrm rot="1200000"><a:off x="100" y="200"/></a:xfrm></p:spPr>
    <p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>
      <a:p><a:r><a:rPr lang="en-US" b="1"><a:solidFill><a:srgbClr val="FFE500"/></a:solidFill></a:rPr><a:t>CAMPUS</a:t></a:r><a:r><a:rPr lang="en-US"/><a:t> JOURNALISM</a:t></a:r></a:p>
    </p:txBody>
  </p:sp>
  <p:sp>
    <p:nvSpPr><p:cNvPr id="9" name="Body 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
    <p:spPr/>
    <p:txBody><a:bodyPr/><a:lstStyle/>
      <a:p><a:r><a:rPr lang="en-US"/><a:t>First sample line</a:t></a:r></a:p>
      <a:p><a:r><a:rPr lang="en-US"/><a:t>Second sample line</a:t></a:r></a:p>
    </p:txBody>
  </p:sp>
  <p:pic><p:nvPicPr><p:cNvPr id="11" name="Photo"/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="rId3"/></p:blipFill><p:spPr/></p:pic>
</p:spTree></p:cSld></p:sld>`;

/* ------------------------------------------------------------------ reading */

test("a text box is one object, however many runs PowerPoint split it into", () => {
  const [title] = readTextObjects(SLIDE);
  assert.equal(title.text, "CAMPUS JOURNALISM");
  assert.equal(title.paragraphs[0].runs.length, 2);
});

test("the shape's own id and name come with it", () => {
  const [title, body] = readTextObjects(SLIDE);
  assert.equal(title.shapeId, "7");
  assert.equal(title.shapeName, "Title 1");
  assert.equal(title.placeholder, "ctrTitle");
  assert.equal(body.placeholder, "body");
});

test("paragraphs stay separate, because a line break is a decision", () => {
  const body = readTextObjects(SLIDE)[1];
  assert.equal(body.paragraphs.length, 2);
  assert.equal(body.text, "First sample line\nSecond sample line");
});

test("a picture is not a text object", () => {
  assert.equal(readTextObjects(SLIDE).length, 2);
});

test("escaped characters are read as the characters they stand for", () => {
  const markup = '<p:sp><p:nvSpPr><p:cNvPr id="1" name="T"/></p:nvSpPr><p:txBody>'
    + "<a:p><a:r><a:t>Bosh &amp; Yordamchi &lt;2026&gt;</a:t></a:r></a:p></p:txBody></p:sp>";
  assert.equal(readTextObjects(markup)[0].text, "Bosh & Yordamchi <2026>");
});

/* ----------------------------------------------------------------- writing */

test("only the words change — every other byte of the slide is identical", () => {
  const after = replaceText(SLIDE, [
    { shapeId: "7", paragraphs: ["JURNALISTIKA ASOSLARI"] },
    { shapeId: "9", paragraphs: ["Birinchi qator", "Ikkinchi qator"] },
  ]);

  // Everything outside `<a:t>` must survive byte for byte: the rotation, the
  // colour, the lock, the placeholder, the picture's relationship.
  for (const fragment of [
    '<a:xfrm rot="1200000">', '<a:srgbClr val="FFE500"/>', '<a:spLocks noGrp="1"/>',
    '<p:ph type="ctrTitle"/>', '<a:bodyPr anchor="ctr"/>', '<a:blip r:embed="rId3"/>',
    'xmlns:a="draw"', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  ]) {
    assert.ok(after.includes(fragment), `lost: ${fragment}`);
  }
});

test("the template's own words are gone", () => {
  const after = replaceText(SLIDE, [
    { shapeId: "7", paragraphs: ["JURNALISTIKA ASOSLARI"] },
    { shapeId: "9", paragraphs: ["Birinchi qator", "Ikkinchi qator"] },
  ]);
  for (const word of ["CAMPUS", "JOURNALISM", "First sample line", "Second sample line"]) {
    assert.ok(!after.includes(word), `${word} survived`);
  }
});

test("a two-colour heading is still two-coloured afterwards", () => {
  const after = replaceText(SLIDE, [{ shapeId: "7", paragraphs: ["JURNALISTIKA ASOSLARI"] }]);
  const [title] = readTextObjects(after);
  assert.equal(title.paragraphs[0].runs.length, 2, "a run was lost with its colour");
  assert.equal(title.text, "JURNALISTIKA ASOSLARI");
  // And the split lands between words rather than mid-syllable.
  assert.ok(!title.paragraphs[0].runs[0].text.endsWith("JURNALIS"), title.paragraphs[0].runs[0].text);
});

test("a paragraph the caller said nothing about is emptied, never left as it was", () => {
  const after = replaceText(SLIDE, [{ shapeId: "9", paragraphs: ["Faqat bitta qator"] }]);
  assert.ok(!after.includes("Second sample line"), "template copy shipped");
});

test("a shape the caller does not mention is untouched", () => {
  const after = replaceText(SLIDE, [{ shapeId: "9", paragraphs: ["A", "B"] }]);
  assert.ok(after.includes("CAMPUS"));
});

test("characters that mean something in XML are escaped on the way back", () => {
  const after = replaceText(SLIDE, [{ shapeId: "7", paragraphs: ["Bosh & <yordamchi>"] }]);
  assert.ok(after.includes("&amp;"), "an ampersand went in raw");
  assert.ok(!/<yordamchi>/.test(after), "a bracket went in raw");
  assert.equal(readTextObjects(after)[0].text, "Bosh & <yordamchi>");
});

test("a longer replacement than the original still lands whole", () => {
  const long = "Jurnalistika asoslari va zamonaviy media muhitidagi amaliy koʻnikmalar";
  const after = replaceText(SLIDE, [{ shapeId: "7", paragraphs: [long] }]);
  assert.equal(readTextObjects(after)[0].text, long);
});

test("an empty replacement empties the box rather than corrupting it", () => {
  const after = replaceText(SLIDE, [{ shapeId: "7", paragraphs: [""] }]);
  assert.equal(readTextObjects(after)[0].text, "");
  assert.ok(after.includes('<a:srgbClr val="FFE500"/>'), "the styling went with the words");
});

/* ------------------------------------------------------------- dealing out */

test("runs keep their proportions", () => {
  const runs = [{ text: "AB", start: 0, end: 2 }, { text: "CDEFGH", start: 2, end: 8 }];
  const pieces = dealAcrossRuns(runs, "12345678");
  assert.equal(pieces.join(""), "12345678");
  assert.ok(pieces[1].length > pieces[0].length);
});

test("one run takes the whole replacement", () => {
  assert.deepEqual(dealAcrossRuns([{ text: "x", start: 0, end: 1 }], "salom"), ["salom"]);
});

test("runs that were empty do not swallow the replacement", () => {
  const runs = [{ text: "", start: 0, end: 0 }, { text: "", start: 0, end: 0 }];
  assert.deepEqual(dealAcrossRuns(runs, "salom"), ["salom", ""]);
});

/* -------------------------------------------------------------- the check */

test("surviving template copy is reported rather than shipped", () => {
  const before = readTextObjects(SLIDE);
  const after = readTextObjects(replaceText(SLIDE, [{ shapeId: "7", paragraphs: ["JURNALISTIKA"] }]));
  const left = remainingTemplateText(before, after);
  assert.ok(left.includes("First sample line\nSecond sample line"), left.join(" | "));
});

test("a fully rewritten slide reports nothing left", () => {
  const before = readTextObjects(SLIDE);
  const after = readTextObjects(replaceText(SLIDE, [
    { shapeId: "7", paragraphs: ["JURNALISTIKA ASOSLARI"] },
    { shapeId: "9", paragraphs: ["Birinchi qator", "Ikkinchi qator"] },
  ]));
  assert.deepEqual(remainingTemplateText(before, after), []);
});

/* ------------------------------------------------------------------- zip */

test("a package written here is one `unzip` reads back exactly", async () => {
  const files = [
    { name: "[Content_Types].xml", bytes: new TextEncoder().encode("<Types/>") },
    { name: "ppt/slides/slide1.xml", bytes: new TextEncoder().encode(SLIDE) },
    // Bytes that are not text at all, and a name with a folder in it.
    { name: "ppt/media/image1.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]) },
  ];
  const entries = await unzip(await zip(files));

  assert.equal(entries.size, 3);
  assert.equal(new TextDecoder().decode(entries.get("ppt/slides/slide1.xml")), SLIDE);
  assert.deepEqual([...entries.get("ppt/media/image1.png")], [0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
});

test("a large repetitive part survives the round trip it will be compressed by", async () => {
  const big = new TextEncoder().encode(`<a>${"x".repeat(50_000)}</a>`);
  const entries = await unzip(await zip([{ name: "a.xml", bytes: big }]));
  assert.deepEqual([...entries.get("a.xml")], [...big]);
});
