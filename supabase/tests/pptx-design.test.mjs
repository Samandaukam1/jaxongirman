import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { readPptx, themeFonts, CANVAS_WIDTH } = await import(`${edge}/pptx.js`);
const { assignBindings, colourValue, inferPurpose, readFonts, readPalette, toJslaydDocument } =
  await import(`${edge}/pptx-design.js`);
const { readDocument } = await import(`${edge}/jslayd/serialize.js`);

/**
 * Reading a designer's template as a design.
 *
 * Two properties matter more than any single conversion. The template's own
 * words must never reach a document, because a customer's deck showing somebody
 * else's sales figures is the one failure that cannot be excused. And colours
 * must arrive as roles rather than as hexes, because a design that cannot be
 * recoloured is half the feature.
 *
 * The rest is the chain PowerPoint itself uses — slide, layout, master — which
 * a template relies on completely and a hand-made deck barely at all.
 */

const encoder = new TextEncoder();
const bytes = (text) => encoder.encode(text);

const THEME = `<a:theme xmlns:a="x"><a:themeElements>
  <a:clrScheme>
    <a:dk1><a:srgbClr val="1A1A1A"/></a:dk1>
    <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
    <a:accent1><a:srgbClr val="2F6FED"/></a:accent1>
  </a:clrScheme>
  <a:fontScheme>
    <a:majorFont><a:latin typeface="Playfair Display"/></a:majorFont>
    <a:minorFont><a:latin typeface="Inter"/></a:minorFont>
  </a:fontScheme>
</a:themeElements></a:theme>`;

/** A whole package, so the layout and master chain is real rather than mocked. */
function template({ slides, layout, master = "", theme = THEME } = {}) {
  const entries = new Map([
    ["ppt/theme/theme1.xml", bytes(theme)],
    ["ppt/slideMasters/slideMaster1.xml", bytes(master || "<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>")],
    ["ppt/slideMasters/_rels/slideMaster1.xml.rels", bytes("<Relationships/>")],
    ["ppt/slideLayouts/slideLayout1.xml", bytes(layout || "<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>")],
    ["ppt/slideLayouts/_rels/slideLayout1.xml.rels", bytes(
      '<Relationships><Relationship Id="rId1" Target="../slideMasters/slideMaster1.xml"/></Relationships>')],
  ]);

  const references = slides
    .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`)
    .join("");
  entries.set("ppt/presentation.xml", bytes(
    `<p:presentation><p:sldIdLst>${references}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`));
  entries.set("ppt/_rels/presentation.xml.rels", bytes(
    `<Relationships>${slides.map((_, index) =>
      `<Relationship Id="rId${index + 1}" Target="slides/slide${index + 1}.xml"/>`).join("")}</Relationships>`));

  slides.forEach((xml, index) => {
    entries.set(`ppt/slides/slide${index + 1}.xml`, bytes(xml));
    entries.set(`ppt/slides/_rels/slide${index + 1}.xml.rels`, bytes(
      '<Relationships><Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'));
  });
  return entries;
}

/** A slide holding exactly the shapes given, and nothing implied. */
const slide = (inner) => `<p:sld><p:cSld><p:spTree>${inner}</p:spTree></p:cSld></p:sld>`;

/** EMU for a rectangle expressed in twelfths of the slide, to keep tests readable. */
function frame(x, y, width, height) {
  const unitX = 12192000 / 12;
  const unitY = 6858000 / 12;
  return `<a:xfrm><a:off x="${x * unitX}" y="${y * unitY}"/><a:ext cx="${width * unitX}" cy="${height * unitY}"/></a:xfrm>`;
}

/**
 * Shape ids, which PowerPoint always writes and these fixtures used not to.
 *
 * Every editable box is addressed by `<p:cNvPr id>`: it is what joins a written
 * sentence to the shape it goes in when the file is cloned. A fixture without
 * one describes a slide no exporter could ever edit, so the tests were quietly
 * asking for behaviour no real template has.
 */
let shapeId = 1;
function textShape({ placeholder = "", geometry = frame(1, 1, 10, 2), runs = "", body = "", id = 0 } = {}) {
  const own = id || (shapeId += 1);
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${own}" name="TextBox ${own}"/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr>
    <p:spPr>${geometry}</p:spPr>
    <p:txBody>${body}<a:p>${runs}</a:p></p:txBody>
  </p:sp>`;
}

const run = (text, attributes = "", inside = "") =>
  `<a:r><a:rPr ${attributes}>${inside}</a:rPr><a:t>${text}</a:t></a:r>`;

const options = { name: "Studio", slug: "studio", tier: "great" };

/* ------------------------------------------------------------------ parser */

test("theme fonts resolve the two faces a package references by symbol", () => {
  const fonts = themeFonts(template({ slides: [slide("")] }));
  assert.equal(fonts.major, "Playfair Display");
  assert.equal(fonts.minor, "Inter");
});

test("a package with no font scheme still names a face", () => {
  const fonts = themeFonts(new Map());
  assert.equal(fonts.minor, "Arial");
});

test("+mj-lt is read as the theme's heading face, not as a font called +mj-lt", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({ runs: run("Sarlavha", "", '<a:latin typeface="+mj-lt"/>') }))],
  }));
  assert.equal(deck.slides[0].elements[0].typography.fontFamily, "Playfair Display");
});

