import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

/**
 * The reader that decides what enters the library.
 *
 * Everything downstream — search, recolouring, the renderer, the version pin —
 * assumes a family that reached the database is well formed. This is the only
 * place that assumption is established, so it refuses rather than repairs.
 */
function build() {
  const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-jelement-"));
  const configPath = path.join(outDir, "tsconfig.json");
  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir,
      rootDir: repoRoot,
      allowImportingTsExtensions: false,
      rewriteRelativeImportExtensions: true,
      paths: { "@jaxongirman/jslayd": [path.join(repoRoot, "packages", "jslayd", "src", "index.ts")] },
    },
    include: [
      path.join(packageRoot, "src", "*.ts"),
      path.join(repoRoot, "packages", "jslayd", "src", "*.ts"),
    ],
  }, null, 2));
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));

  // The source imports `@jaxongirman/jslayd` by name, which is right for the
  // bundlers that ship it and meaningless to Node inside a temp directory.
  // tsc's `paths` only rewrites type resolution, not the emitted specifier, so
  // the resolution is supplied here rather than by making production code
  // reach across packages with a relative path.
  const link = path.join(outDir, "node_modules", "@jaxongirman", "jslayd");
  mkdirSync(link, { recursive: true });
  writeFileSync(path.join(link, "package.json"), JSON.stringify({
    name: "@jaxongirman/jslayd",
    type: "module",
    main: path.join(outDir, "packages", "jslayd", "src", "index.js"),
  }));

  return path.join(outDir, "packages", "jelement", "src");
}

const dir = build();
const { compile } = await import(`${dir}/compile.js`);
const { normalizeTerm, toSlug } = await import(`${dir}/spec.js`);

