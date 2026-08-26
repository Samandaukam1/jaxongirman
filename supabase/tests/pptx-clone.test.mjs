import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { clonePresentation, closureOf, countVisualObjects, readRelationships, resolveTarget } =
  await import(`${edge}/pptx-clone.js`);
const { readTextObjects } = await import(`${edge}/pptx-text.js`);
const { unzip } = await import(`${edge}/unzip.js`);
const { zip } = await import(`${edge}/zip.js`);

/**
 * A deck built out of the template's own slides.
 *
 * The rule is that the uploaded package is the design, so the finished file has
 * to be made of its parts — the same slide XML, the same layouts and masters
 * behind it, the same theme, the same image bytes. These tests are about the
 * three ways that goes wrong: a slide taken without what it references, a
 * manifest that stops matching the parts, and a page used twice.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (text) => encoder.encode(text);

const slideXml = (title, body) => `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="ppt" xmlns:a="draw" xmlns:r="rel"><p:cSld><p:spTree>
  <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
    <p:spPr><a:xfrm rot="900000"/></p:spPr>
    <p:txBody><a:bodyPr/><a:p><a:r><a:rPr b="1"/><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
  <p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
    <p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>
  <p:pic><p:nvPicPr><p:cNvPr id="4" name="Photo"/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr/></p:pic>
  <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="Rule"/><p:nvPr/></p:nvCxnSpPr><p:spPr/></p:cxnSp>
</p:spTree></p:cSld></p:sld>`;

/** A package shaped the way PowerPoint writes one. */
function deck() {
  return new Map(Object.entries({
    "[Content_Types].xml":
      '<Types xmlns="ct"><Default Extension="png" ContentType="image/png"/>'
      + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
      + '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
      + '<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
      + '<Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
      + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="layout"/>'
      + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="master"/>'
      + '<Override PartName="/ppt/theme/theme1.xml" ContentType="theme"/></Types>',
    "_rels/.rels": '<Relationships xmlns="r"><Relationship Id="rId1" Type="t/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    "docProps/core.xml": "<cp:coreProperties><dc:creator>Studio</dc:creator></cp:coreProperties>",
    "ppt/presentation.xml":
      '<p:presentation xmlns:p="ppt" xmlns:r="rel" saveSubsetFonts="1">'
      + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst>'
      + '<p:sldIdLst><p:sldId id="256" r:id="rIdS1"/><p:sldId id="257" r:id="rIdS2"/><p:sldId id="258" r:id="rIdS3"/></p:sldIdLst>'
      + '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
    "ppt/_rels/presentation.xml.rels":
      '<Relationships xmlns="r">'
      + '<Relationship Id="rIdM" Type="t/slideMaster" Target="slideMasters/slideMaster1.xml"/>'
      + '<Relationship Id="rIdT" Type="t/theme" Target="theme/theme1.xml"/>'
      + '<Relationship Id="rIdS1" Type="t/slide" Target="slides/slide1.xml"/>'
      + '<Relationship Id="rIdS2" Type="t/slide" Target="slides/slide2.xml"/>'
      + '<Relationship Id="rIdS3" Type="t/slide" Target="slides/slide3.xml"/>'
      + "</Relationships>",
    "ppt/slides/slide1.xml": slideXml("CAMPUS JOURNALISM", "The student newsroom"),
    "ppt/slides/slide2.xml": slideXml("OUR PROCESS", "From pitch to print"),
    "ppt/slides/slide3.xml": slideXml("THANK YOU", "See you next term"),
    "ppt/slides/_rels/slide1.xml.rels":
      '<Relationships xmlns="r">'
      + '<Relationship Id="rId1" Type="t/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'
      + '<Relationship Id="rId2" Type="t/image" Target="../media/photographer.png"/>'
      + '<Relationship Id="rId3" Type="t/hyperlink" Target="https://example.com" TargetMode="External"/>'
      + "</Relationships>",
    "ppt/slides/_rels/slide2.xml.rels":
      '<Relationships xmlns="r"><Relationship Id="rId1" Type="t/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
    "ppt/slides/_rels/slide3.xml.rels":
      '<Relationships xmlns="r"><Relationship Id="rId1" Type="t/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'
      + '<Relationship Id="rId2" Type="t/image" Target="../media/logo.png"/></Relationships>',
    "ppt/slideLayouts/slideLayout1.xml": "<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>",
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels":
      '<Relationships xmlns="r"><Relationship Id="rId1" Type="t/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>',
    "ppt/slideMasters/slideMaster1.xml": "<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>",
    "ppt/slideMasters/_rels/slideMaster1.xml.rels":
      '<Relationships xmlns="r"><Relationship Id="rId1" Type="t/theme" Target="../theme/theme1.xml"/>'
      + '<Relationship Id="rId2" Type="t/image" Target="../media/newsprint.png"/></Relationships>',
    "ppt/theme/theme1.xml": "<a:theme/>",
  }).map(([name, value]) => [name, bytes(value)]).concat([
    ["ppt/media/photographer.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])],
    ["ppt/media/newsprint.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7])],
    ["ppt/media/logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 4, 4])],
  ]));
}

const uzbek = (title, body) => [
  { shapeId: "2", paragraphs: [title] },
  { shapeId: "3", paragraphs: [body] },
];

/* --------------------------------------------------------------- the parts */

test("a relative target is resolved against the part that named it", () => {
  assert.equal(resolveTarget("ppt/slides/slide1.xml", "../media/a.png"), "ppt/media/a.png");
  assert.equal(resolveTarget("ppt/slides/slide1.xml", "/ppt/theme/theme1.xml"), "ppt/theme/theme1.xml");
});

test("a slide brings its layout, its master and their theme with it", () => {
  const kept = closureOf(deck(), ["ppt/slides/slide1.xml"]);
  for (const part of [
    "ppt/slideLayouts/slideLayout1.xml", "ppt/slideMasters/slideMaster1.xml", "ppt/theme/theme1.xml",
  ]) {
    assert.ok(kept.has(part), `${part} was left behind`);
  }
});

test("and the pictures, including the one the master paints the ground with", () => {
  const kept = closureOf(deck(), ["ppt/slides/slide1.xml"]);
  assert.ok(kept.has("ppt/media/photographer.png"), "the slide's photograph was left behind");
  assert.ok(kept.has("ppt/media/newsprint.png"), "the master's texture was left behind");
});

test("a slide nobody chose does not drag its media in", () => {
  const kept = closureOf(deck(), ["ppt/slides/slide1.xml"]);
  assert.ok(!kept.has("ppt/slides/slide3.xml"));
  assert.ok(!kept.has("ppt/media/logo.png"));
});

test("a hyperlink is not a part and is not chased", () => {
  const kept = closureOf(deck(), ["ppt/slides/slide1.xml"]);
  assert.ok(![...kept].some((part) => part.startsWith("http")));
});

test("relationships are read tag by tag, external ones marked", () => {
  const rels = readRelationships(decoder.decode(deck().get("ppt/slides/_rels/slide1.xml.rels")));
  assert.equal(rels.length, 3);
  assert.equal(rels.find((entry) => entry.id === "rId3").external, true);
});

/* ------------------------------------------------------------- the package */

test("a cloned deck holds the chosen slides, in the order chosen", async () => {
  const { files, report } = clonePresentation(deck(), [
    { sourcePart: "ppt/slides/slide3.xml", edits: uzbek("RAHMAT", "Ko‘rishguncha") },
    { sourcePart: "ppt/slides/slide1.xml", edits: uzbek("JURNALISTIKA", "Talabalar tahririyati") },
  ]);
  assert.deepEqual(report.problems, []);

  const entries = await unzip(await zip(files));
  const presentation = decoder.decode(entries.get("ppt/presentation.xml"));
  const order = [...presentation.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(order.length, 2);

  const rels = decoder.decode(entries.get("ppt/_rels/presentation.xml.rels"));
  const targets = order.map((relId) =>
    new RegExp(`Id="${relId}"[^>]*Target="([^"]+)"`).exec(rels)[1]);
  assert.deepEqual(targets, ["slides/slide3.xml", "slides/slide1.xml"]);
});

test("the image bytes are the original bytes, not a re-encoding", async () => {
  const source = deck();
  const { files } = clonePresentation(source, [
    { sourcePart: "ppt/slides/slide1.xml", edits: uzbek("JURNALISTIKA", "Matn") },
  ]);
  const entries = await unzip(await zip(files));
  assert.deepEqual(
    [...entries.get("ppt/media/photographer.png")],
    [...source.get("ppt/media/photographer.png")],
  );
});

test("everything but the words survives in the slide part", async () => {
  const { files } = clonePresentation(deck(), [
    { sourcePart: "ppt/slides/slide1.xml", edits: uzbek("JURNALISTIKA ASOSLARI", "Talabalar tahririyati") },
  ]);
  const entries = await unzip(await zip(files));
  const slide = decoder.decode(entries.get("ppt/slides/slide1.xml"));

  for (const fragment of ['<a:xfrm rot="900000"/>', '<a:blip r:embed="rId2"/>', '<p:ph type="title"/>', "<p:cxnSp>"]) {
    assert.ok(slide.includes(fragment), `lost: ${fragment}`);
  }
  assert.ok(!slide.includes("CAMPUS"), "the template's words shipped");
  assert.equal(readTextObjects(slide)[0].text, "JURNALISTIKA ASOSLARI");
});

test("the manifest lists what is there and nothing else", async () => {
  const { files } = clonePresentation(deck(), [
    { sourcePart: "ppt/slides/slide1.xml", edits: uzbek("A", "B") },
  ]);
  const entries = await unzip(await zip(files));
  const manifest = decoder.decode(entries.get("[Content_Types].xml"));

  assert.ok(manifest.includes('PartName="/ppt/slides/slide1.xml"'));
  assert.ok(!manifest.includes('PartName="/ppt/slides/slide2.xml"'), "a part that is not here is still declared");
  // Defaults describe extensions rather than parts and are left alone.
  assert.ok(manifest.includes('Extension="png"'));

  for (const declared of manifest.matchAll(/PartName="\/([^"]+)"/g)) {
    assert.ok(entries.has(declared[1]), `declared but missing: ${declared[1]}`);
  }
});

test("a page used twice becomes two parts, edited apart", async () => {
  const { files, report } = clonePresentation(deck(), [
    { sourcePart: "ppt/slides/slide2.xml", edits: uzbek("BIRINCHI", "Bir") },
    { sourcePart: "ppt/slides/slide2.xml", edits: uzbek("IKKINCHI", "Ikki") },
  ]);
  const entries = await unzip(await zip(files));

  assert.equal(report.slides[1].outputPart, "ppt/slides/slide2_c2.xml");
  assert.ok(entries.has("ppt/slides/_rels/slide2_c2.xml.rels"), "the copy has no relationships of its own");

  const first = readTextObjects(decoder.decode(entries.get("ppt/slides/slide2.xml")))[0].text;
  const second = readTextObjects(decoder.decode(entries.get("ppt/slides/slide2_c2.xml")))[0].text;
  assert.equal(first, "BIRINCHI");
  assert.equal(second, "IKKINCHI");

  const manifest = decoder.decode(entries.get("[Content_Types].xml"));
  assert.ok(manifest.includes('PartName="/ppt/slides/slide2_c2.xml"'), "the copy is not declared");
});

/* -------------------------------------------------------------- the report */

test("the report counts what was preserved, for a structural check", () => {
  const { report } = clonePresentation(deck(), [
    { sourcePart: "ppt/slides/slide1.xml", edits: uzbek("A", "B") },
  ]);
  // Two text boxes, a picture and a connector: two objects that are not text.
  assert.equal(report.slides[0].nonTextObjectsPreserved, 2);
  assert.equal(report.slides[0].textObjectsReplaced, 2);
  assert.deepEqual(report.mediaParts, ["ppt/media/newsprint.png", "ppt/media/photographer.png"]);
});

test("counting visual objects does not count text boxes", () => {
  assert.equal(countVisualObjects(slideXml("A", "B")), 2);
});

test("template copy that survived is a problem, not a footnote", () => {
  const { report } = clonePresentation(deck(), [
    // The body is left unmentioned, so its sample sentence would ship.
    { sourcePart: "ppt/slides/slide1.xml", edits: [{ shapeId: "2", paragraphs: ["JURNALISTIKA"] }] },
  ]);
  assert.ok(report.problems.some((problem) => problem.code === "template_text_remains"));
  assert.ok(report.leftoverText.length > 0);
});

test("a page that is not in the package is reported rather than guessed at", () => {
  const { report } = clonePresentation(deck(), [
    { sourcePart: "ppt/slides/slide9.xml", edits: [] },
  ]);
  assert.ok(report.problems.some((problem) => problem.code === "missing_slide"));
});

/* ------------------------------------------------- joining a deck to its source */

const { exportByCloning, planClone } = await import(`${edge}/pptx-clone-export.js`);

const profiles = [
  {
    archetype_id: "page_01",
    source_slide_part: "ppt/slides/slide1.xml",
    text_map: [
      { binding: "title", shapeId: "2", elementId: "page_01_title", paragraphs: 1 },
      { binding: "body", shapeId: "3", elementId: "page_01_body", paragraphs: 1 },
    ],
  },
  {
    archetype_id: "page_03",
    source_slide_part: "ppt/slides/slide3.xml",
    // Every text box on the page, because one left unmapped is one whose
    // sample sentence ships — which the guard catches, and which a real import
    // never produces since the adapter maps them all.
    text_map: [
      { binding: "title", shapeId: "2", elementId: "page_03_title", paragraphs: 1 },
      { binding: "body", shapeId: "3", elementId: "page_03_body", paragraphs: 1 },
    ],
  },
];

const deckSlides = [
  { id: "s1", position: 0, quality_report: { engine: "pptx_clone", archetype: "page_01" } },
  { id: "s2", position: 1, quality_report: { engine: "pptx_clone", archetype: "page_03" } },
];

const deckElements = [
  { slide_id: "s1", type: "text", content: { elementId: "page_01_title", text: "JURNALISTIKA ASOSLARI" } },
  { slide_id: "s1", type: "text", content: { elementId: "page_01_body", text: "Talabalar tahririyati" } },
  { slide_id: "s1", type: "image", content: { slot: "art_1" } },
  { slide_id: "s2", type: "text", content: { elementId: "page_03_title", text: "RAHMAT" } },
  { slide_id: "s2", type: "text", content: { elementId: "page_03_body", text: "Ko‘rishguncha" } },
];

test("the plan follows the deck's own order and its own words", () => {
  const planned = planClone(deckSlides, deckElements, profiles);
  assert.equal(planned.ok, true);
  assert.deepEqual(planned.plan.map((entry) => entry.sourcePart),
    ["ppt/slides/slide1.xml", "ppt/slides/slide3.xml"]);
  assert.deepEqual(planned.plan[0].edits[0], { shapeId: "2", paragraphs: ["JURNALISTIKA ASOSLARI"] });
});

test("a slide bound to no template page is refused rather than approximated", () => {
  const orphan = [{ id: "s9", position: 0, quality_report: { archetype: "cover_01" } }];
  const planned = planClone(orphan, [], profiles);
  assert.equal(planned.ok, false);
  assert.match(planned.reason, /bog'lanmagan/);
});

test("copy the user edited is what gets exported", () => {
  const edited = deckElements.map((element) =>
    element.content.elementId === "page_01_title"
      ? { ...element, content: { ...element.content, text: "QO‘LDA TAHRIRLANGAN" } }
      : element);
  const planned = planClone(deckSlides, edited, profiles);
  assert.equal(planned.plan[0].edits[0].paragraphs[0], "QO‘LDA TAHRIRLANGAN");
});

test("a multi-line box is written back as the number of paragraphs it had", () => {
  const threeLine = [{
    archetype_id: "page_01",
    source_slide_part: "ppt/slides/slide1.xml",
    text_map: [{ binding: "bullets", shapeId: "3", elementId: "page_01_bullets", paragraphs: 3 }],
  }];
  const rows = [{ slide_id: "s1", type: "text", content: { elementId: "page_01_bullets", text: "Bir\nIkki\nUch\nTo‘rt" } }];
  const planned = planClone([deckSlides[0]], rows, threeLine);
  // Three paragraphs, the surplus folded into the last rather than dropped.
  assert.equal(planned.plan[0].edits[0].paragraphs.length, 3);
  assert.equal(planned.plan[0].edits[0].paragraphs[2], "Uch To‘rt");
});

test("an export is the template's package with the deck's words in it", async () => {
  const bytes = await zip([...deck()].map(([name, value]) => ({ name, bytes: value })));
  const result = await exportByCloning(bytes, deckSlides, deckElements, profiles);
  assert.equal(result.ok, true, result.ok ? "" : result.reason);

  const entries = await unzip(result.bytes);
  const slide = decoder.decode(entries.get("ppt/slides/slide1.xml"));
  assert.equal(readTextObjects(slide)[0].text, "JURNALISTIKA ASOSLARI");
  assert.ok(slide.includes('<a:blip r:embed="rId2"/>'), "the photograph's relationship was lost");
  assert.ok(entries.has("ppt/media/photographer.png"), "the photograph itself was lost");
  assert.ok(entries.has("ppt/media/newsprint.png"), "the master's texture was lost");
  assert.equal(result.report.slides[0].nonTextObjectsPreserved, 2);
});

test("template copy that survived fails the export rather than shipping", async () => {
  const bytes = await zip([...deck()].map(([name, value]) => ({ name, bytes: value })));
  // The body is left unmentioned, so its sample sentence would still be there.
  const thin = [{ ...profiles[0], text_map: [profiles[0].text_map[0]] }];
  const result = await exportByCloning(bytes, [deckSlides[0]], deckElements, thin);
  assert.equal(result.ok, false);
  assert.match(result.reason, /almashtirilmagan/);
});

/* ------------------------------------------- every box, or nothing ships */

/**
 * The rule the whole mode rests on.
 *
 * A source slide has more text boxes than a design has fields for — a cover
 * with eleven, a vocabulary with eight — and the boxes with no field are
 * exactly the ones that used to keep the template's own English. So the plan
 * covers every box in the map, drawing from what the generator wrote for the
 * ones the preview never drew, and a gap is a refusal rather than a slide
 * somebody finds later.
 */

const slotRow = (shapeId, over = {}) => ({ shapeId, paragraphs: 1, binding: null, elementId: null, ...over });

test("a box with no preview field is written from what the generator stored", () => {
  const profiles = [{
    archetype_id: "page_01",
    source_slide_part: "ppt/slides/slide1.xml",
    text_map: [slotRow("2", { binding: "title", elementId: "page_01_title" }), slotRow("9")],
  }];
  const slides = [{
    id: "s1",
    position: 0,
    quality_report: { archetype: "page_01", slots: { 2: "Tahrirlangan", 9: "Ko‘rinmagan quti" } },
  }];
  const elements = [{ slide_id: "s1", type: "text", content: { elementId: "page_01_title", text: "Tahrirlangan" } }];

  const planned = planClone(slides, elements, profiles);
  assert.ok(planned.ok);
  assert.equal(planned.plan[0].edits.length, 2);
  assert.deepEqual(planned.plan[0].edits.find((edit) => edit.shapeId === "9").paragraphs, ["Ko‘rinmagan quti"]);
});

test("an edited element still beats what the generator wrote for the same box", () => {
  const profiles = [{
    archetype_id: "page_01",
    source_slide_part: "ppt/slides/slide1.xml",
    text_map: [slotRow("2", { binding: "title", elementId: "page_01_title" })],
  }];
  const slides = [{ id: "s1", position: 0, quality_report: { archetype: "page_01", slots: { 2: "Yozilgan" } } }];
  const elements = [{ slide_id: "s1", type: "text", content: { elementId: "page_01_title", text: "Foydalanuvchi yozgani" } }];

  const planned = planClone(slides, elements, profiles);
  assert.ok(planned.ok);
  assert.deepEqual(planned.plan[0].edits[0].paragraphs, ["Foydalanuvchi yozgani"]);
});

test("a box nothing wrote to is refused rather than left saying the template", () => {
  const profiles = [{
    archetype_id: "page_01",
    source_slide_part: "ppt/slides/slide1.xml",
    text_map: [slotRow("2", { binding: "title", elementId: "page_01_title" }), slotRow("9", { shapeName: "TextBox 9" })],
  }];
  const slides = [{ id: "s1", position: 0, quality_report: { archetype: "page_01", slots: { 2: "Sarlavha" } } }];
  const elements = [];

  const planned = planClone(slides, elements, profiles);
  assert.equal(planned.ok, false);
  assert.match(planned.reason, /TextBox 9/);
});

test("the report says what came through, per page and for the deck", () => {
  const entries = deck();
  const { report } = clonePresentation(entries, [
    { sourcePart: "ppt/slides/slide1.xml", edits: [{ shapeId: "2", paragraphs: ["Yangi"] }] },
  ]);
  assert.equal(report.slides[0].textObjectsFound, 2);
  assert.equal(report.slides[0].structuralFidelityPassed, true);
  assert.equal(report.structuralFidelityPassed, true);
});

test("a box still holding the template's own words is emptied rather than refused", () => {
  const profiles = [{
    archetype_id: "page_01",
    source_slide_part: "ppt/slides/slide1.xml",
    text_map: [slotRow("2", { originalText: "www.reallygreatsite.com" })],
  }];
  const slides = [{
    id: "s1",
    position: 0,
    // What a deck generated before the writer caught this still has stored.
    quality_report: { archetype: "page_01", slots: { 2: "www.reallygreatsite.com" } },
  }];

  const planned = planClone(slides, [], profiles);
  assert.ok(planned.ok, planned.ok ? "" : planned.reason);
  assert.deepEqual(planned.plan[0].edits[0].paragraphs, [""]);
});

test("copy that merely resembles a short original is left alone", () => {
  const profiles = [{
    archetype_id: "page_01",
    source_slide_part: "ppt/slides/slide1.xml",
    text_map: [slotRow("2", { originalText: "2026" })],
  }];
  const slides = [{ id: "s1", position: 0, quality_report: { archetype: "page_01", slots: { 2: "2026" } } }];
  const planned = planClone(slides, [], profiles);
  assert.ok(planned.ok);
  assert.deepEqual(planned.plan[0].edits[0].paragraphs, ["2026"]);
});

/* ------------------------------------------------------ replacing pictures */

const bytesOf = (files, name) => files.find((file) => file.name === name)?.bytes;

test("a picture's bytes are replaced without touching the slide", () => {
  /**
   * The whole reason to swap the media part rather than rewrite the markup: the
   * crop, the frame, the shadow and every effect the designer set are in the
   * slide, and they survive untouched because nothing in the slide changes.
   */
  const fresh = new TextEncoder().encode("a new photograph");
  const { files, report } = clonePresentation(deck(), [{
    sourcePart: "ppt/slides/slide1.xml",
    edits: uzbek("JURNALISTIKA", "Talabalar tahririyati"),
    media: [{ part: "ppt/media/photographer.png", bytes: fresh }],
  }]);

  assert.deepEqual(bytesOf(files, "ppt/media/photographer.png"), fresh);
  assert.deepEqual(report.pictureReplacements, ["ppt/media/photographer.png"]);

  // The slide still points where it always did, and still says what it said.
  const slide = decoder.decode(bytesOf(files, "ppt/slides/slide1.xml"));
  assert.match(slide, /r:embed="rId2"/);
  assert.match(slide, /JURNALISTIKA/);
});

test("a picture nobody asked about keeps the template's own bytes", () => {
  const before = deck().get("ppt/media/newsprint.png");
  const { files } = clonePresentation(deck(), [{
    sourcePart: "ppt/slides/slide1.xml",
    edits: [],
    media: [{ part: "ppt/media/photographer.png", bytes: new TextEncoder().encode("x") }],
  }]);
  assert.deepEqual(bytesOf(files, "ppt/media/newsprint.png"), before);
});

test("two pages asking for different pictures in one part get neither", () => {
  /**
   * A media part is one file however many slides point at it. Letting the last
   * writer win would change a page nobody asked about, so the template's own
   * picture stays and the contradiction is reported rather than resolved.
   */
  const { files, report } = clonePresentation(deck(), [
    { sourcePart: "ppt/slides/slide1.xml", edits: [], media: [{ part: "ppt/media/photographer.png", bytes: new TextEncoder().encode("first") }] },
    { sourcePart: "ppt/slides/slide3.xml", edits: [], media: [{ part: "ppt/media/photographer.png", bytes: new TextEncoder().encode("second") }] },
  ]);

  assert.deepEqual(bytesOf(files, "ppt/media/photographer.png"), deck().get("ppt/media/photographer.png"));
  assert.deepEqual(report.pictureReplacements, []);
  assert.ok(report.problems.some((problem) => problem.code === "picture_contested"));
});

test("a replacement for a part no chosen slide draws is not shipped", () => {
  // Otherwise the package grows a file nothing points at, and the deck carries
  // a photograph nobody will ever see.
  const { files } = clonePresentation(deck(), [{
    sourcePart: "ppt/slides/slide1.xml",
    edits: [],
    media: [{ part: "ppt/media/logo.png", bytes: new TextEncoder().encode("unused") }],
  }]);
  assert.equal(bytesOf(files, "ppt/media/logo.png"), undefined);
});

test("a deck with no picture replacements is byte-for-byte what it was", () => {
  // The feature must be invisible when it is not used: every existing template
  // export has to keep producing exactly the file it produced before.
  const plain = clonePresentation(deck(), [{ sourcePart: "ppt/slides/slide1.xml", edits: [] }]);
  const withEmpty = clonePresentation(deck(), [{ sourcePart: "ppt/slides/slide1.xml", edits: [], media: [] }]);

  assert.deepEqual(plain.files.map((file) => file.name), withEmpty.files.map((file) => file.name));
  for (const file of plain.files) {
    assert.deepEqual(bytesOf(withEmpty.files, file.name), file.bytes, `${file.name} changed`);
  }
});

/* ------------------------------------------- choosing which hole to fill */

const { placePictures } = await import(`${edge}/pptx-clone-export.js`);

test("the photograph goes in the picture whose shape it fits", () => {
  /**
   * Not simply the biggest. A landscape photograph dropped into a portrait
   * frame is a face cropped to its ear, and a template that offers both holes
   * is offering a choice the export is the only part able to make — it is the
   * one holding the package and can see how big each picture is.
   */
  const plan = [{ sourcePart: "ppt/slides/slide1.xml", edits: [] }];
  const wide = { bytes: new TextEncoder().encode("wide"), aspect: 16 / 9 };

  const [placed] = placePictures(deck(), plan, new Map([[0, wide]]));
  assert.equal(placed.media.length, 1);
  assert.equal(placed.media[0].part, "ppt/media/photographer.png");
  assert.deepEqual(placed.media[0].bytes, wide.bytes);
});

test("a page with no picture asked for is returned untouched", () => {
  const plan = [{ sourcePart: "ppt/slides/slide1.xml", edits: [] }];
  const [same] = placePictures(deck(), plan, new Map());
  assert.equal(same.media, undefined, "an untouched page must not grow an empty edit list");
});

test("one source page used twice is not a shared picture", () => {
  /**
   * A deck routinely uses one page twice, and that is not sharing — it is the
   * same page appearing twice, already showing the same picture in both places.
   * Counting occurrences rather than distinct pages made every repeated page
   * look contested and blocked the replacement it was asking for, which is
   * exactly what happened on the first real template this ran against.
   */
  const plan = [
    { sourcePart: "ppt/slides/slide1.xml", edits: [] },
    { sourcePart: "ppt/slides/slide1.xml", edits: [] },
  ];
  const placed = placePictures(deck(), plan, new Map([[0, { bytes: new TextEncoder().encode("x"), aspect: 1.5 }]]));
  assert.equal(placed[0].media?.[0]?.part, "ppt/media/photographer.png");
});

test("two different pages drawing one picture leave it alone", () => {
  // The bytes are one file: changing them for the page that asked would change
  // the page that did not.
  const shared = new Map(deck());
  // Point slide3 at the same photograph slide1 draws.
  shared.set("ppt/slides/_rels/slide3.xml.rels", new TextEncoder().encode(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="t/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'
    + '<Relationship Id="rId2" Type="t/image" Target="../media/photographer.png"/></Relationships>',
  ));

  const placed = placePictures(shared, [
    { sourcePart: "ppt/slides/slide1.xml", edits: [] },
    { sourcePart: "ppt/slides/slide3.xml", edits: [] },
  ], new Map([[0, { bytes: new TextEncoder().encode("x"), aspect: 1.5 }]]));

  assert.equal(placed[0].media, undefined);
});
