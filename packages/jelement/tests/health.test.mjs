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

function build() {
  const outDir = mkdtempSync(path.join(tmpdir(), "jaxongirman-jelement-health-"));
  const configPath = path.join(outDir, "tsconfig.json");
  writeFileSync(configPath, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      lib: ["ES2022"], strict: true, skipLibCheck: true, types: [], outDir,
      rootDir: repoRoot, allowImportingTsExtensions: false, rewriteRelativeImportExtensions: true,
      paths: { "@jaxongirman/jslayd": [path.join(repoRoot, "packages", "jslayd", "src", "index.ts")] },
    },
    include: [
      path.join(packageRoot, "src", "*.ts"),
      path.join(repoRoot, "packages", "jslayd", "src", "*.ts"),
    ],
  }, null, 2));
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", configPath], { stdio: "inherit" });
  writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
  const link = path.join(outDir, "node_modules", "@jaxongirman", "jslayd");
  mkdirSync(link, { recursive: true });
  writeFileSync(path.join(link, "package.json"), JSON.stringify({
    name: "@jaxongirman/jslayd", type: "module",
    main: path.join(outDir, "packages", "jslayd", "src", "index.js"),
  }));
  return path.join(outDir, "packages", "jelement", "src");
}

const dir = build();
const { compile } = await import(`${dir}/compile.js`);
const { elementHealth, familyHealth, previewMatrix } = await import(`${dir}/health.js`);

/**
 * A score is a way of hiding problems unless it comes with them.
 *
 * "78/100" tells an admin something is wrong and nothing about what, so every
 * test here checks the deduction as well as the number — the deductions are
 * what the page shows, and the number is only a way of sorting.
 */

const GOOD = `JELEMENT-FAMILY 1.0

[FAMILY]
name: Health Family
slug: health-family
category: Mining
style: Industrial

[COLOR_TOKENS]
primary: #101214
accent: #A7FF00
glass: #1B2728

[VISUAL_DNA]
material: matte
detailDensity: 5

[ELEMENT 01]
canonicalName: mining haul truck
displayName: Kon yuk mashinasi
objectClass: vehicle
semantic:
  aliases: haul truck, dump truck
  uzbekTerms: kon yuk mashinasi, karer samosvali
  englishTerms: haul truck
  industries: mining
  concepts: ore transportation
  contexts: open pit
geometry:
  aspectRatio: 1.6
  bounds: 0 0 1 1
  visualBounds: 0.05 0.15 0.9 0.7
  components:
    body:
      shape: roundedRect
      box: 0.1 0.3 0.8 0.35
      fill: {{primary}}
    cabin:
      shape: rect
      box: 0.62 0.2 0.24 0.2
      fill: {{primary}}
    wheel:
      shape: circle
      box: 0.18 0.62 0.18 0.22
      fill: {{glass}}
      recolorable: false
    trim:
      shape: rect
      box: 0.1 0.27 0.8 0.04
      fill: {{accent}}
usage:
  slideRoles: hero, section
  bestFor: logistics, extraction
  visualWeight: 8
  recommendedMaxSlideCoverage: 0.42
`;

const { family: GOOD_FAMILY, diagnostics } = compile(GOOD);
assert.deepEqual(diagnostics.errors, [], "the fixture must compile");

function scoreOf(source) {
  const { family } = compile(source);
  assert.ok(family, "the variant must still compile");
  return elementHealth(family.elements[0], family);
}

test("a complete element scores well", () => {
  const report = elementHealth(GOOD_FAMILY.elements[0], GOOD_FAMILY);
  assert.ok(report.score >= 90, `a well-formed element should score high, got ${report.score}`);
  assert.ok(report.score <= 100);
});

test("the score always arrives with what produced it", () => {
  // The whole reason this is not a bare number: an admin needs to know what to
  // fix, and a total cannot say.
  const thin = scoreOf(GOOD.replace("  uzbekTerms: kon yuk mashinasi, karer samosvali\n", ""));
  assert.ok(thin.deductions.length > 0, "a deduction was recorded");
  for (const deduction of thin.deductions) {
    assert.ok(deduction.reason.length > 0, "every deduction says why");
    assert.ok(deduction.points > 0, "and how much it cost");
    assert.ok(deduction.dimension.length > 0, "and which dimension it came from");
  }
});

test("no Uzbek terms is the single biggest search deduction", () => {
  // This library is used in Uzbek. An element without it is invisible to most
  // of the people who need it, whatever else is right about it.
  const thin = scoreOf(GOOD.replace("  uzbekTerms: kon yuk mashinasi, karer samosvali\n", ""));
  const deduction = thin.deductions.find((entry) => entry.reason.includes("O'zbekcha"));
  assert.ok(deduction, "it is called out by name");
  assert.equal(deduction.points, 10, "half the dimension");
  assert.ok(thin.dimensions.search.earned <= thin.dimensions.search.possible / 2,
    "so a complete element missing only its Uzbek terms keeps at most half of search");

  // And it is larger than every other search deduction, which is the claim.
  const others = thin.deductions.filter((entry) => entry.dimension === "search" && entry !== deduction);
  for (const other of others) assert.ok(other.points < deduction.points);
});

