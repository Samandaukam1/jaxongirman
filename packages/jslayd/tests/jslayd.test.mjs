import assert from "node:assert/strict";
import test from "node:test";

import { buildJslayd } from "./build.mjs";

const dir = buildJslayd();
const { compile } = await import(`${dir}/compile.js`);
const { analyze } = await import(`${dir}/analyze.js`);
const { readDocument, serialize, contentHash } = await import(`${dir}/serialize.js`);
const { SAMPLE_PROMPT, PROMPT_STANDARD } = await import(`${dir}/standard.js`);
const { deriveColorFamily, extendChartPalette, contrastRatio } = await import(`${dir}/colors.js`);

/** Every error the compiler reported, as `code` strings. */
const codes = (diagnostics) => diagnostics.errors.map((item) => item.code);

/** A minimal design that compiles clean, used as the base for negative tests. */
const MINIMAL = `JSLAYD-DESIGN 1.0

[DESIGN]
name: Sinov
slug: sinov
tier: simple

[COLOR_FAMILY]
background: #FFFFFF
surface: #F4F4F4
primary: #111111
secondary: #DDDDDD
accent: #FF6A00
text: #111111
muted: #666666

[FONTS]
font_1:
role: display, heading, body
asset: sinov.ttf

[SLIDE cover_01]
purpose: cover

[ELEMENT title]
type: text
bind: {{title}}
x: 120
y: 300
width: 1200
height: 300
fontSize: 120
color: text
`;

function withElement(properties) {
  return MINIMAL.replace(
    "[ELEMENT title]\ntype: text\nbind: {{title}}\nx: 120\ny: 300\nwidth: 1200\nheight: 300\nfontSize: 120\ncolor: text\n",
    `[ELEMENT title]\ntype: text\nbind: {{title}}\nx: 120\ny: 300\nwidth: 1200\nheight: 300\nfontSize: 120\ncolor: text\n${properties}\n`,
  );
}

/* ------------------------------------------------------------- the sample */

test("the shipped sample prompt compiles without errors", () => {
  const { document, diagnostics } = compile(SAMPLE_PROMPT);
  assert.deepEqual(codes(diagnostics), [], diagnostics.errors.map((item) => `${item.line}: ${item.message}`).join("\n"));
  assert.ok(document);
  assert.equal(document.format, "JSLAYD");
  assert.equal(document.version, "1.0");
  assert.equal(document.kind, "design");
  assert.equal(document.design.slug, "apelsen-futuristik");
  assert.equal(document.design.tier, "super_professional");
  assert.equal(document.archetypes.length, 4);
});

test("the sample exercises every element family the language ships", () => {
  const { document } = compile(SAMPLE_PROMPT);
  const types = new Set(document.archetypes.flatMap((archetype) => archetype.elements.map((element) => element.type)));
  for (const expected of ["text", "image", "decorative", "stat", "chart", "table"]) {
    assert.ok(types.has(expected), `sample is missing a \`${expected}\` element`);
  }
});

test("the standard document names every section the compiler accepts", () => {
  for (const section of ["[DESIGN]", "[COLOR_FAMILY]", "[CHART_PALETTE]", "[FONTS]", "[GLOBAL]", "[VISUAL_DNA]"]) {
    assert.ok(PROMPT_STANDARD.includes(section), `standard omits ${section}`);
  }
});

/* ------------------------------------------------------------- strictness */

test("an unknown property is an error, never a silent ignore", () => {
  const { document, diagnostics } = compile(withElement("rotateAngleX: 12"));
  assert.equal(document, null);
  assert.ok(codes(diagnostics).includes("unknown_property"));
  const finding = diagnostics.errors.find((item) => item.code === "unknown_property");
  assert.ok(finding.line > 0, "the error must point at a line");
  assert.ok(finding.scope.includes("[ELEMENT title]"), "the error must name the element");
});

test("an unknown section is an error", () => {
  const { diagnostics } = compile(`${MINIMAL}\n[DEKORATSIYA]\nfoo: bar\n`);
  assert.ok(codes(diagnostics).includes("unknown_section"));
});

