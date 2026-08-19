import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { MAX_TEMPLATE_SLIDES, escapesPackage, fontNamesIn, hashableParts, inspectPackage, packageHash } =
  await import(`${edge}/pptx-safety.js`);

/**
 * What an uploaded template is allowed to be.
 *
 * A `.pptx` is a ZIP an administrator uploaded: untrusted content arriving with
 * trusted credentials, which is the combination that gets waved through. These
 * are the rules that stop it, and the rule that decides whether two uploads are
 * the same design.
 */

const encoder = new TextEncoder();
const bytes = (text) => encoder.encode(text);

/** The smallest thing that passes, so each test can break exactly one rule. */
function deck(overrides = {}) {
  const entries = new Map([
    ["[Content_Types].xml", bytes('<Types xmlns="..."><Override ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide"/></Types>')],
    ["ppt/presentation.xml", bytes("<p:presentation/>")],
    ["ppt/slides/slide1.xml", bytes("<p:sld/>")],
    ["ppt/theme/theme1.xml", bytes('<a:theme><a:latin typeface="Inter"/></a:theme>')],
  ]);
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) entries.delete(name);
    else entries.set(name, typeof value === "string" ? bytes(value) : value);
  }
  return entries;
}

const codes = (report) => report.problems.map((problem) => problem.code);

/* ------------------------------------------------------------- acceptance */

test("a plain template is accepted", () => {
  const report = inspectPackage(deck());
  assert.equal(report.ok, true, codes(report).join(", "));
  assert.deepEqual(report.slideParts, ["ppt/slides/slide1.xml"]);
});

test("slides come back in the deck's order, not the alphabet's", () => {
  // `slide10` sorts before `slide2` as text, and the order is the running order.
  const entries = deck();
  for (const index of [2, 10, 3]) entries.set(`ppt/slides/slide${index}.xml`, bytes("<p:sld/>"));

  const report = inspectPackage(entries);
  assert.deepEqual(report.slideParts.map((part) => part.match(/slide(\d+)/)[1]), ["1", "2", "3", "10"]);
});

/* --------------------------------------------------------------- refusals */

test("a file that is not a presentation is refused", () => {
  const report = inspectPackage(deck({ "[Content_Types].xml": "<Types><Override ContentType=\"spreadsheetml\"/></Types>" }));
  assert.ok(codes(report).includes("not_a_presentation"));
});

test("macros are refused", () => {
  // A template runs nothing. A macro project in one is either a mistake or the
  // reason the file was sent.
  const report = inspectPackage(deck({ "ppt/vbaProject.bin": "\0\0" }));
  assert.ok(codes(report).includes("macros"));
});

test("an embedded object is refused", () => {
  const report = inspectPackage(deck({ "ppt/embeddings/Workbook.xlsx": "PK\u0003\u0004" }));
  assert.ok(codes(report).includes("embedded_object"));
});

test("a part that points outside the package is refused", () => {
  // A template fetching a picture from somebody's server renders differently
  // every time, and stops rendering when that server does.
  const report = inspectPackage(deck({
    "ppt/slides/_rels/slide1.xml.rels":
      '<Relationships><Relationship Id="rId1" Type=".../image" Target="https://example.test/logo.png" TargetMode="External"/></Relationships>',
  }));
  assert.ok(codes(report).includes("external_reference"));
});

test("a hyperlink is not an external reference", () => {
  // Somebody clicks a hyperlink. The renderer never fetches it.
  const report = inspectPackage(deck({
    "ppt/slides/_rels/slide1.xml.rels":
      '<Relationships><Relationship Id="rId1" Type=".../hyperlink" Target="https://example.test" TargetMode="External"/></Relationships>',
  }));
  assert.equal(codes(report).includes("external_reference"), false, codes(report).join(", "));
});

test("a package with no slides is refused", () => {
  const report = inspectPackage(deck({ "ppt/slides/slide1.xml": null }));
  assert.ok(codes(report).includes("no_slides"));
});

test("a whole presentation is refused as a template", () => {
  // A design family is a handful of pages. A sixty-slide deck is somebody's
  // talk, and importing it as a template would fill the catalogue with it.
  const entries = deck();
  for (let index = 2; index <= MAX_TEMPLATE_SLIDES + 5; index += 1) {
    entries.set(`ppt/slides/slide${index}.xml`, bytes("<p:sld/>"));
  }
  assert.ok(codes(inspectPackage(entries)).includes("too_many_slides"));
});

