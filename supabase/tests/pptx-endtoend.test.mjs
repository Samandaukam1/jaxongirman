import assert from "node:assert/strict";
import test from "node:test";
import { crc32 } from "node:zlib";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { unzip } = await import(`${edge}/unzip.js`);
const { inspectPackage, packageHash } = await import(`${edge}/pptx-safety.js`);
const { readPptx } = await import(`${edge}/pptx.js`);
const { toJslaydDocument } = await import(`${edge}/pptx-design.js`);
const { factsFor, readSlideProfiles } = await import(`${edge}/pptx-classify.js`);
const { planDeckLayout } = await import(`${edge}/layout-brief.js`);
const { readDocument } = await import(`${edge}/jslayd/serialize.js`);
const { decompile } = await import(`${edge}/jslayd/decompile.js`);

/**
 * One real file, all the way through.
 *
 * Every other test in this feature holds one stage still and checks it. This
 * builds an actual ZIP and walks it through unzip, inspection, parsing,
 * conversion, classification and layout planning, because a set of correct
 * links is not the same thing as a chain.
 *
 * The property it exists for is the one that cannot be allowed to fail: no word
 * of the template reaches anything a customer could see.
 */

const encoder = new TextEncoder();

/**
 * A ZIP with every entry stored rather than deflated.
 *
 * Uncompressed is a real ZIP — `unzip.ts` reads method 0 — and writing one
 * needs no compressor, so the fixture stays a fixture instead of quietly
 * becoming a second implementation of something.
 */
function zip(files) {
  const chunks = [];
  const directory = [];
  let offset = 0;

  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const sum = crc32(Buffer.from(data)) >>> 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 0, true);       // stored
    local.setUint32(14, sum, true);
    local.setUint32(18, data.byteLength, true);
    local.setUint32(22, data.byteLength, true);
    local.setUint16(26, nameBytes.byteLength, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(10, 0, true);
    entry.setUint32(16, sum, true);
    entry.setUint32(20, data.byteLength, true);
    entry.setUint32(24, data.byteLength, true);
    entry.setUint16(28, nameBytes.byteLength, true);
    entry.setUint32(42, offset, true);
    directory.push([new Uint8Array(entry.buffer), nameBytes]);

    offset += 30 + nameBytes.byteLength + data.byteLength;
  }

  const directoryAt = offset;
  let directorySize = 0;
  for (const [entry, nameBytes] of directory) {
    chunks.push(entry, nameBytes);
    directorySize += entry.byteLength + nameBytes.byteLength;
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, directory.length, true);
  end.setUint16(10, directory.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, directoryAt, true);
  chunks.push(new Uint8Array(end.buffer));

  let length = 0;
  for (const chunk of chunks) length += chunk.byteLength;
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return out;
}

/* ------------------------------------------------------------- the fixture */

/** The words that must not survive. Distinctive, so a grep cannot miss them. */
const TEMPLATE_WORDS = ["Zenithcorp", "Q3 Revenue Highlights", "Lorem ipsum dolor", "ceo@zenithcorp.example"];

const THEME = `<a:theme xmlns:a="x"><a:themeElements>
  <a:clrScheme>
    <a:dk1><a:srgbClr val="14161A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
    <a:accent1><a:srgbClr val="E8452C"/></a:accent1>
  </a:clrScheme>
  <a:fontScheme>
    <a:majorFont><a:latin typeface="Playfair Display"/></a:majorFont>
    <a:minorFont><a:latin typeface="Inter"/></a:minorFont>
  </a:fontScheme>
</a:themeElements></a:theme>`;

const unit = { x: 12192000 / 12, y: 6858000 / 12 };
const box = (x, y, width, height) =>
  `<a:xfrm><a:off x="${x * unit.x}" y="${y * unit.y}"/><a:ext cx="${width * unit.x}" cy="${height * unit.y}"/></a:xfrm>`;

const textBox = (placeholder, geometry, text, size) => `<p:sp>
  <p:nvSpPr><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr>
  <p:spPr>${geometry}</p:spPr>
  <p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="${size}"><a:latin typeface="+mj-lt"/></a:rPr><a:t>${text}</a:t></a:r></a:p></p:txBody>
</p:sp>`;

const slide = (inner) => `<p:sld><p:cSld><p:spTree>${inner}</p:spTree></p:cSld></p:sld>`;