test("an unknown binding is an error and suggests the nearest name", () => {
  const { diagnostics } = compile(MINIMAL.replace("{{title}}", "{{titel}}"));
  const finding = diagnostics.errors.find((item) => item.code === "unknown_binding");
  assert.ok(finding);
  assert.ok(finding.hint.includes("title"));
});

test("a misspelled enum value suggests the nearest allowed one", () => {
  const { diagnostics } = compile(MINIMAL.replace("tier: simple", "tier: simpl"));
  const finding = diagnostics.errors.find((item) => item.code === "unknown_value");
  assert.ok(finding);
  assert.ok(finding.hint.includes("simple"));
});

test("a missing header is an error", () => {
  const { diagnostics } = compile(MINIMAL.replace("JSLAYD-DESIGN 1.0\n", ""));
  assert.ok(codes(diagnostics).includes("missing_header"));
});

test("an unsupported version is refused by name", () => {
  const { diagnostics } = compile(MINIMAL.replace("JSLAYD-DESIGN 1.0", "JSLAYD-DESIGN 9.9"));
  assert.ok(codes(diagnostics).includes("unsupported_version"));
});

test("a font asset may not carry a path separator", () => {
  const { diagnostics } = compile(MINIMAL.replace("asset: sinov.ttf", "asset: ../../etc/passwd.ttf"));
  assert.ok(codes(diagnostics).includes("unsafe_asset"));
});

test("woff2 is refused because the PDF exporter cannot embed it", () => {
  const { diagnostics } = compile(MINIMAL.replace("asset: sinov.ttf", "asset: sinov.woff2"));
  assert.ok(codes(diagnostics).includes("unsupported_font_format"));
});

test("a canvas other than 1920x1080 is refused", () => {
  const { diagnostics } = compile(MINIMAL.replace("tier: simple", "tier: simple\ncanvas: 1280x720"));
  assert.ok(codes(diagnostics).includes("unsupported_canvas"));
});

test("tabs are refused so nesting cannot depend on an editor setting", () => {
  const { diagnostics } = compile(MINIMAL.replace("fontSize: 120", "\tfontSize: 120"));
  assert.ok(codes(diagnostics).includes("tab_indent"));
});

test("a duplicate property is reported rather than silently overwritten", () => {
  const { diagnostics } = compile(withElement("fontSize: 90"));
  assert.ok(codes(diagnostics).includes("duplicate_property"));
});

test("an element outside a slide is refused", () => {
  const stray = `JSLAYD-DESIGN 1.0\n\n[ELEMENT lost]\ntype: text\ntext: hi\nx: 0\ny: 0\nwidth: 10\nheight: 10\nfontSize: 20\n`;
  const { diagnostics } = compile(stray);
  assert.ok(codes(diagnostics).includes("element_without_slide"));
});

/* ---------------------------------------------------------------- geometry */

test("anchors resolve to a canonical top-left box", () => {
  const { document } = compile(withElement("anchor: center"));
  const title = document.archetypes[0].elements.find((element) => element.id === "title");
  // Authored at (120, 300) measuring from the centre of a 1200×300 box.
  assert.equal(title.geometry.x, 120 - 600);
  assert.equal(title.geometry.y, 300 - 150);
  assert.equal(title.geometry.anchor, "center");
});

test("rotation accepts a negative degree with or without a unit", () => {
  const bare = compile(withElement("rotation: -6")).document;
  const suffixed = compile(withElement("rotation: -6deg")).document;
  const rotationOf = (document) => document.archetypes[0].elements[0].geometry.rotation;
  assert.equal(rotationOf(bare), -6);
  assert.equal(rotationOf(suffixed), -6);
});

test("elements are ordered by zIndex", () => {
  const source = MINIMAL.replace(
    "[ELEMENT title]",
    "[ELEMENT plate]\ntype: shape\nshape: rectangle\nfill: surface\nx: 0\ny: 0\nwidth: 1920\nheight: 1080\nzIndex: 9\n\n[ELEMENT title]",
  ).replace("color: text\n", "color: text\nzIndex: 2\n");
  const { document } = compile(source);
  const order = document.archetypes[0].elements.map((element) => element.id);
  assert.deepEqual(order, ["title", "plate"]);
});

/* --------------------------------------------------------------- gradients */