test("a literal typeface is kept exactly as the package spells it", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({ runs: run("Matn", "", '<a:latin typeface="Söhne Breit"/>') }))],
  }));
  assert.equal(deck.slides[0].elements[0].typography.fontFamily, "Söhne Breit");
});

test("a run naming no face falls to the theme's body face", () => {
  const deck = readPptx(template({ slides: [slide(textShape({ runs: run("Matn") }))] }));
  assert.equal(deck.slides[0].elements[0].typography.fontFamily, "Inter");
});

test("style stays Manrope however the template is set, because that is what ships", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({ runs: run("Matn", "", '<a:latin typeface="Playfair Display"/>') }))],
  }));
  const element = deck.slides[0].elements[0];
  assert.equal(element.style.fontFamily, "Manrope_400Regular");
  assert.equal(element.typography.fontFamily, "Playfair Display");
});

test("a placeholder with no rectangle takes the layout's", () => {
  const deck = readPptx(template({
    slides: [slide(`<p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:spPr/>
      <p:txBody><a:p>${run("Sarlavha")}</a:p></p:txBody>
    </p:sp>`)],
    layout: `<p:sldLayout><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:spPr>${frame(1, 2, 10, 3)}</p:spPr></p:sp>
    </p:spTree></p:cSld></p:sldLayout>`,
  }));
  const [element] = deck.slides[0].elements;
  assert.equal(element.type, "text");
  // One twelfth of the canvas across, two down.
  assert.equal(Math.round(element.x), Math.round(CANVAS_WIDTH / 12));
  assert.ok(element.height > 100, `inherited height was ${element.height}`);
});

test("ctrTitle on a slide matches title in the layout — they are one slot", () => {
  const deck = readPptx(template({
    slides: [slide(`<p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/>
      <p:txBody><a:p>${run("Muqova")}</a:p></p:txBody></p:sp>`)],
    layout: `<p:sldLayout><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:spPr>${frame(0, 4, 12, 3)}</p:spPr></p:sp>
    </p:spTree></p:cSld></p:sldLayout>`,
  }));
  assert.equal(deck.slides[0].elements.length, 1);
});

test("body placeholders are matched by index, not by kind alone", () => {
  const deck = readPptx(template({
    slides: [slide(`<p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="2"/></p:nvPr></p:nvSpPr><p:spPr/>
      <p:txBody><a:p>${run("Ikkinchi ustun")}</a:p></p:txBody></p:sp>`)],
    layout: `<p:sldLayout><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr>${frame(0, 3, 5, 4)}</p:spPr></p:sp>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="2"/></p:nvPr></p:nvSpPr>
        <p:spPr>${frame(6, 3, 5, 4)}</p:spPr></p:sp>
    </p:spTree></p:cSld></p:sldLayout>`,
  }));
  const [element] = deck.slides[0].elements;
  assert.ok(element.x >= CANVAS_WIDTH / 2, `expected the right-hand column, got x=${element.x}`);
});

test("a run states its own size even when the layout offers one", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({
      placeholder: '<p:ph type="title"/>',
      runs: run("Sarlavha", 'sz="2000"'),
    }))],
    layout: `<p:sldLayout><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${frame(1, 1, 10, 2)}</p:spPr>
      <p:txBody><a:lstStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></a:lstStyle></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sldLayout>`,
  }));
  assert.ok(deck.slides[0].elements[0].typography.fontSize < 30);
});

test("a silent run takes the layout's size, which is where a template states it", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({ placeholder: '<p:ph type="title"/>', runs: run("Sarlavha") }))],
    layout: `<p:sldLayout><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${frame(1, 1, 10, 2)}</p:spPr>
      <p:txBody><a:lstStyle><a:lvl1pPr><a:defRPr sz="4400" b="1"/></a:lvl1pPr></a:lstStyle></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sldLayout>`,
  }));
  const { typography } = deck.slides[0].elements[0];
  assert.ok(typography.fontSize > 30, `inherited size was ${typography.fontSize}`);
  assert.equal(typography.fontWeight, 700);
});

test("the master's blanket style is the last resort, and it is reached", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({ placeholder: '<p:ph type="title"/>', runs: run("Sarlavha") }))],
    master: `<p:sldMaster><p:cSld><p:spTree/></p:cSld>
      <p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="5400"/></a:lvl1pPr></p:titleStyle></p:txStyles>
    </p:sldMaster>`,
  }));
  assert.ok(deck.slides[0].elements[0].typography.fontSize > 40);
});

test("a box mixing two faces says so rather than reporting only the first", () => {
  const runs = run("Oddiy", "", '<a:latin typeface="Inter"/>') + run("Qalin", 'b="1"');
  const deck = readPptx(template({ slides: [slide(textShape({ runs }))] }));
  assert.equal(deck.slides[0].elements[0].typography.mixed, true);
});

test("one look throughout is not reported as mixed", () => {
  const runs = run("Bir ", 'sz="1800"') + run("gap", 'sz="1800"');
  const deck = readPptx(template({ slides: [slide(textShape({ runs }))] }));
  assert.equal(deck.slides[0].elements[0].typography.mixed, false);
});

test("percentage line spacing becomes the ratio everything downstream uses", () => {
  const deck = readPptx(template({
    slides: [slide(`<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr>${frame(1, 1, 10, 2)}</p:spPr>
      <p:txBody><a:p><a:pPr><a:lnSpc><a:spcPct val="90000"/></a:lnSpc></a:pPr>${run("Matn")}</a:p></p:txBody></p:sp>`)],
  }));
  assert.equal(deck.slides[0].elements[0].typography.lineHeightRatio, 0.9);
});