/** Four pages: a cover, a body page with a picture, a statistic and a sign-off. */
const SLIDES = [
  slide(
    textBox('<p:ph type="ctrTitle"/>', box(1, 4, 10, 2), "Zenithcorp", 5400)
    + textBox('<p:ph type="subTitle" idx="1"/>', box(1, 6, 10, 1), "Q3 Revenue Highlights", 2000),
  ),
  slide(
    textBox('<p:ph type="title"/>', box(1, 1, 10, 2), "Q3 Revenue Highlights", 4000)
    + textBox('<p:ph type="body" idx="1"/>', box(1, 4, 6, 5), "Lorem ipsum dolor sit amet consectetur", 1800)
    + `<p:pic><p:nvPicPr><p:nvPr><p:ph type="pic" idx="2"/></p:nvPr></p:nvPicPr>
       <p:blipFill><a:blip r:embed="rId9"/></p:blipFill><p:spPr>${box(7, 4, 4, 5)}</p:spPr></p:pic>`,
  ),
  slide(
    textBox('<p:ph type="title"/>', box(1, 3, 10, 3), "148%", 9600)
    + textBox("", box(1, 7, 10, 1), "ceo@zenithcorp.example", 1400),
  ),
  slide(textBox('<p:ph type="ctrTitle"/>', box(1, 5, 10, 2), "Thank you", 5400)),
];