test("a gradient carries more than two stops", () => {
  const source = withElement("background:\n  x: 1").replace(
    "background:\n  x: 1",
    "backgroundGradient:\n  type: linear\n  angle: 135\n  stops:\n    0: #FF7100\n    50: #FFB000\n    100: #FFE86A",
  );
  const { document, diagnostics } = compile(source);
  assert.deepEqual(codes(diagnostics), []);
  const title = document.archetypes[0].elements[0];
  assert.equal(title.background.type, "linear");
  assert.equal(title.background.angle, 135);
  assert.deepEqual(title.background.stops.map((stop) => stop.offset), [0, 50, 100]);
  assert.deepEqual(title.background.stops.map((stop) => stop.color.hex), ["#FF7100", "#FFB000", "#FFE86A"]);
});

test("the gradient shorthand spreads its stops evenly", () => {
  const { document, diagnostics } = compile(withElement("backgroundGradient: linear 90 #000000 #888888 #FFFFFF"));
  assert.deepEqual(codes(diagnostics), []);
  const stops = document.archetypes[0].elements[0].background.stops;
  assert.deepEqual(stops.map((stop) => stop.offset), [0, 50, 100]);
});

test("a one-stop gradient is an error", () => {
  const { diagnostics } = compile(withElement("backgroundGradient: linear 90 #000000"));
  assert.ok(codes(diagnostics).includes("gradient_too_short"));
});

/* ----------------------------------------------------------------- shadows */

test("a shadow reads in both the shorthand and the block form", () => {
  const shorthand = compile(withElement("effect: shadow\nshadow: 0 18 40 0 0.24 contrast")).document;
  const block = compile(withElement("effect: shadow\nshadow:\n  offsetX: 0\n  offsetY: 18\n  blur: 40\n  spread: 0\n  opacity: 0.24\n  color: contrast")).document;
  const shadowOf = (document) => document.archetypes[0].elements[0].text.shadows[0];
  assert.deepEqual(shadowOf(shorthand), shadowOf(block));
  assert.deepEqual(shadowOf(shorthand), { offsetX: 0, offsetY: 18, blur: 40, spread: 0, opacity: 0.24, color: { role: "contrast" } });
});

test("an effect without its supporting value warns rather than passing silently", () => {
  const { diagnostics } = compile(withElement("effect: stroke"));
  assert.ok(diagnostics.warnings.some((item) => item.code === "effect_without_value"));
});

/* ------------------------------------------------------------------ colors */

test("omitted colour roles are derived, and derivation is a pure function", () => {
  const first = deriveColorFamily({ background: "#FFFFFF", surface: "#F4F4F4", primary: "#111111", secondary: "#DDDDDD", accent: "#FF6A00", text: "#111111", muted: "#666666" });
  const second = deriveColorFamily({ background: "#FFFFFF", surface: "#F4F4F4", primary: "#111111", secondary: "#DDDDDD", accent: "#FF6A00", text: "#111111", muted: "#666666" });
  assert.deepEqual(first, second);
  assert.equal(first.textOnPrimary, "#FFFFFF");
  assert.ok(contrastRatio(first.textOnAccent, first.accent) > 3);
});

test("a colour family may not alias another role", () => {
  const { diagnostics } = compile(MINIMAL.replace("surface: #F4F4F4", "surface: primary"));
  assert.ok(codes(diagnostics).includes("role_alias"));
});

test("chart palette extension is deterministic and never repeats a colour", () => {
  const palette = ["#FF6A00", "#111111", "#FFD166"];
  const first = extendChartPalette(palette, 7, "#FFFFFF");
  const second = extendChartPalette(palette, 7, "#FFFFFF");
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, 7);
});

/* ------------------------------------------------------- serialise & read */

test("compilation is deterministic down to the serialised bytes", async () => {
  const first = compile(SAMPLE_PROMPT).document;
  const second = compile(SAMPLE_PROMPT).document;
  assert.equal(serialize(first), serialize(second));
  assert.equal(await contentHash(first), await contentHash(second));
});

test("a compiled document survives a round trip through readDocument", () => {
  const { document } = compile(SAMPLE_PROMPT);
  const { document: read, diagnostics } = readDocument(serialize(document));
  assert.deepEqual(diagnostics.errors, []);
  assert.deepEqual(read, JSON.parse(serialize(document)));
});

