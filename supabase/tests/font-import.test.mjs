import assert from "node:assert/strict";
import test from "node:test";

import { facesOf, normaliseFamily, parseMetadata, readFamilies, styleName }
  from "../scripts/import-google-fonts.mjs";

/**
 * The importer reads `METADATA.pb` rather than file names, and these are the
 * cases that made that necessary.
 */

test("a quoted value survives a trailing comment", () => {
  // Real lines from the repository: `languages: "aeb_Arab"  # Tunisian Arabic`.
  const family = parseMetadata([
    'name: "Noto Sans"  # the family',
    'category: "SANS_SERIF"',
    'license: "OFL"',
    'fonts {',
    '  style: "normal"',
    '  weight: 400',
    '  filename: "NotoSans-Regular.ttf"',
    '  full_name: "Noto Sans Regular"',
    '}',
  ].join("\n"));

  assert.equal(family.name, "Noto Sans");
  assert.equal(family.category, "SANS_SERIF");
  assert.equal(family.fonts.length, 1);
  assert.equal(family.fonts[0].filename, "NotoSans-Regular.ttf");
});

test("nested blocks that are not fonts or axes are stepped over", () => {
  // `source { files { … } }` sits after the fonts and repeats `filename`.
  const family = parseMetadata([
    'name: "Cabin"',
    'fonts {',
    '  style: "normal"',
    '  weight: 700',
    '  filename: "Cabin-Bold.ttf"',
    '  full_name: "Cabin Bold"',
    '}',
    'source {',
    '  repository_url: "https://example.test"',
    '  files {',
    '    dest_file: "NOT-A-FACE.ttf"',
    '  }',
    '}',
  ].join("\n"));

  assert.equal(family.fonts.length, 1);
  assert.equal(family.fonts[0].filename, "Cabin-Bold.ttf");
});

test("a variable family is one face per slant, not one per invented instance", () => {
  /**
   * The metadata for a variable font lists `weight: 400` with a `full_name`
   * naming whichever instance the generator picked — "Montserrat Thin" for a
   * file that is every weight from 100 to 900. Storing that as a 400 called
   * Thin would be wrong twice.
   */
  const family = parseMetadata([
    'name: "Montserrat"',
    'category: "SANS_SERIF"',
    'fonts {',
    '  style: "normal"',
    '  weight: 400',
    '  filename: "Montserrat[wght].ttf"',
    '  full_name: "Montserrat Thin"',
    '}',
    'fonts {',
    '  style: "italic"',
    '  weight: 400',
    '  filename: "Montserrat-Italic[wght].ttf"',
    '  full_name: "Montserrat Thin Italic"',
    '}',
    'axes {',
    '  tag: "wght"',
    '  min_value: 100.0',
    '  max_value: 900.0',
    '}',
  ].join("\n"));

  const faces = facesOf(family);
  assert.equal(faces.length, 2);
  assert.deepEqual(faces.map((face) => face.style), ["Variable", "Variable Italic"]);
  assert.ok(faces.every((face) => face.weight === 400));
  assert.ok(!faces.some((face) => face.style.includes("Thin")));
});

test("a static family keeps every cut at its own weight", () => {
  const family = parseMetadata([
    'name: "Abhaya Libre"',
    ...[["Regular", 400], ["Medium", 500], ["SemiBold", 600], ["Bold", 700], ["ExtraBold", 800]]
      .flatMap(([style, weight]) => [
        'fonts {',
        '  style: "normal"',
        `  weight: ${weight}`,
        `  filename: "AbhayaLibre-${style}.ttf"`,
        `  full_name: "Abhaya Libre ${style}"`,
        '}',
      ]),
  ].join("\n"));

  const faces = facesOf(family);
  assert.deepEqual(faces.map((face) => face.weight), [400, 500, 600, 700, 800]);
  assert.deepEqual(faces.map((face) => face.style),
    ["Regular", "Medium", "SemiBold", "Bold", "ExtraBold"]);
});

test("a cut with nothing left after the family name is the Regular", () => {
  assert.equal(styleName("Inter Regular", "Inter", false), "Regular");
  assert.equal(styleName("Inter", "Inter", false), "Regular");
  assert.equal(styleName("Inter", "Inter", true), "Italic");
  assert.equal(styleName("Playfair Display SemiBold Italic", "Playfair Display", true), "SemiBold Italic");
});

test("the slug rule is the one the rest of the system already uses", () => {
  // `font-source.ts` and the storage paths agree on this exact rule.
  assert.equal(normaliseFamily("Playfair Display"), "playfairdisplay");
  assert.equal(normaliseFamily("DM Sans"), "dmsans");
  assert.equal(normaliseFamily("42dot Sans"), "42dotsans");
});

test("the real checkout parses, and the families it finds are whole", () => {
  const families = readFamilies();
  assert.ok(families.length > 1500, `only ${families.length} families read`);

  const montserrat = families.find((family) => family.name === "Montserrat");
  assert.ok(montserrat, "Montserrat is missing");
  assert.equal(montserrat.category, "SANS_SERIF");
  assert.ok(montserrat.axes.some((axis) => axis.tag === "wght"), "variable axis lost");

  // Every family has to give the shelf a name, a category it can file under and
  // at least one face, or it has no business being offered.
  const broken = families.filter((family) => (
    !family.name || !family.category || facesOf(family).length === 0
  ));
  assert.deepEqual(broken.map((family) => family.name), []);
});