test("an enormous picture is refused, and says which", () => {
  const report = inspectPackage(deck({ "ppt/media/image1.png": new Uint8Array(13 * 1024 * 1024) }));
  const problem = report.problems.find((entry) => entry.code === "oversized_media");
  assert.ok(problem);
  assert.match(problem.part, /image1\.png/);
});

test("every problem is reported, not just the first", () => {
  // An admin fixing a template wants the list. Finding out about the macros
  // only after removing the embedded workbook is two round trips for one file.
  const report = inspectPackage(deck({
    "ppt/vbaProject.bin": "\0",
    "ppt/embeddings/Book.xlsx": "PK",
  }));
  assert.ok(codes(report).includes("macros"));
  assert.ok(codes(report).includes("embedded_object"));
});

/* ------------------------------------------------------- path traversal */

test("a name that would escape the package is refused", () => {
  for (const name of ["../secrets", "/etc/passwd", "C:\\windows", "ppt/../../x"]) {
    assert.equal(escapesPackage(name), true, `${name} should be refused`);
  }
});

test("a name that merely walks back inside itself is fine", () => {
  for (const name of ["ppt/slides/../slides/slide1.xml", "ppt/media/image1.png", "./ppt/x.xml"]) {
    assert.equal(escapesPackage(name), false, `${name} should be allowed`);
  }
});

/* ---------------------------------------------------------------- fonts */

test("typefaces are found wherever they are named", () => {
  /**
   * A template that sets its heading face only in the master would otherwise
   * look like it uses none, so the raw XML is read rather than the parsed
   * slides.
   */
  const report = inspectPackage(deck({
    "ppt/slideMasters/slideMaster1.xml": '<p:sldMaster><a:latin typeface="Bebas Neue"/></p:sldMaster>',
    "ppt/slides/slide1.xml": '<p:sld><a:latin typeface="Inter"/><a:ea typeface="Inter"/></p:sld>',
  }));
  assert.deepEqual(report.fontNames, ["Bebas Neue", "Inter"]);
});

test("a theme reference is not a font name", () => {
  // `+mj-lt` points at the theme's own major face. Following it is the theme's
  // job; recording it as a typeface would put "+mj-lt" in the font library.
  const names = fontNamesIn(deck({ "ppt/slides/slide1.xml": '<p:sld><a:latin typeface="+mj-lt"/></p:sld>' }));
  assert.equal(names.includes("+mj-lt"), false);
});

/* ----------------------------------------------------------- identity */

test("the same design hashes the same from two machines", async () => {
  /**
   * PowerPoint rewrites `docProps/core.xml` on every save — the author, the
   * revision, the moment — and regenerates the thumbnail. Hashing those would
   * make one template arriving from two laptops look like two designs, which is
   * the failure this exists to prevent.
   */
  const first = deck({
    "docProps/core.xml": "<cp:coreProperties><dcterms:modified>2026-08-01</dcterms:modified></cp:coreProperties>",
    "docProps/thumbnail.jpeg": "aaaa",
  });
  const second = deck({
    "docProps/core.xml": "<cp:coreProperties><dcterms:modified>2026-08-19</dcterms:modified></cp:coreProperties>",
    "docProps/thumbnail.jpeg": "bbbb",
  });

  assert.equal(await packageHash(first), await packageHash(second));
});

test("a different design hashes differently", async () => {
  const changed = deck({ "ppt/slides/slide1.xml": "<p:sld><p:different/></p:sld>" });
  assert.notEqual(await packageHash(deck()), await packageHash(changed));
});

test("the hash cannot be confused by where one part ends", async () => {
  // Length-prefixed, so a part named `a` holding `bc` cannot hash the same as
  // one named `ab` holding `c`.
  const left = new Map([["ppt/a", bytes("bc")], ["[Content_Types].xml", bytes("presentationml")], ["ppt/slides/slide1.xml", bytes("x")]]);
  const right = new Map([["ppt/ab", bytes("c")], ["[Content_Types].xml", bytes("presentationml")], ["ppt/slides/slide1.xml", bytes("x")]]);
  assert.notEqual(await packageHash(left), await packageHash(right));
});

test("volatile parts are excluded from identity", () => {
  const parts = hashableParts(deck({ "docProps/app.xml": "<x/>", "docProps/thumbnail.jpeg": "y" }));
  assert.equal(parts.some((part) => part.startsWith("docProps/")), false);
  assert.ok(parts.includes("ppt/slides/slide1.xml"));
});