test("readDocument refuses a document that is not JSLAYD", () => {
  assert.equal(readDocument('{"format":"PPTX"}').document, null);
  assert.equal(readDocument("not json at all").document, null);
  assert.equal(readDocument(null).document, null);
});

test("readDocument refuses a future version by name rather than guessing", () => {
  const { document } = compile(SAMPLE_PROMPT);
  const future = { ...JSON.parse(serialize(document)), version: "2.0" };
  const { document: read, diagnostics } = readDocument(JSON.stringify(future));
  assert.equal(read, null);
  assert.ok(diagnostics.errors[0].message.includes("mos emas"));
});

test("readDocument refuses an imported font asset that escapes its prefix", () => {
  const { document } = compile(SAMPLE_PROMPT);
  const tampered = JSON.parse(serialize(document));
  tampered.fonts[0].faces[0].asset = "../../secret.ttf";
  const { document: read, diagnostics } = readDocument(JSON.stringify(tampered));
  assert.equal(read, null);
  assert.ok(diagnostics.errors.some((item) => item.code === "unsafe_asset"));
});

/**
 * A font slot used to hold one file, and every design published before it could
 * hold more carries that single face at the top level. Those documents are what
 * six production decks are drawn from: if they stop reading, the decks stop
 * opening, and a model change becomes a day when nothing renders (§69).
 */
test("a design saved before font packages existed still reads", () => {
  const { document } = compile(SAMPLE_PROMPT);
  const legacy = JSON.parse(serialize(document));
  for (const font of legacy.fonts) {
    const [face] = font.faces;
    delete font.faces;
    font.asset = face ? face.asset : null;
    font.format = face ? face.format : null;
    font.weight = face ? face.weight : 400;
    font.italic = face ? face.italic : false;
  }

  const { document: read, diagnostics } = readDocument(JSON.stringify(legacy));
  assert.ok(read, `the legacy shape must still read:\n${
    diagnostics.errors.map((item) => item.message).join("\n")}`);
  // And it reads as a one-face package, so everything downstream sees one model.
  assert.equal(read.fonts[0].faces.length, 1);
  assert.equal(read.fonts[0].faces[0].asset, document.fonts[0].faces[0].asset);
  assert.equal(read.fonts[0].faces[0].weight, document.fonts[0].faces[0].weight);
});

test("an unsafe asset in the legacy shape is still refused", () => {
  const { document } = compile(SAMPLE_PROMPT);
  const legacy = JSON.parse(serialize(document));
  for (const font of legacy.fonts) delete font.faces;
  legacy.fonts[0].asset = "../../secret.ttf";
  legacy.fonts[0].format = "ttf";
  const { document: read, diagnostics } = readDocument(JSON.stringify(legacy));
  assert.equal(read, null);
  assert.ok(diagnostics.errors.some((item) => item.code === "unsafe_asset"));
});

test("a package may not exceed ten files", () => {
  const { document } = compile(SAMPLE_PROMPT);
  const tampered = JSON.parse(serialize(document));
  tampered.fonts[0].faces = Array.from({ length: 11 }, (_unused, index) => ({
    asset: `face-${index}.ttf`, format: "ttf", weight: 100 + index * 50, italic: false,
  }));
  assert.equal(readDocument(JSON.stringify(tampered)).document, null);
});

test("readDocument refuses an element type it does not know", () => {
  const { document } = compile(SAMPLE_PROMPT);
  const tampered = JSON.parse(serialize(document));
  tampered.archetypes[0].elements[0].type = "iframe";
  assert.equal(readDocument(JSON.stringify(tampered)).document, null);
});

/* ---------------------------------------------------------------- analyzer */

test("the sample design is healthy", () => {
  const { document } = compile(SAMPLE_PROMPT);
  const report = analyze(document);
  assert.ok(report.score >= 80, `sample scored ${report.score}: ${report.findings.map((item) => item.message).join(" | ")}`);
  assert.ok(report.checks.every((check) => check.passed), report.findings.map((item) => item.message).join(" | "));
});

test("the analyzer catches text that leaves the canvas", () => {
  const { document } = compile(MINIMAL.replace("width: 1200", "width: 2400"));
  const report = analyze(document);
  assert.ok(report.findings.some((item) => item.code === "out_of_canvas"));
});