test("all-capitals is carried as a transform, not baked into the words", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({ runs: run("sarlavha", 'cap="all"') }))],
  }));
  const element = deck.slides[0].elements[0];
  assert.equal(element.typography.transform, "uppercase");
  assert.equal(element.content.text, "sarlavha");
});

test("vertical anchoring is read from the body, not guessed from the box", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({ body: '<a:bodyPr anchor="ctr"/>', runs: run("Matn") }))],
  }));
  assert.equal(deck.slides[0].elements[0].typography.verticalAlign, "middle");
});

test("a placeholder's kind survives onto the element", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({ placeholder: '<p:ph type="subTitle" idx="1"/>', runs: run("Kichik sarlavha") }))],
  }));
  assert.deepEqual(deck.slides[0].elements[0].placeholder, { kind: "subTitle", index: 1 });
});

/* ------------------------------------------------------------------ palette */

test("the background is the colour covering the most, not the one named most", () => {
  const slides = [{
    background: { color: "#0b1020" },
    elements: Array.from({ length: 20 }, () => ({
      type: "shape", x: 0, y: 0, width: 4, height: 4, rotation: 0, zIndex: 0, opacity: 1,
      style: { fill: "#ff3366" }, content: {},
    })),
  }];
  assert.equal(readPalette(slides).background, "#0b1020");
});

test("the accent is the loudest colour, not the largest", () => {
  const slides = [{
    background: { color: "#ffffff" },
    elements: [
      { type: "shape", x: 0, y: 0, width: 900, height: 400, rotation: 0, zIndex: 0, opacity: 1, style: { fill: "#5b6470" }, content: {} },
      { type: "shape", x: 0, y: 0, width: 40, height: 6, rotation: 0, zIndex: 1, opacity: 1, style: { fill: "#ff2d55" }, content: {} },
    ],
  }];
  const family = readPalette(slides);
  assert.equal(family.primary, "#5b6470");
  assert.equal(family.accent, "#ff2d55");
});

test("a colour matching a role is stored as the role, so the palette can move it", () => {
  const family = readPalette([{ background: { color: "#ffffff" }, elements: [] }]);
  assert.deepEqual(colourValue(family.primary, family), { role: "primary" });
});

test("a colour matching nothing stays literal rather than being repainted", () => {
  const family = readPalette([{ background: { color: "#ffffff" }, elements: [] }]);
  assert.deepEqual(colourValue("#7b3fa0", family), { hex: "#7b3fa0" });
});

test("a colour a shade off its role still resolves to the role", () => {
  const family = readPalette([{ background: { color: "#ffffff" }, elements: [] }]);
  assert.deepEqual(colourValue("#fefefe", family), { role: "background" });
});

/* -------------------------------------------------------------------- fonts */

test("the largest face becomes the display font and the rest follow it", () => {
  const text = (family, size) => ({
    type: "text", x: 0, y: 0, width: 400, height: 60, rotation: 0, zIndex: 0, opacity: 1,
    style: {}, content: { text: "x" },
    typography: { fontFamily: family, fontSize: size, fontWeight: 400, italic: false, align: "left", verticalAlign: "top", lineHeightRatio: 1.2, letterSpacing: 0, transform: "none", color: "#000000", mixed: false },
  });
  const fonts = readFonts([{ background: {}, elements: [text("Inter", 16), text("Playfair Display", 54), text("Inter", 16)] }], "studio");
  assert.equal(fonts[0].name, "Playfair Display");
  assert.ok(fonts[0].roles.includes("display"));
  assert.equal(fonts[1].name, "Inter");
  assert.ok(fonts[1].roles.includes("body"));
});

test("one font answers every duty rather than leaving roles unowned", () => {
  const fonts = readFonts([{ background: {}, elements: [] }], "studio");
  assert.equal(fonts.length, 1);
  for (const role of ["display", "heading", "subheading", "body", "caption", "number", "quote"]) {
    assert.ok(fonts[0].roles.includes(role), `${role} unowned`);
  }
});

test("a face the app already bundles is its own fallback", () => {
  const text = {
    type: "text", x: 0, y: 0, width: 400, height: 60, rotation: 0, zIndex: 0, opacity: 1,
    style: {}, content: { text: "x" },
    typography: { fontFamily: "Inter", fontSize: 40, fontWeight: 400, italic: false, align: "left", verticalAlign: "top", lineHeightRatio: 1.2, letterSpacing: 0, transform: "none", color: "#000000", mixed: false },
  };
  assert.equal(readFonts([{ background: {}, elements: [text] }], "studio")[0].fallback, "Inter");
});

/* ----------------------------------------------------------------- bindings */

test("placeholders decide the binding where the template used them", () => {
  const deck = readPptx(template({
    slides: [slide(
      textShape({ placeholder: '<p:ph type="title"/>', geometry: frame(1, 1, 10, 2), runs: run("Sarlavha", 'sz="4000"') })
      + textShape({ placeholder: '<p:ph type="subTitle" idx="1"/>', geometry: frame(1, 4, 10, 1), runs: run("Kichik", 'sz="2000"') }),
    )],
  }));
  const bindings = [...assignBindings(deck.slides[0]).values()];
  assert.deepEqual(bindings.sort(), ["subtitle", "title"]);
});

