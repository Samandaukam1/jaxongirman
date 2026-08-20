import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const source = path.join(repoRoot, "packages", "jslayd", "src");
const target = path.join(repoRoot, "supabase", "functions", "_shared", "jslayd");

/**
 * The JElement drawing half, projected the same way and for the same reason.
 *
 * Only the reading and drawing modules travel: the compiler and the standard
 * prompt stay in the package, because importing a specification happens in the
 * console and the server has no business carrying a parser it never runs.
 */
const ELEMENT_SOURCE = path.join(repoRoot, "packages", "jelement", "src");
const ELEMENT_TARGET = path.join(repoRoot, "supabase", "functions", "_shared", "jelement");
const ELEMENT_MODULES = ["spec.ts", "document.ts", "render.ts"];
const ELEMENT_INDEX = `export * from "./spec.ts";
export * from "./document.ts";
export * from "./render.ts";
`;

/**
 * Projects the JSLAYD *runtime* into the Edge function tree.
 *
 *   node supabase/scripts/build-jslayd-runtime.mjs
 *   node supabase/scripts/build-jslayd-runtime.mjs --check
 *
 * `packages/jslayd` is the single source of truth (§55, §103). The Edge runtime
 * cannot import it: every function in this repo is self-contained under
 * `supabase/functions/`, and the deploy bundle is built from that tree. So the
 * files are copied here rather than duplicated by hand — the same answer this
 * repo already uses for `build-template-seed.mjs`, and for the same reason: one
 * authored source, two consumers, no chance of drift.
 *
 * Only the reading half travels. The parser, the compiler, the analyzer and the
 * standard document stay in the package, because compilation happens in the
 * admin console and the server has no business carrying a compiler it never
 * runs. `MODULES` is the boundary, and `assertClosed` proves it holds.
 */
const MODULES = [
  "spec.ts",
  "document.ts",
  "diagnostics.ts",
  "colors.ts",
  "content.ts",
  "render.ts",
  "select.ts",
  "serialize.ts",
  // The writing side needs to know how big a box is before anything is written
  // into it, and that arithmetic belongs beside the geometry rather than in a
  // second copy on the server.
  "text-metrics.ts",
  "budget.ts",
  // Not the compiler — the other direction. A design imported from a template
  // is a document with no source text behind it, and the admin editor reads
  // source text: without this the editor opens an imported design and reports
  // that every section is missing, with no way to publish it. Writing the
  // source at import time makes an imported design an ordinary one.
  "decompile.ts",
];

const BANNER = `// GENERATED FILE — do not edit by hand.
// Source: packages/jslayd/src/%NAME%
// Regenerate with: node supabase/scripts/build-jslayd-runtime.mjs
//
// The JSLAYD runtime, projected into the Edge tree. Edit the package, not this.

`;

const INDEX = `// GENERATED FILE — do not edit by hand.
// Regenerate with: node supabase/scripts/build-jslayd-runtime.mjs

export * from "./spec.ts";
export * from "./document.ts";
export * from "./diagnostics.ts";
export * from "./colors.ts";
export * from "./content.ts";
export * from "./render.ts";
export * from "./select.ts";
export * from "./serialize.ts";
export * from "./text-metrics.ts";
export * from "./budget.ts";
export * from "./decompile.ts";
`;

/**
 * Fails when a copied module imports something the copy does not include.
 *
 * Without this the boundary is a comment. With it, adding an `analyze.ts`
 * import to `render.ts` breaks the build here rather than at deploy time, in a
 * container, with a module-not-found nobody can read.
 */
function assertClosed(name, body, modules = MODULES, label = "JSLAYD") {
  const allowed = new Set(modules);
  for (const match of body.matchAll(/from\s+"\.\/([A-Za-z0-9_.-]+)"/g)) {
    const imported = match[1];
    if (allowed.has(imported)) continue;
    throw new Error(
      `${name} imports "./${imported}", which is not part of the ${label} runtime.\n` +
      `Either move that code out of the runtime, or add the module to MODULES in ` +
      `supabase/scripts/build-jslayd-runtime.mjs and re-check what the Edge bundle now carries.`,
    );
  }
}

/** One projection: a source directory, a module list, an index, a destination. */
function project(sourceDir, modules, indexBody, label) {
  const files = new Map();
  for (const name of modules) {
    const body = readFileSync(path.join(sourceDir, name), "utf8");
    assertClosed(name, body, modules, label);
    files.set(name, BANNER.replace("%NAME%", name) + body);
  }
  files.set("index.ts", indexBody);
  return files;
}

const generated = project(source, MODULES, INDEX, "JSLAYD");
const elementFiles = project(ELEMENT_SOURCE, ELEMENT_MODULES, ELEMENT_INDEX, "JElement");

const check = process.argv.includes("--check");

function verify(dir, files, label) {
  const existing = new Set(readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name));
  const stale = [];
  for (const [name, body] of files) {
    existing.delete(name);
    let current = null;
    try {
      current = readFileSync(path.join(dir, name), "utf8");
    } catch {
      stale.push(`${name} is missing`);
      continue;
    }
    if (current !== body) stale.push(`${name} is out of date`);
  }
  for (const orphan of existing) stale.push(`${orphan} is no longer generated`);
  if (stale.length) {
    console.error(`The ${label} Edge runtime is out of sync:`);
    for (const line of stale) console.error(`  - ${line}`);
    console.error("\nRun: node supabase/scripts/build-jslayd-runtime.mjs");
    process.exit(1);
  }
  console.log(`✓ ${label} Edge runtime is in sync (${files.size} modules)`);
}

function write(dir, files) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of files) writeFileSync(path.join(dir, name), body);
}

if (check) {
  verify(target, generated, "JSLAYD");
  verify(ELEMENT_TARGET, elementFiles, "JElement");
} else {
  write(target, generated);
  write(ELEMENT_TARGET, elementFiles);

  console.log(`✓ JSLAYD Edge runtime written to supabase/functions/_shared/jslayd (${generated.size} modules)`);
  console.log(`✓ JElement Edge runtime written to supabase/functions/_shared/jelement (${elementFiles.size} modules)`);
}