test("the analyzer catches unreadable contrast", () => {
  const { document } = compile(MINIMAL.replace("color: text", "color: background"));
  const report = analyze(document);
  assert.ok(report.findings.some((item) => item.code === "contrast_unreadable"));
  assert.ok(report.score < 100);
});

test("the analyzer catches a table taller than its box", () => {
  const source = MINIMAL.replace(
    "[ELEMENT title]",
    "[ELEMENT grid]\ntype: table\nbind: {{table_data}}\nx: 100\ny: 100\nwidth: 1600\nheight: 200\ncolumns: 4\nrows: 12\ncellSize: 28\npadding: 16\n\n[ELEMENT title]",
  );
  const { document } = compile(source);
  const report = analyze(document);
  assert.ok(report.findings.some((item) => item.code === "table_overflow"));
});

/* ------------------------------------------------------------ font packages */

/**
 * A package ships several files and the renderer has to pick one. Getting that
 * wrong is not a crash — it is a heading drawn in the body weight, which nobody
 * notices in a test that only checks the family name.
 */
test("the renderer picks the file that matches the weight and slope asked for", async () => {
  const dir = buildJslayd();
  const { faceFor } = await import(`${dir}/document.js`);
  const font = {
    id: "font_1", name: "Sinov", roles: ["display"], family: "f", fallback: "Manrope",
    faces: [
      { asset: "r.ttf", format: "ttf", weight: 400, italic: false },
      { asset: "sb.ttf", format: "ttf", weight: 600, italic: false },
      { asset: "b.ttf", format: "ttf", weight: 700, italic: false },
      { asset: "bi.ttf", format: "ttf", weight: 700, italic: true },
    ],
  };

  assert.equal(faceFor(font, 400, false).asset, "r.ttf");
  assert.equal(faceFor(font, 700, false).asset, "b.ttf");
  assert.equal(faceFor(font, 700, true).asset, "bi.ttf");
  // Nearest weight, not the first file that happens to be listed.
  assert.equal(faceFor(font, 500, false).asset, "r.ttf", "500 is nearer 400 than 600");
  assert.equal(faceFor(font, 650, false).asset, "sb.ttf", "650 is nearer 600 than 700");
  assert.equal(faceFor(font, 900, false).asset, "b.ttf", "the heaviest available carries the rest");

  // A slope that was asked for beats one that was not, whatever the weights do:
  // bold italic with only an upright bold present should give the bold, not a
  // lighter italic.
  const sparse = { ...font, faces: [
    { asset: "b.ttf", format: "ttf", weight: 700, italic: false },
    { asset: "li.ttf", format: "ttf", weight: 300, italic: true },
  ] };
  assert.equal(faceFor(sparse, 700, true).asset, "li.ttf", "an italic that exists is preferred for italic");
  assert.equal(faceFor(sparse, 300, false).asset, "b.ttf", "and an upright for upright");

  assert.equal(faceFor({ ...font, faces: [] }, 400, false), undefined, "no files means fall back");
  assert.equal(faceFor(undefined, 400, false), undefined);
});

test("a font with no files draws with its bundled fallback", async () => {
  const dir = buildJslayd();
  const { compile: compileHere } = await import(`${dir}/compile.js`);
  const { renderArchetype } = await import(`${dir}/render.js`);
  const prompt = SAMPLE_PROMPT.replace(/^\s*face: .*$/gm, "");
  const { document } = compileHere(prompt);
  assert.ok(document, "a design with no font files must still compile");
  assert.deepEqual(document.fonts[0].faces, []);

  const { previewSlide } = await import(`${dir}/content.js`);
  const archetype = document.archetypes[0];
  const rendered = renderArchetype(document, archetype, previewSlide(archetype.purpose));
  const text = rendered.elements.find((element) => element.style.fontFamily);
  assert.ok(text, "something must be drawn");
  assert.ok(!text.style.fontAsset, "no file may be claimed when none was shipped");
  assert.match(String(text.style.fontFamily), /Manrope|League|Inter|Arimo|Pinyon|Caveat/,
    "a bundled face carries the design instead");
});