/** A small but complete family, in the shape the analyzer is asked to return. */
const MINING = `JELEMENT-FAMILY 1.0

[FAMILY]
name: Mining Neon Industrial
slug: mining-neon-industrial
category: Mining
subcategory: Open pit
style: Premium Industrial CGI
description: Og'ir sanoat texnikasi, grafit korpus va neon aksent.

[COLOR_TOKENS]
primary: #101214
secondary: #292D30
accent: #A7FF00
accentGlow: #C6FF59
metalDark: #16191B
rubber: #090A0B
glass: #1B2728

[VISUAL_DNA]
material: matte graphite hard-surface
lighting: soft top-left key with rim light
edgeStyle: chamfered
depthStyle: layered ambient occlusion
perspective: three-quarter
camera: slightly above eye level
shadowStyle: soft contact shadow
highlightStyle: narrow specular strip
detailDensity: 7
realism: stylised CGI
geometryLanguage: hard-surface panels

[SEARCH]
keywords: kon, konchilik, mining, quarry, og'ir sanoat
industries: mining, construction, logistics
concepts: extraction, heavy machinery, site survey

[ELEMENT 01]
canonicalName: mining haul truck
displayName: Kon yuk mashinasi
objectClass: vehicle
category: Mining
subcategory: Transport
semantic:
  aliases: haul truck, dump truck, mine truck
  uzbekTerms: kon yuk mashinasi, karer samosvali
  englishTerms: haul truck, mining dump truck
  russianTerms: карьерный самосвал
  industries: mining, quarry
  concepts: ore transportation, heavy logistics
  actions: hauling, transporting
  contexts: open pit, quarry, ore movement
geometry:
  aspectRatio: 1.6
  bounds: 0 0 1 1
  visualBounds: 0.04 0.12 0.92 0.76
  visualCenter: 0.5 0.52
  dominantAxis: horizontal
  originalRotation: 0
  naturalFacing: right
  anchors:
    ground: 0.5 0.9
    focusPoint: 0.72 0.4
  components:
    chassis:
      label: Lower chassis
      shape: roundedRect
      box: 0.08 0.46 0.84 0.24
      fill: {{primary}}
      zIndex: 2
    bed:
      label: Dump bed
      shape: polygon
      box: 0.10 0.18 0.62 0.32
      fill: {{secondary}}
      zIndex: 3
    cabin:
      label: Operator cabin
      shape: roundedRect
      box: 0.68 0.22 0.20 0.26
      fill: {{secondary}}
      zIndex: 4
    window:
      label: Cabin glass
      shape: roundedRect
      box: 0.71 0.26 0.14 0.12
      fill: {{glass}}
      recolorable: false
      zIndex: 5
    tyreFront:
      label: Front tyre
      shape: circle
      box: 0.70 0.62 0.18 0.26
      fill: {{rubber}}
      zIndex: 6
    tyreRear:
      label: Rear tyre
      shape: circle
      box: 0.14 0.62 0.20 0.28
      fill: {{rubber}}
      zIndex: 6
    trim:
      label: Safety trim
      shape: rect
      box: 0.10 0.44 0.80 0.03
      fill: {{accent}}
      zIndex: 7
appearance:
  materials: painted steel, rubber, tempered glass
  roughness: 0.6
  metalness: 0.7
  edgeSoftness: 0.25
  shadowDirection: bottom-right
  highlightDirection: top-left
  emissiveAreas: headlights
usage:
  slideRoles: hero, section, explanation
  bestFor: logistics, extraction volume, site operations
  avoidFor: financial charts
  visualWeight: 8
  detailDensity: 7
  recommendedMaxSlideCoverage: 0.42
transform:
  scalable: true
  rotatable: true
  recolorable: true
  flipHorizontal: true

[ELEMENT 02]
canonicalName: survey total station
displayName: Geodezik asbob
objectClass: device
category: Mining
subcategory: Surveying
semantic:
  aliases: total station, theodolite
  uzbekTerms: geodezik asbob, teodolit
  englishTerms: total station, surveying instrument
  industries: mining, construction
  concepts: site survey, measurement, precision
  contexts: surveying, mapping, mine planning
geometry:
  aspectRatio: 0.7
  bounds: 0 0 1 1
  visualBounds: 0.22 0.06 0.56 0.88
  dominantAxis: vertical
  naturalFacing: front
  components:
    tripod:
      label: Tripod legs
      shape: polygon
      box: 0.18 0.52 0.64 0.46
      fill: {{metalDark}}
      zIndex: 1
    body:
      label: Instrument body
      shape: roundedRect
      box: 0.34 0.18 0.32 0.34
      fill: {{primary}}
      zIndex: 3
    lens:
      label: Optical lens
      shape: circle
      box: 0.42 0.26 0.16 0.16
      fill: {{glass}}
      recolorable: false
      zIndex: 4
    indicator:
      label: Status indicator
      shape: rect
      box: 0.38 0.46 0.24 0.03
      fill: {{accent}}
      zIndex: 5
appearance:
  materials: anodised aluminium, optical glass
  roughness: 0.4
  metalness: 0.8
usage:
  slideRoles: explanation, process, section
  visualWeight: 5
  detailDensity: 6
  recommendedMaxSlideCoverage: 0.3
`;

/* ------------------------------------------------------------- happy path */

test("a well-formed family compiles", () => {
  const { family, diagnostics } = compile(MINING);
  assert.deepEqual(diagnostics.errors, [], `unexpected errors:\n${diagnostics.errors.map((e) => e.message).join("\n")}`);
  assert.ok(family, "a family with no errors must compile");
  assert.equal(family.format, "JELEMENT");
  assert.equal(family.family.slug, "mining-neon-industrial");
  assert.equal(family.elements.length, 2);
});

test("the batch size is a default, not a constraint", () => {
  // §5: twelve is what an analyzer is asked for. A family that came back with
  // two is a family with two, not an error — expansion adds siblings later.
  const { family } = compile(MINING);
  assert.equal(family.elements.length, 2);
});

test("what an element IS is stored apart from how it looks", () => {
  const { family } = compile(MINING);
  const truck = family.elements[0];

  assert.equal(truck.canonicalName, "mining haul truck");
  // No style words anywhere in the searchable half — otherwise searching
  // "excavator" starts depending on the words "graphite" and "neon".
  const searchable = JSON.stringify(truck.semantic).toLowerCase();
  for (const styleWord of ["graphite", "neon", "cgi", "matte", "#a7ff00"]) {
    assert.equal(searchable.includes(styleWord), false, `"${styleWord}" belongs to the family, not the element`);
  }
  assert.ok(family.visualDNA.material.includes("graphite"), "the style lives on the family");
});

