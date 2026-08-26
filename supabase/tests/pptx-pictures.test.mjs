import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { readSlidePictures, relationshipTargets, replaceablePictures, orientationOf } =
  await import(`${edge}/pptx-pictures.js`);

const RELS = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type=".../slideLayout" Target="../slideLayouts/slideLayout2.xml"/>
  <Relationship Id="rId2" Type=".../image" Target="../media/image7.jpeg"/>
  <Relationship Id="rId3" Type=".../image" Target="../media/logo.png"/>
  <Relationship Id="rId4" Type=".../image" Target="https://example.test/far.jpg" TargetMode="External"/>
</Relationships>`;

const pic = (id, name, embed, cx, cy) => `
  <p:pic>
    <p:nvPicPr><p:cNvPr id="${id}" name="${name}"/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="${embed}"/></p:blipFill>
    <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></p:spPr>
  </p:pic>`;

const slide = (body) => `<?xml version="1.0"?>
<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;

/* ---------------------------------------------------------- relationships */

test("a relationship target is resolved from the part that points at it", () => {
  const targets = relationshipTargets("ppt/slides/slide3.xml", RELS);
  assert.equal(targets.get("rId2"), "ppt/media/image7.jpeg");
  assert.equal(targets.get("rId1"), "ppt/slideLayouts/slideLayout2.xml");
});

test("a picture hosted somewhere else is not a slot we can fill", () => {
  // There are no bytes in the package to replace, so offering it as a slot
  // would produce a deck that silently kept the template's picture.
  const targets = relationshipTargets("ppt/slides/slide3.xml", RELS);
  assert.equal(targets.has("rId4"), false);
});

/* -------------------------------------------------------------- pictures */

test("every embedded picture is found, with the part it draws", () => {
  const markup = slide(pic(4, "Hero photo", "rId2", 9144000, 5143500) + pic(9, "Logo", "rId3", 400000, 400000));
  const pictures = readSlidePictures("ppt/slides/slide3.xml", markup, RELS);

  assert.equal(pictures.length, 2);
  assert.equal(pictures[0].mediaPart, "ppt/media/image7.jpeg");
  assert.equal(pictures[0].name, "Hero photo");
  assert.ok(Math.abs(pictures[0].aspect - 16 / 9) < 0.01);
});

test("a shape painted with a photograph is a picture too", () => {
  /**
   * The common case, and the one this originally got wrong.
   *
   * Most photography in a real template is a rectangle or a circle with
   * `<a:blipFill>` in its shape properties, cropped by its own outline rather
   * than by a picture frame. The importer next door learned this the hard way —
   * reading only `<p:pic>` meant an eleven-page deck imported with no images at
   * all — and reading only `<p:pic>` here would mean a template whose pictures
   * could never be replaced, for exactly the same reason.
   */
  const markup = slide(`
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Hero frame"/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="5143500"/></a:xfrm>
        <a:blipFill><a:blip r:embed="rId2"/></a:blipFill>
      </p:spPr>
    </p:sp>`);

  const [found] = readSlidePictures("ppt/slides/slide3.xml", markup, RELS);
  assert.equal(found.mediaPart, "ppt/media/image7.jpeg");
  assert.equal(found.name, "Hero frame");
  assert.ok(Math.abs(found.aspect - 16 / 9) < 0.01, "its own extent decides the shape it wants");
});

test("one picture is listed once, however it is reached", () => {
  // A `<p:pic>` nested inside a shape must not become two entries pointing at
  // one media part — the second would look like a shared part and stop the
  // replacement the first asked for.
  const markup = slide(`
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Frame"/></p:nvSpPr>
      <p:spPr><a:xfrm><a:ext cx="9144000" cy="5143500"/></a:xfrm><a:blipFill><a:blip r:embed="rId2"/></a:blipFill></p:spPr>
    </p:sp>` + pic(4, "Hero", "rId2", 9144000, 5143500));

  assert.equal(readSlidePictures("ppt/slides/slide3.xml", markup, RELS).length, 1);
});

test("markup that will not parse is no pictures, not a crash", () => {
  assert.deepEqual(readSlidePictures("ppt/slides/slide3.xml", "<not xml", RELS), []);
  assert.deepEqual(readSlidePictures("ppt/slides/slide3.xml", slide(""), "<broken"), []);
});

/* ----------------------------------------------------------- replaceable */

test("a logo-sized picture is never replaced", () => {
  const pictures = readSlidePictures("ppt/slides/slide3.xml",
    slide(pic(4, "Hero", "rId2", 9144000, 5143500) + pic(9, "Logo", "rId3", 400000, 400000)), RELS);

  const { usable, skipped } = replaceablePictures(pictures, new Map());
  assert.equal(usable.length, 1);
  assert.equal(usable[0].name, "Hero");
  assert.deepEqual(skipped.map((entry) => entry.reason), ["too_small"]);
});

test("a picture two slides share is left alone", () => {
  /**
   * The bytes are one file. Replacing them for the page that asked would also
   * change the page that did not, which is a deck quietly rewriting itself.
   */
  const pictures = readSlidePictures("ppt/slides/slide3.xml", slide(pic(4, "Hero", "rId2", 9144000, 5143500)), RELS);
  const { usable, skipped } = replaceablePictures(pictures, new Map([["ppt/media/image7.jpeg", 2]]));

  assert.equal(usable.length, 0);
  assert.equal(skipped[0].reason, "shared");
});

test("the biggest picture is offered first", () => {
  const markup = slide(
    pic(4, "Small", "rId2", 2000000, 2000000) + pic(5, "Big", "rId3", 9144000, 5143500),
  );
  const { usable } = replaceablePictures(readSlidePictures("ppt/slides/slide3.xml", markup, RELS), new Map());
  assert.equal(usable[0].name, "Big", "the page's composition is worth the search, not its inset");
});

/* ---------------------------------------------------------- orientation */

test("the frame decides the orientation, not a preference", () => {
  // A portrait hole filled with a landscape photograph is a face cropped to
  // its ear.
  const shaped = (cx, cy) => readSlidePictures("ppt/slides/s.xml", slide(pic(1, "P", "rId2", cx, cy)), RELS)[0];
  assert.equal(orientationOf(shaped(9144000, 5143500)), "landscape");
  assert.equal(orientationOf(shaped(3000000, 5000000)), "portrait");
  assert.equal(orientationOf(shaped(4000000, 4000000)), "square");
  // An extent nothing states is not a reason to refuse a picture.
  assert.equal(orientationOf({ aspect: 0 }), "landscape");
});