function template() {
  const files = {
    "[Content_Types].xml": '<Types><Default ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    "ppt/theme/theme1.xml": THEME,
    "ppt/slideMasters/slideMaster1.xml": "<p:sldMaster><p:cSld><p:spTree/></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz='4000'/></a:lvl1pPr></p:titleStyle></p:txStyles></p:sldMaster>",
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": "<Relationships/>",
    "ppt/slideLayouts/slideLayout1.xml": "<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>",
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels":
      '<Relationships><Relationship Id="rId1" Target="../slideMasters/slideMaster1.xml"/></Relationships>',
    "ppt/media/image1.png": "not-really-a-png-but-bytes-all-the-same",
    "docProps/core.xml": "<cp:coreProperties><dc:creator>Designer</dc:creator><cp:revision>7</cp:revision></cp:coreProperties>",
    "ppt/presentation.xml":
      `<p:presentation><p:sldIdLst>${SLIDES.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join("")}</p:sldIdLst>`
      + `<p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels":
      `<Relationships>${SLIDES.map((_, index) => `<Relationship Id="rId${index + 1}" Target="slides/slide${index + 1}.xml"/>`).join("")}</Relationships>`,
  };
  SLIDES.forEach((xml, index) => {
    files[`ppt/slides/slide${index + 1}.xml`] = xml;
    files[`ppt/slides/_rels/slide${index + 1}.xml.rels`] =
      '<Relationships><Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml"/>'
      + '<Relationship Id="rId9" Target="../media/image1.png"/></Relationships>';
  });
  return zip(files);
}

/* ------------------------------------------------------------------ the run */

const entries = await unzip(template());
const report = inspectPackage(entries);
const deck = readPptx(entries);
const draft = toJslaydDocument(deck, { name: "Studio Zenith", slug: "studio-zenith", tier: "great" });
const profiles = readSlideProfiles(null, draft.pages);

test("a real package is unzipped and accepted", () => {
  assert.equal(report.ok, true, report.problems.map((entry) => entry.message).join("; "));
  assert.equal(report.slideParts.length, 4);
});

test("the typefaces the file names are discovered", () => {
  assert.ok(report.fontNames.includes("Playfair Display"));
  assert.ok(report.fontNames.includes("Inter"));
});

test("the same drawing hashes the same however often it is packed", async () => {
  const first = await packageHash(entries);
  assert.equal(await packageHash(await unzip(template())), first);
});

/**
 * The boundary, checked from the outside.
 *
 * This walk built a document and then used it — with the functions that built
 * it. Everything that later reads a stored design reads it through
 * `readDocument` instead, and that is a different, stricter question.
 *
 * It has to be asked here because it was not, once. The adapter declared
 * `colorFamilies: []`, which is refused where an absent field would have been
 * filled in — so every imported design was stored in a shape the generator
 * could not load and the fonts endpoint answered 422 on. Two unrelated-looking
 * faults, one missing assertion.
 */
test("the document survives being read back the way a stored design is", () => {
  const read = readDocument(draft.document);
  assert.ok(read.document, read.diagnostics.errors.map((entry) => `${entry.code}: ${entry.message}`).join("; "));
});

/**
 * The other boundary: the admin editor.
 *
 * It compiles `source_prompt`, so an imported design needs real source behind
 * it, not a note saying where the file came from. A note opened as four errors
 * — no `[DESIGN]`, no `[COLOR_FAMILY]`, no `[FONTS]`, no slides — and left the
 * design unpublishable.
 */
test("the document writes back out as source an editor would accept", () => {
  const source = decompile(draft.document);
  assert.match(source, /^JSLAYD-DESIGN/);
  for (const section of ["[DESIGN]", "[COLOR_FAMILY", "[FONTS]", "[SLIDE"]) {
    assert.ok(source.includes(section), `${section} missing from the written source`);
  }
});

test("the design carries a named palette, so the phone has a family to offer", () => {
  assert.equal(draft.document.colorFamilies.length, 1);
  assert.match(draft.document.colorFamilies[0].code, /^[a-z][a-z0-9_]*$/);
  assert.ok(draft.document.colorFamilies[0].chartPalette.length > 0);
});

test("every page of the file becomes a page of the design", () => {
  assert.equal(deck.slides.length, 4);
  assert.equal(draft.document.archetypes.length, 4);
});

test("NOT ONE WORD of the template survives into the design", () => {
  const serialised = JSON.stringify(draft.document);
  for (const word of TEMPLATE_WORDS) {
    assert.ok(!serialised.includes(word), `"${word}" reached the document`);
  }
});

test("the heading is kept only where an admin reads it, never in the document", () => {
  assert.equal(draft.pages[0].sourceTitle, "Zenithcorp");
  assert.ok(!JSON.stringify(draft.document).includes("Zenithcorp"));
});

test("nor does any of it reach the stored page profiles", () => {
  const stored = JSON.stringify(profiles);
  for (const word of TEMPLATE_WORDS) {
    assert.ok(!stored.includes(word), `"${word}" reached the profiles`);
  }
});

test("the theme's heading face is resolved through +mj-lt", () => {
  assert.ok(draft.fonts.includes("Playfair Display"), draft.fonts.join(", "));
});

test("the design's own colours are read from what the file paints", () => {
  assert.equal(draft.document.colors.background.toLowerCase(), "#ffffff");
});

test("the picture placeholder becomes a slot the deck fills", () => {
  const withImage = draft.pages.find((page) => page.imageSlots > 0);
  assert.ok(withImage, "no page offered a picture slot");
  const image = withImage.archetype.elements.find((element) => element.type === "image");
  assert.deepEqual(image.source, { bind: "image_1" });
});

test("the cover opens and the last page closes, without anybody being asked", () => {
  assert.equal(profiles[0].role, "welcome");
  const last = profiles[profiles.length - 1];
  assert.ok(last.isTerminal || last.role === "conclusion", `last page was ${last.role}`);
});

test("the facts a classifier is given describe the page rather than invent it", () => {
  const facts = factsFor(draft.pages, deck.slides);
  assert.equal(facts.length, draft.pages.length);
  assert.equal(facts[0].purpose, "cover");
  assert.ok(facts[0].largestFontSize > 30);
});

test("a deck planned against this design lands on its pages and knows their jobs", () => {
  const plan = planDeckLayout(draft.document, [
    { layout: "cover", title: "Mavzu", purpose: "p" },
    { layout: "title_body", title: "Tahlil", purpose: "q" },
    { layout: "statistic", title: "Raqam", purpose: "r" },
    { layout: "thanks", title: "Rahmat", purpose: "s" },
  ], { profiles });

  assert.equal(plan.slides.length, 4);
  assert.equal(plan.slides[0].role, "welcome");
  for (const slide of plan.slides) {
    assert.ok(draft.document.archetypes.some((archetype) => archetype.id === slide.archetypeId));
  }
  assert.ok(plan.briefs.every((brief) => brief.slots.length > 0));
});

test("the writing brief asks for a measured number of characters, not a guess", () => {
  const plan = planDeckLayout(draft.document, [{ layout: "title_body", title: "T", purpose: "p" }], { profiles });
  const slot = plan.briefs[0].slots[0];
  assert.ok(slot.budget.preferredCharacters > 0);
  assert.ok(slot.budget.maximumCharacters >= slot.budget.preferredCharacters);
});