test("without placeholders the largest type is the title", () => {
  const deck = readPptx(template({
    slides: [slide(
      textShape({ geometry: frame(1, 4, 10, 2), runs: run("Kichkina", 'sz="1400"') })
      + textShape({ geometry: frame(1, 1, 10, 2), runs: run("Katta", 'sz="4400"') }),
    )],
  }));
  const assigned = assignBindings(deck.slides[0]);
  const title = [...assigned.entries()].find(([, binding]) => binding === "title");
  assert.equal(title[0].content.text, "Katta");
});

test("a footer is the studio's own chrome and is not bound at all", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({ placeholder: '<p:ph type="ftr"/>', runs: run("© Studio 2019") }))],
  }));
  assert.equal(assignBindings(deck.slides[0]).size, 0);
});

test("the box carrying a list becomes the bullets, whatever its size rank", () => {
  const deck = readPptx(template({
    slides: [slide(
      textShape({ geometry: frame(1, 1, 10, 2), runs: run("Sarlavha", 'sz="4000"') })
      + textShape({ geometry: frame(1, 4, 10, 4), runs: run("• bir\n• ikki\n• uch", 'sz="1800"') }),
    )],
  }));
  assert.ok([...assignBindings(deck.slides[0]).values()].includes("bullets"));
});

/* -------------------------------------------------------------- conversion */

test("no word of the template survives into the document", () => {
  const deck = readPptx(template({
    slides: [slide(
      textShape({ placeholder: '<p:ph type="title"/>', geometry: frame(1, 1, 10, 2), runs: run("Acme Corp Q3 Results", 'sz="4000"') })
      + textShape({ geometry: frame(1, 4, 10, 3), runs: run("Revenue up 14% year on year", 'sz="1800"') }),
    )],
  }));
  const draft = toJslaydDocument(deck, options);
  const serialised = JSON.stringify(draft.document);
  assert.ok(!serialised.includes("Acme"), "the template's own words reached the document");
  assert.ok(!serialised.includes("Revenue"), "the template's own words reached the document");
  assert.ok(serialised.includes('"bind":"title"'));
});

test("every text element is a binding, never a literal", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({ placeholder: '<p:ph type="title"/>', runs: run("Anything", 'sz="4000"') }))],
  }));
  const { document } = toJslaydDocument(deck, options);
  for (const archetype of document.archetypes) {
    for (const element of archetype.elements) {
      if (element.type !== "text") continue;
      assert.ok("bind" in element.source, `${element.id} carried a literal`);
    }
  }
});

test("a document from a template is a JSLAYD document like any other", () => {
  const deck = readPptx(template({ slides: [slide(textShape({ runs: run("Matn", 'sz="4000"') }))] }));
  const { document } = toJslaydDocument(deck, options);
  assert.equal(document.format, "JSLAYD");
  assert.equal(document.kind, "design");
  assert.equal(document.design.slug, "studio");
  assert.equal(document.design.canvas.width, CANVAS_WIDTH);
  assert.ok(document.fonts.length >= 1);
  assert.ok(document.archetypes.length >= 1);
});

test("a slot with nothing to say is guarded so the page does not show a gap", () => {
  const deck = readPptx(template({
    slides: [slide(
      textShape({ placeholder: '<p:ph type="title"/>', geometry: frame(1, 1, 10, 2), runs: run("T", 'sz="4000"') })
      + textShape({ placeholder: '<p:ph type="subTitle" idx="1"/>', geometry: frame(1, 4, 10, 1), runs: run("S", 'sz="2000"') }),
    )],
  }));
  const { document } = toJslaydDocument(deck, options);
  const subtitle = document.archetypes[0].elements.find((element) => element.id.endsWith("subtitle"));
  assert.equal(subtitle.when, "hasSubtitle");
});

test("a picture placeholder becomes a slot the deck fills", () => {
  const entries = template({
    slides: [slide(`<p:pic><p:nvPicPr><p:nvPr><p:ph type="pic" idx="1"/></p:nvPr></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rId9"/></p:blipFill><p:spPr>${frame(6, 1, 5, 6)}</p:spPr></p:pic>`)],
  });
  entries.set("ppt/media/image1.png", bytes("PNG"));
  entries.set("ppt/slides/_rels/slide1.xml.rels", bytes(
    '<Relationships><Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml"/>'
    + '<Relationship Id="rId9" Target="../media/image1.png"/></Relationships>'));
  const draft = toJslaydDocument(readPptx(entries), options);
  const image = draft.document.archetypes[0].elements.find((element) => element.type === "image");
  assert.ok(image, "the picture placeholder was not carried");
  assert.deepEqual(image.source, { bind: "image_1" });
  assert.equal(image.when, "hasImage");
});