test("an element nothing can find scores worse than one nothing can draw", () => {
  // Both matter, but an element nobody finds is worth nothing however well it
  // is drawn — and one with no geometry can still ship as an asset.
  const unfindable = scoreOf(GOOD
    .replace("  uzbekTerms: kon yuk mashinasi, karer samosvali\n", "")
    .replace("  concepts: ore transportation\n", "")
    .replace("  contexts: open pit\n", "")
    .replace("  aliases: haul truck, dump truck\n", "")
    .replace("  englishTerms: haul truck\n", ""));

  assert.ok(unfindable.dimensions.search.earned <= 2, "search is nearly zero");
});

test("visual bounds identical to the rectangle is a deduction", () => {
  // An element that never distinguishes them will look off-centre on every
  // slide, and no amount of component detail fixes that.
  const flat = scoreOf(GOOD.replace("  visualBounds: 0.05 0.15 0.9 0.7\n", ""));
  assert.ok(flat.deductions.some((entry) => entry.reason.includes("Vizual chegaralar")));
});

test("a component too thin to see at preview size is caught", () => {
  const hairline = scoreOf(GOOD.replace("      box: 0.1 0.27 0.8 0.04", "      box: 0.1 0.27 0.8 0.002"));
  const deduction = hairline.deductions.find((entry) => entry.dimension === "renderStability");
  assert.ok(deduction, "a hairline that vanishes at 64px is a render problem");
  assert.match(deduction.reason, /ko'rinmay/);
});

test("a component outside the element's own space is caught", () => {
  const escaping = scoreOf(GOOD.replace("      box: 0.62 0.2 0.24 0.2", "      box: 0.9 0.2 0.4 0.2"));
  assert.ok(escaping.deductions.some((entry) => entry.reason.includes("chiqib ketgan")));
});

test("an element bound to no colour role cannot follow a rebrand", () => {
  const unbound = scoreOf(GOOD
    .replace("      fill: {{primary}}\n    cabin:", "    cabin:")
    .replace(/      fill: \{\{\w+\}\}\n/g, ""));
  const deduction = unbound.deductions.find((entry) => entry.dimension === "recolorability");
  assert.ok(deduction, "and that is a recolourability problem, not a colour one");
});

test("naming an element after its colour costs semantics", () => {
  const named = scoreOf(GOOD.replace("canonicalName: mining haul truck", "canonicalName: green haul truck"));
  assert.ok(named.deductions.some((entry) => entry.dimension === "semantics" && entry.reason.includes("ko'rinishga qarab")));
});

test("no slide roles means the planner will never choose it", () => {
  const roleless = scoreOf(GOOD.replace("  slideRoles: hero, section\n", ""));
  const deduction = roleless.deductions.find((entry) => entry.reason.includes("Slayd rollari"));
  assert.ok(deduction);
  assert.match(deduction.fix, /tanlamaydi/);
});

test("a family scores as the mean of its elements, and lists every fault", () => {
  const twoElements = `${GOOD}
[ELEMENT 02]
canonicalName: thin thing
objectClass: other
geometry:
  components:
    only:
      shape: rect
      box: 0.4 0.4 0.2 0.2
      fill: {{primary}}
`;
  const { family } = compile(twoElements);
  const report = familyHealth(family);

  assert.equal(Object.keys(report.perElement).length, 2, "every element is scored");
  assert.ok(report.perElement["mining haul truck"] > report.perElement["thin thing"]);
  assert.ok(report.score < report.perElement["mining haul truck"], "a weak sibling pulls the family down");

  // Faults are attributed, so an admin knows which element to open.
  assert.ok(report.deductions.some((entry) => entry.reason.startsWith("thin thing:")));
});

test("every element is previewed small, rotated, and on both grounds", () => {
  // The conditions under which detail disappears and a colour binding turns out
  // wrong — none of which show up looking at one large preview on white.
  const matrix = previewMatrix();
  assert.ok(matrix.some((entry) => entry.background === "light"));
  assert.ok(matrix.some((entry) => entry.background === "dark"));
  assert.ok(matrix.some((entry) => entry.size <= 64), "small enough for detail to vanish");
  assert.ok(matrix.some((entry) => entry.rotation === 45), "and angled enough for a wrong ratio to show");
  assert.equal(matrix.length, 2 * 3 * 4);
});