test("colours are bound as roles, so a family recolour reaches every child", () => {
  const { family } = compile(MINING);
  const truck = family.elements[0];
  const trim = truck.geometry.components.find((component) => component.id === "trim");

  assert.equal(trim.fill, "accent", "the trim follows the family accent");
  assert.equal(family.colorTokens.accent, "#A7FF00");

  // Nothing anywhere writes a hex onto a shape.
  for (const component of truck.geometry.components) {
    assert.equal(/^#/.test(String(component.fill ?? "")), false, `${component.id} wrote a literal colour`);
  }
});

test("a layer that must not be recoloured says so", () => {
  const { family } = compile(MINING);
  const glass = family.elements[0].geometry.components.find((component) => component.id === "window");
  assert.equal(glass.recolorable, false, "cabin glass is not the family's accent to change");
});

test("visual bounds are kept apart from the bounding box", () => {
  // A rotated pickaxe has a big rectangle and a small perceived mass. Centring
  // the rectangle puts it visibly off-centre, which is why both are stored.
  const { family } = compile(MINING);
  const geometry = family.elements[0].geometry;
  assert.notDeepEqual(geometry.visualBounds, geometry.bounds);
  assert.equal(geometry.visualCenter.x, 0.5);
  assert.equal(geometry.visualCenter.y, 0.52);
});

test("anchors and facing survive, because composition needs them", () => {
  const { family } = compile(MINING);
  const geometry = family.elements[0].geometry;
  assert.equal(geometry.naturalFacing, "right");
  assert.deepEqual(geometry.anchors.focusPoint, { x: 0.72, y: 0.4 });
});

test("transform rules default to keeping the object recognisable", () => {
  const { family } = compile(MINING);
  const transform = family.elements[1].transform;
  assert.equal(transform.scalable, true);
  assert.equal(transform.rotatable, true);
  // Stretching an object out of proportion stops it looking like the thing it
  // is, and nobody asks for that on purpose.
  assert.equal(transform.freeTransform, false);
});

/* --------------------------------------------------------------- refusals */

test("a literal colour on a shape is refused", () => {
  const broken = MINING.replace("fill: {{accent}}\n      zIndex: 7", "fill: #A7FF00\n      zIndex: 7");
  const { family, diagnostics } = compile(broken);
  assert.equal(family, null, "an element that cannot be recoloured must not enter the library");
  assert.ok(diagnostics.errors.some((item) => item.code === "literal_color"));
});

test("a colour role the family never defined is refused", () => {
  const broken = MINING.replace("fill: {{glass}}\n      recolorable: false\n      zIndex: 5", "fill: {{emissive}}\n      zIndex: 5");
  const { family, diagnostics } = compile(broken);
  assert.equal(family, null);
  assert.ok(diagnostics.errors.some((item) => item.code === "undefined_token"));
});

test("two elements with the same name are refused", () => {
  const broken = MINING.replace("canonicalName: survey total station", "canonicalName: Mining Haul Truck");
  const { family, diagnostics } = compile(broken);
  assert.equal(family, null, "a query that matches two elements has no answer");
  assert.ok(diagnostics.errors.some((item) => item.code === "duplicate_element"));
});

test("an element with no name is refused", () => {
  const broken = MINING.replace("canonicalName: mining haul truck\n", "");
  const { family, diagnostics } = compile(broken);
  assert.equal(family, null);
  assert.ok(diagnostics.errors.some((item) => item.code === "missing_canonical_name"));
});

test("a spec with no family block is refused", () => {
  const { family, diagnostics } = compile("JELEMENT-FAMILY 1.0\n\n[COLOR_TOKENS]\nprimary: #000000\n");
  assert.equal(family, null);
  assert.ok(diagnostics.errors.some((item) => item.code === "missing_family" || item.code === "no_elements"));
});

test("a spec with the wrong header is refused", () => {
  const { family, diagnostics } = compile("JSLAYD-DESIGN 1.0\n\n[FAMILY]\nname: X\n");
  assert.equal(family, null);
  assert.ok(diagnostics.errors.some((item) => item.code === "missing_header"));
});

/* --------------------------------------------------------------- warnings */

test("a missing Uzbek term warns rather than refuses", () => {
  // The family can be imported and the terms filled in. Refusing the paste over
  // it would be worse than saying so.
  const thin = MINING.replace("  uzbekTerms: kon yuk mashinasi, karer samosvali\n", "");
  const { family, diagnostics } = compile(thin);
  assert.ok(family, "this is a warning, not an error");
  assert.ok(diagnostics.warnings.some((item) => item.code === "no_uzbek_terms"));
});

test("naming an object after its colour warns", () => {
  const named = MINING.replace("canonicalName: mining haul truck", "canonicalName: green mining truck");
  const { diagnostics } = compile(named);
  assert.ok(diagnostics.warnings.some((item) => item.code === "appearance_name"),
    "a name that describes the paint stops being true when the family is recoloured");
});

/* ---------------------------------------------------------- normalisation */

test("the two Uzbek apostrophes are the same letter", () => {
  // A person typing on one keyboard must find what somebody typed on another.
  assert.equal(normalizeTerm("kon qazish oʻchoqlari"), normalizeTerm("kon qazish o'choqlari"));
  assert.equal(normalizeTerm("gʻisht"), "g'isht");
});

test("normalisation does not invent matches", () => {
  // "kon" must not match "konus". A search returning a cone for a mine is worse
  // than one returning nothing.
  assert.notEqual(normalizeTerm("kon"), normalizeTerm("konus"));
  assert.equal(normalizeTerm("  MINING   Haul  Truck "), "mining haul truck");
});

test("slugs are stable and safe", () => {
  assert.equal(toSlug("Mining Neon Industrial"), "mining-neon-industrial");
  assert.equal(toSlug("O'zbek sanoat 2024"), "ozbek-sanoat-2024");
  assert.equal(toSlug("3D Render Kit"), "d-render-kit", "a slug may not begin with a digit");
});

/* ------------------------------------------------- the prompt and the reader */

const { ANALYZER_PROMPT, expansionPrompt } = await import(`${dir}/standard.js`);

test("the prompt describes the grammar the compiler actually reads", () => {
  // The failure this prevents: a prompt that produces output the importer
  // rejects, discovered only after somebody has spent a round trip through
  // another product. Every section name and key the compiler looks for has to
  // appear in the instructions.
  for (const section of ["[FAMILY]", "[COLOR_TOKENS]", "[VISUAL_DNA]", "[SEARCH]", "[ELEMENT 01]"]) {
    assert.ok(ANALYZER_PROMPT.includes(section), `the prompt must name ${section}`);
  }
  for (const key of [
    "canonicalName", "displayName", "objectClass", "semantic", "uzbekTerms",
    "geometry", "visualBounds", "safeBounds", "components", "usage", "slideRoles", "transform",
  ]) {
    assert.ok(ANALYZER_PROMPT.includes(key), `the prompt must name the \`${key}\` key`);
  }
});

test("the prompt's header is the one the compiler requires", () => {
  const header = ANALYZER_PROMPT.split("\n").find((line) => line.startsWith("JELEMENT-FAMILY"));
  assert.equal(header, "JELEMENT-FAMILY 1.0");
  // And a spec starting with anything else is refused, so the two agree.
  assert.equal(compile("JELEMENT-DESIGN 1.0\n\n[FAMILY]\nname: X\n").family, null);
});

test("the prompt lists the colour roles the compiler accepts, and no others", () => {
  const { family } = compile(MINING);
  for (const role of Object.keys(family.colorTokens)) {
    assert.ok(ANALYZER_PROMPT.includes(role), `the prompt must offer the \`${role}\` role`);
  }
  // A role the prompt invented would be refused at import.
  assert.ok(ANALYZER_PROMPT.includes("roles available:"), "the prompt enumerates them rather than leaving it open");
});

test("the prompt states the two rules the compiler enforces", () => {
  // Both are errors, not warnings, so a prompt that fails to say so produces
  // specs that are rejected wholesale.
  assert.match(ANALYZER_PROMPT, /rejected by the importer/, "a literal hex is refused, and the prompt says so");
  assert.match(ANALYZER_PROMPT, /WHAT AN OBJECT IS is separate from HOW IT LOOKS/);
});

test("an expansion prompt carries what already exists, so nothing is redrawn", () => {
  const { family } = compile(MINING);
  const prompt = expansionPrompt(family, 12);

  assert.ok(prompt.includes("mining haul truck"), "the analyzer must know the truck is taken");
  assert.ok(prompt.includes("survey total station"), "and the total station");
  assert.ok(prompt.includes("#A7FF00"), "and which colours to bind to");
  assert.ok(prompt.includes("matte graphite"), "and the visual language to obey");
  assert.ok(prompt.includes("Exactly 12 new objects"), "and how many are wanted");
});

test("an expansion prompt asks for the same format the compiler reads", () => {
  const { family } = compile(MINING);
  const prompt = expansionPrompt(family);
  assert.ok(prompt.includes("JELEMENT-FAMILY 1.0"));
  assert.ok(prompt.includes("[COLOR_TOKENS]"));
  assert.ok(prompt.includes("[ELEMENT 01]"));
});

test("a family with no elements still produces a usable expansion prompt", () => {
  // The first expansion of a family imported from a thin sheet: nothing to
  // avoid duplicating, and the prompt must not say "already in this family"
  // followed by nothing useful.
  const { family } = compile(MINING);
  const empty = { ...family, elements: [] };
  const prompt = expansionPrompt(empty, 6);
  assert.ok(prompt.includes("Exactly 6 new objects"));
  assert.ok(prompt.includes(family.family.name));
});

/* ------------------------------------------------------- undrawable elements */

test("a components block whose contents lost their indentation is refused, by name", () => {
  /**
   * What actually happened in production.
   *
   * A 1,536-line family specification was pasted with every line flush left.
   * The lexer nests by indentation, so `components:` and `anchors:` both ended
   * up with no children — while `bounds:`, `safeBounds:` and the rest, being
   * flat keys, read perfectly. Thirteen elements were saved, each rendering to
   * nothing, each scoring 83/100.
   *
   * The refusal has to name indentation. "Geometriya komponentlari yo'q" is
   * true and useless: the author can see the components in their own text.
   */
  const flattened = MINING
    .replace(/^ +/gm, "")
    // The flat text now has `components:` immediately followed by sibling keys,
    // which is exactly the shape the paste produced.
    ;

  const { family, diagnostics } = compile(flattened);

  assert.equal(family, null, "an element nothing can draw must not compile");
  const empty = diagnostics.errors.find((item) => item.code === "empty_components");
  assert.ok(empty, `expected empty_components, got ${diagnostics.errors.map((e) => e.code).join(", ")}`);
  assert.match(empty.message, /chekintirilmagan/, "the message must say what is actually wrong");
  assert.match(empty.hint ?? "", /chekinish/i, "and the hint must say how to fix it");
});

test("an element with no components at all is refused too, with its own sentence", () => {
  // Different fault, different fix: nothing was written rather than written
  // wrongly, so the hint shows the shape to write.
  const withoutComponents = MINING.replace(/\n {2}components:\n(?: {4,}.*\n)+/, "\n");

  const { family, diagnostics } = compile(withoutComponents);

  assert.equal(family, null);
  const missing = diagnostics.errors.find((item) => item.code === "no_components");
  assert.ok(missing, `expected no_components, got ${diagnostics.errors.map((e) => e.code).join(", ")}`);
  assert.match(missing.hint ?? "", /components:/);
});

test("the indentation fault is not silently survivable", () => {
  // The guarantee, stated plainly: no path through the compiler returns a
  // family containing an element that renders to nothing.
  for (const source of [MINING.replace(/^ +/gm, ""), MINING.replace(/\n {2}components:\n(?: {4,}.*\n)+/, "\n")]) {
    const { family } = compile(source);
    if (!family) continue;
    for (const element of family.elements) {
      assert.notEqual(element.geometry.components.length, 0, `${element.canonicalName} would draw nothing`);
    }
  }
});