test("the template's own artwork stays in the design, as its own picture", () => {
  // This once asserted the opposite — that artwork was kept beside the document
  // rather than in it — because no element type could hold a picture the design
  // owns. That was a limitation written down as a rule, and a template arriving
  // without its logo is not that template.
  const entries = template({
    slides: [slide(
      textShape({ placeholder: '<p:ph type="title"/>', geometry: frame(1, 4, 10, 2), runs: run("Sarlavha", 'sz="4000"') })
      + `<p:pic><p:nvPicPr><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rId9"/></p:blipFill><p:spPr>${frame(0, 0, 3, 2)}</p:spPr></p:pic>`,
    )],
  });
  entries.set("ppt/media/image1.png", bytes("PNG"));
  entries.set("ppt/slides/_rels/slide1.xml.rels", bytes(
    '<Relationships><Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml"/>'
    + '<Relationship Id="rId9" Target="../media/image1.png"/></Relationships>'));

  const draft = toJslaydDocument(readPptx(entries), options);
  const owned = draft.document.archetypes[0].elements
    .filter((element) => element.type === "image" && element.source && "asset" in element.source);

  assert.equal(owned.length, 1);
  // It draws itself: no deck supplies it and none can take it away.
  assert.equal(owned[0].when, "always");
  assert.equal(owned[0].strategy, "none");

  // And the bytes are still findable under the name the document used.
  assert.equal(draft.pages[0].artwork.length, 1);
  assert.equal(draft.pages[0].artwork[0].part, "ppt/media/image1.png");
  assert.equal(draft.pages[0].artwork[0].name, owned[0].source.asset);
});

test("parallel columns each get their own point, in reading order", () => {
  // This once asserted that surplus boxes were dropped. They were, because one
  // `bullets` binding draws one list and binding four boxes to it would repeat
  // the same list four times — so a four-column page arrived as a one-column
  // page with three holes.
  const columns = [0, 1, 2, 3]
    .map((index) => textShape({ geometry: frame(index * 3, 5, 2, 3), runs: run(`Ustun ${index + 1}`, 'sz="1600"') }))
    .join("");
  const page = slide(
    textShape({ placeholder: '<p:ph type="title"/>', geometry: frame(1, 1, 10, 2), runs: run("Sarlavha", 'sz="4000"') })
    + columns,
  );

  const draft = toJslaydDocument(readPptx(template({ slides: [page] })), options);
  const bound = draft.document.archetypes[0].elements
    .filter((element) => element.type === "text")
    .map((element) => element.source.bind);

  assert.ok(bound.includes("title"));
  for (const binding of ["bullet_1", "bullet_2", "bullet_3", "bullet_4"]) {
    assert.ok(bound.includes(binding), `${binding} missing from ${bound.join(", ")}`);
  }
  assert.equal(draft.pages[0].textSlots, 5);
  assert.ok(!JSON.stringify(draft.document).includes("Ustun"));
});

test("the leftmost column carries the first point", () => {
  const page = slide(
    textShape({ geometry: frame(8, 5, 3, 3), runs: run("Ong", 'sz="1600"') })
    + textShape({ geometry: frame(1, 5, 3, 3), runs: run("Chap", 'sz="1600"') }),
  );
  const deck = readPptx(template({ slides: [page] }));
  const assigned = assignBindings(deck.slides[0]);
  const first = [...assigned.entries()].find(([, binding]) => binding === "bullet_1");
  assert.equal(first[0].content.text, "Chap");
});

test("a single body box is still a body, not a one-item column", () => {
  const page = slide(
    textShape({ placeholder: '<p:ph type="title"/>', geometry: frame(1, 1, 10, 2), runs: run("Sarlavha", 'sz="4000"') })
    + textShape({ geometry: frame(1, 5, 10, 3), runs: run("Matn", 'sz="1600"') }),
  );
  const deck = readPptx(template({ slides: [page] }));
  assert.ok([...assignBindings(deck.slides[0]).values()].includes("body"));
});

test("past six columns the surplus is counted rather than bound", () => {
  const many = Array.from({ length: 8 }, (_, index) =>
    textShape({ geometry: frame(index, 5, 1, 2), runs: run(`C${index}`, 'sz="1400"') })).join("");
  const deck = readPptx(template({ slides: [slide(many)] }));
  const assigned = assignBindings(deck.slides[0]);
  assert.ok(assigned.size <= 7, `${assigned.size} boxes bound`);
});

test("shape colours arrive as roles, which is what lets a design be recoloured", () => {
  const deck = readPptx(template({
    slides: [slide(`<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr>
      <p:spPr>${frame(0, 0, 12, 1)}<a:solidFill><a:srgbClr val="2F6FED"/></a:solidFill></p:spPr></p:sp>`)],
  }));
  const draft = toJslaydDocument(deck, options);
  const shape = draft.document.archetypes[0].elements.find((element) => element.type === "decorative");
  assert.ok(shape.fill.role, `stored as a literal: ${JSON.stringify(shape.fill)}`);
});

/* ----------------------------------------------------------------- purpose */

const page = (elements, background = { color: "#ffffff" }) => ({ background, elements, title: null, speakerNotes: null });
const textAt = (size, y, characters = 40) => ({
  type: "text", x: 60, y, width: 400, height: 60, rotation: 0, zIndex: 0, opacity: 1,
  style: {}, content: { text: "x".repeat(characters) },
  typography: { fontFamily: "Inter", fontSize: size, fontWeight: 400, italic: false, align: "left", verticalAlign: "top", lineHeightRatio: 1.2, letterSpacing: 0, transform: "none", color: "#000000", mixed: false },
});

test("the first page is the cover, whatever is on it", () => {
  assert.equal(inferPurpose(page([textAt(44, 200)]), 0, 10), "cover");
});

test("a picture filling the page is a full-image page", () => {
  const image = { type: "image", x: 0, y: 0, width: 1000, height: 562, rotation: 0, zIndex: 0, opacity: 1, style: {}, content: {} };
  assert.equal(inferPurpose(page([image]), 3, 10), "full_image");
});

test("a picture on the right leaves the words on the left", () => {
  const image = { type: "image", x: 520, y: 60, width: 420, height: 400, rotation: 0, zIndex: 0, opacity: 1, style: {}, content: {} };
  assert.equal(inferPurpose(page([textAt(32, 60), image]), 3, 10), "text_image");
});

test("three peer boxes in one band are three columns", () => {
  const columns = [0, 1, 2].map(() => textAt(18, 300));
  assert.equal(inferPurpose(page([textAt(36, 60), ...columns]), 4, 10), "three_column");
});

test("almost nothing at the end is a sign-off, and in the middle is a divider", () => {
  const sparse = page([textAt(54, 240, 8)]);
  assert.equal(inferPurpose(sparse, 9, 10), "thank_you");
  assert.equal(inferPurpose(sparse, 4, 10), "section");
});

/* ------------------------------------------------------- every font is used */

test("every declared font owns at least one duty", () => {
  // A font with no role is not merely idle: the compiler refuses it, then
  // refuses every element that named it, and the design cannot be published.
  // Four faces is what a real template ships; the fixtures here had two, which
  // is why this went out.
  const face = (family, size) => ({
    type: "text", x: 0, y: 0, width: 400, height: 60, rotation: 0, zIndex: 0, opacity: 1,
    style: {}, content: { text: "x" },
    typography: { fontFamily: family, fontSize: size, fontWeight: 400, italic: false, align: "left", verticalAlign: "top", lineHeightRatio: 1.2, letterSpacing: 0, transform: "none", color: "#000000", mixed: false },
  });

  for (let count = 1; count <= 4; count += 1) {
    const elements = ["Alpha", "Beta", "Gamma", "Delta"]
      .slice(0, count)
      .map((family, index) => face(family, 60 - index * 10));
    const fonts = readFonts([{ background: {}, elements }], "studio");

    assert.equal(fonts.length, count);
    for (const font of fonts) {
      assert.ok(font.roles.length > 0, `${count} fonts: ${font.id} owns nothing`);
    }
    // And between them they answer every duty exactly once.
    const owned = fonts.flatMap((font) => font.roles);
    assert.equal(new Set(owned).size, owned.length, "a duty was claimed twice");
    assert.equal(owned.length, 7, `${count} fonts: ${owned.length} duties assigned`);
  }
});

/* ---------------------------------------------------------- how a shape looks */

/** A shape with whatever properties the test needs, at a known size. */
const shapeXml = (properties) => `<p:sp>
  <p:nvSpPr><p:nvPr/></p:nvSpPr>
  <p:spPr>${frame(1, 1, 6, 3)}${properties}</p:spPr>
</p:sp>`;

const drawn = (properties) => {
  const draft = toJslaydDocument(readPptx(template({ slides: [slide(shapeXml(properties))] })), options);
  return draft.document.archetypes[0]?.elements.find((element) => element.type === "decorative");
};

test("a rounded panel keeps its corners rather than becoming a rectangle", () => {
  const element = drawn(
    '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 20000"/></a:avLst></a:prstGeom>'
    + '<a:solidFill><a:srgbClr val="2F6FED"/></a:solidFill>',
  );
  assert.equal(element.shape, "roundedRectangle");
  assert.ok(element.corners.topLeft > 0, "the corner radius was lost");
  // Twenty per cent of the shorter side, which is how PowerPoint keeps a corner
  // looking the same at any size.
  assert.ok(Math.abs(element.corners.topLeft - element.geometry.height * 0.2) < 1);
});

test("an ellipse is an ellipse", () => {
  const element = drawn('<a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="2F6FED"/></a:solidFill>');
  assert.equal(element.shape, "ellipse");
});

test("a hexagon keeps its sides", () => {
  const element = drawn('<a:prstGeom prst="hexagon"/><a:solidFill><a:srgbClr val="2F6FED"/></a:solidFill>');
  assert.equal(element.shape, "polygon");
  assert.equal(element.sides, 6);
});

test("a preset nothing can draw becomes its box rather than nothing", () => {
  const element = drawn('<a:prstGeom prst="chevron"/><a:solidFill><a:srgbClr val="2F6FED"/></a:solidFill>');
  assert.equal(element.shape, "rectangle");
  assert.ok(element.fill, "the shape lost its paint as well as its outline");
});

test("a half-transparent fill stays half-transparent", () => {
  const element = drawn(
    '<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="2F6FED"><a:alpha val="40000"/></a:srgbClr></a:solidFill>',
  );
  assert.ok(Math.abs(element.opacity - 0.4) < 0.01, `opacity was ${element.opacity}`);
});

test("a gradient arrives as a gradient, not as one of its two colours", () => {
  const element = drawn(
    '<a:prstGeom prst="rect"/><a:gradFill><a:gsLst>'
    + '<a:gs pos="0"><a:srgbClr val="2F6FED"/></a:gs>'
    + '<a:gs pos="100000"><a:srgbClr val="E8452C"/></a:gs>'
    + '</a:gsLst><a:lin ang="5400000"/></a:gradFill>',
  );
  assert.equal(element.fill.type, "linear");
  assert.equal(element.fill.stops.length, 2);
  // 5400000 sixtythousandths of a degree is ninety.
  assert.equal(element.fill.angle, 90);
});

test("a stroke keeps the width the file gave it", () => {
  const element = drawn(
    '<a:prstGeom prst="rect"/><a:ln w="38100"><a:solidFill><a:srgbClr val="14161A"/></a:solidFill></a:ln>',
  );
  // 38100 EMU is three points; a hairline would have been one.
  assert.ok(element.border.width > 2, `stroke came through at ${element.border.width}`);
});

test("a drop shadow becomes a shadow, at the offset it was cast", () => {
  const element = drawn(
    '<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>'
    + '<a:effectLst><a:outerShdw blurRad="76200" dist="38100" dir="5400000">'
    + '<a:srgbClr val="000000"><a:alpha val="25000"/></a:srgbClr></a:outerShdw></a:effectLst>',
  );
  assert.equal(element.shadows.length, 1);
  const [shadow] = element.shadows;
  // Cast straight down: all of the distance in y, none in x.
  assert.ok(Math.abs(shadow.offsetX) < 0.2, `x offset ${shadow.offsetX}`);
  assert.ok(shadow.offsetY > 1, `y offset ${shadow.offsetY}`);
  assert.ok(shadow.blur > shadow.offsetY, "the blur is larger than the throw");
  assert.ok(Math.abs(shadow.opacity - 0.25) < 0.01);
});

test("a page of every shape feature still reads back as a stored design", () => {
  // Gradients, polygons, shadows and translucent fills are all new shapes in
  // the document. A document nothing can read back is a design the generator
  // refuses to load, which is a fault that surfaces as something else entirely.
  const page = slide(
    shapeXml('<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 20000"/></a:avLst></a:prstGeom>'
      + '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="2F6FED"/></a:gs>'
      + '<a:gs pos="100000"><a:srgbClr val="E8452C"/></a:gs></a:gsLst><a:lin ang="2700000"/></a:gradFill>'
      + '<a:ln w="25400"><a:solidFill><a:srgbClr val="14161A"/></a:solidFill></a:ln>'
      + '<a:effectLst><a:outerShdw blurRad="50800" dist="25400" dir="5400000">'
      + '<a:srgbClr val="000000"><a:alpha val="30000"/></a:srgbClr></a:outerShdw></a:effectLst>')
    + shapeXml('<a:prstGeom prst="hexagon"/><a:solidFill><a:srgbClr val="0E6A49"><a:alpha val="60000"/></a:srgbClr></a:solidFill>')
    + textShape({ placeholder: '<p:ph type="title"/>', geometry: frame(1, 8, 10, 2), runs: run("Sarlavha", 'sz="4000"') }),
  );
  const draft = toJslaydDocument(readPptx(template({ slides: [page] })), options);
  const read = readDocument(draft.document);
  assert.ok(read.document, read.diagnostics.errors.map((entry) => `${entry.code}: ${entry.message}`).join("; "));
});

test("a shape that paints nothing is still not carried", () => {
  assert.equal(drawn('<a:prstGeom prst="rect"/><a:noFill/>'), undefined);
});

/* ------------------------------------------- what the slide is drawn on top of */

/**
 * A designer puts the design on the layout and the master.
 *
 * The slide itself often holds nothing but a title. Reading only the slide is
 * what made an imported template arrive as a coloured rectangle with a few bars
 * on it: the field, the texture, the photographs and the rules all live in the
 * two parts nobody was reading.
 */
test("the layout's own shapes are part of the slide", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({ placeholder: '<p:ph type="title"/>', runs: run("Sarlavha", 'sz="4000"') }))],
    layout: `<p:sldLayout><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr>${frame(0, 0, 12, 2)}
        <a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FFE500"/></a:solidFill></p:spPr></p:sp>
    </p:spTree></p:cSld></p:sldLayout>`,
  }));
  const painted = deck.slides[0].elements.filter((element) => element.type === "shape");
  assert.equal(painted.length, 1, "the layout's panel was dropped");
  assert.equal(painted[0].style.fill, "#ffe500");
});

test("the master's shapes are underneath the layout's, and both under the slide's", () => {
  const deck = readPptx(template({
    slides: [slide(`<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr>${frame(1, 1, 2, 2)}
      <a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:spPr></p:sp>`)],
    layout: `<p:sldLayout><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr>${frame(0, 0, 12, 4)}
        <a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FFE500"/></a:solidFill></p:spPr></p:sp>
    </p:spTree></p:cSld></p:sldLayout>`,
    master: `<p:sldMaster><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr>${frame(0, 0, 12, 12)}
        <a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:sp>
    </p:spTree></p:cSld></p:sldMaster>`,
  }));
  const fills = deck.slides[0].elements.map((element) => element.style.fill);
  assert.deepEqual(fills, ["#ffffff", "#ffe500", "#000000"], "the compositing order is wrong");
});

test("a placeholder the slide fills is not drawn twice", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({ placeholder: '<p:ph type="title"/>', runs: run("Haqiqiy sarlavha", 'sz="4000"') }))],
    layout: `<p:sldLayout><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${frame(1, 1, 10, 2)}</p:spPr>
        <p:txBody><a:p><a:r><a:rPr sz="4000"/><a:t>Sarlavhani kiriting</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sldLayout>`,
  }));
  const texts = deck.slides[0].elements.filter((element) => element.type === "text");
  assert.equal(texts.length, 1);
  assert.equal(texts[0].content.text, "Haqiqiy sarlavha");
});

test("page furniture from the master is left behind", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({ placeholder: '<p:ph type="title"/>', runs: run("Sarlavha", 'sz="4000"') }))],
    master: `<p:sldMaster><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:spPr>${frame(11, 11, 1, 1)}</p:spPr>
        <p:txBody><a:p><a:r><a:rPr sz="1200"/><a:t>12</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="ftr"/></p:nvPr></p:nvSpPr><p:spPr>${frame(0, 11, 6, 1)}</p:spPr>
        <p:txBody><a:p><a:r><a:rPr sz="1200"/><a:t>Studio 2019</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sldMaster>`,
  }));
  const written = JSON.stringify(deck.slides[0].elements);
  assert.ok(!written.includes("Studio 2019"), "the studio's footer came through");
  assert.ok(!written.includes(">12<"), "the page number came through");
});

test("a slide that opts out of the master gets none of it", () => {
  const entries = template({
    slides: ['<p:sld showMasterSp="0"><p:cSld><p:spTree>'
      + `<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr>${frame(1, 1, 2, 2)}`
      + '<a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:spPr></p:sp>'
      + "</p:spTree></p:cSld></p:sld>"],
    master: `<p:sldMaster><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:spPr>${frame(0, 0, 12, 12)}
        <a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:sp>
    </p:spTree></p:cSld></p:sldMaster>`,
  });
  const deck = readPptx(entries);
  assert.equal(deck.slides[0].elements.length, 1);
});

test("a background picture on the layout becomes the slide's ground", () => {
  const entries = template({
    slides: [slide(textShape({ placeholder: '<p:ph type="title"/>', runs: run("Sarlavha", 'sz="4000"') }))],
    layout: '<p:sldLayout><p:cSld><p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId7"/></a:blipFill></p:bgPr></p:bg>'
      + "<p:spTree/></p:cSld></p:sldLayout>",
  });
  entries.set("ppt/media/paper.png", bytes("PNG"));
  entries.set("ppt/slideLayouts/_rels/slideLayout1.xml.rels", bytes(
    '<Relationships><Relationship Id="rId1" Target="../slideMasters/slideMaster1.xml"/>'
    + '<Relationship Id="rId7" Target="../media/paper.png"/></Relationships>'));

  const deck = readPptx(entries);
  const ground = deck.slides[0].elements[0];
  assert.equal(ground.type, "image", "the texture was not carried");
  assert.equal(ground.media.part, "ppt/media/paper.png");
  assert.equal(ground.width, 1000);
});

test("a colour on the master is used when nothing nearer states one", () => {
  const deck = readPptx(template({
    slides: [slide(textShape({ placeholder: '<p:ph type="title"/>', runs: run("S", 'sz="4000"') }))],
    master: '<p:sldMaster><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFE500"/></a:solidFill></p:bgPr></p:bg>'
      + "<p:spTree/></p:cSld></p:sldMaster>",
  }));
  assert.equal(deck.slides[0].background.color, "#ffe500");
});

test("a shape filled with a photograph is a photograph", () => {
  // This is how a designer places most pictures: a rectangle or a circle with
  // `blipFill` in its shape properties, cropped by the shape. Reading blipFill
  // only on `<p:pic>` found almost none of the photography in a real template.
  const entries = template({
    slides: [slide(`<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr>
      <p:spPr>${frame(1, 1, 6, 4)}<a:prstGeom prst="ellipse"/>
      <a:blipFill><a:blip r:embed="rId9"/></a:blipFill></p:spPr></p:sp>`)],
  });
  entries.set("ppt/media/photographer.jpg", bytes("JPG"));
  entries.set("ppt/slides/_rels/slide1.xml.rels", bytes(
    '<Relationships><Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml"/>'
    + '<Relationship Id="rId9" Target="../media/photographer.jpg"/></Relationships>'));

  const [element] = readPptx(entries).slides[0].elements;
  assert.equal(element.type, "image", "the photograph was read as an empty shape");
  assert.equal(element.media.part, "ppt/media/photographer.jpg");
});

test("a picture the previewer cannot draw is a caveat, not a silent loss", () => {
  const entries = template({
    slides: [slide(`<p:pic><p:nvPicPr><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rId9"/></p:blipFill><p:spPr>${frame(1, 1, 3, 3)}</p:spPr></p:pic>`)],
  });
  entries.set("ppt/media/icon.emf", bytes("EMF"));
  entries.set("ppt/slides/_rels/slide1.xml.rels", bytes(
    '<Relationships><Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml"/>'
    + '<Relationship Id="rId9" Target="../media/icon.emf"/></Relationships>'));

  const deck = readPptx(entries);
  assert.ok(deck.warnings.some((warning) => /EMF/.test(warning)), deck.warnings.join(" | "));
});

test("GIF and BMP are drawable and are kept", () => {
  for (const extension of ["gif", "bmp"]) {
    const entries = template({
      slides: [slide(`<p:pic><p:nvPicPr><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rId9"/></p:blipFill><p:spPr>${frame(1, 1, 3, 3)}</p:spPr></p:pic>`)],
    });
    entries.set(`ppt/media/a.${extension}`, bytes("IMG"));
    entries.set("ppt/slides/_rels/slide1.xml.rels", bytes(
      '<Relationships><Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml"/>'
      + `<Relationship Id="rId9" Target="../media/a.${extension}"/></Relationships>`));
    assert.equal(readPptx(entries).slides[0].elements[0]?.type, "image", extension);
  }
});
