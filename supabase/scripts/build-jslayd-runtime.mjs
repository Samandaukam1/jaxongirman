import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const source = path.join(repoRoot, "packages", "jslayd", "src");
const target = path.join(repoRoot, "supabase", "functions", "_shared", "jslayd");

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
`;

/**
 * Fails when a copied module imports something the copy does not include.
 *
 * Without this the boundary is a comment. With it, adding an `analyze.ts`
 * import to `render.ts` breaks the build here rather than at deploy time, in a
 * container, with a module-not-found nobody can read.
 */
function assertClosed(name, body) {
  const allowed = new Set(MODULES);
  for (const match of body.matchAll(/from\s+"\.\/([A-Za-z0-9_.-]+)"/g)) {
    const imported = match[1];
    if (allowed.has(imported)) continue;
    throw new Error(
      `${name} imports "./${imported}", which is not part of the JSLAYD runtime.\n` +
      `Either move that code out of the runtime, or add the module to MODULES in ` +
      `supabase/scripts/build-jslayd-runtime.mjs and re-check what the Edge bundle now carries.`,
    );
  }
}

const generated = new Map();
for (const name of MODULES) {
  const body = readFileSync(path.join(source, name), "utf8");
  assertClosed(name, body);
  generated.set(name, BANNER.replace("%NAME%", name) + body);
}
generated.set("index.ts", INDEX);

const check = process.argv.includes("--check");
if (check) {
  const existing = new Set(readdirSync(target, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name));
  const stale = [];
  for (const [name, body] of generated) {
    existing.delete(name);
    let current = null;
    try {
      current = readFileSync(path.join(target, name), "utf8");
    } catch {
      stale.push(`${name} is missing`);
      continue;
    }
    if (current !== body) stale.push(`${name} is out of date`);
  }
  for (const orphan of existing) stale.push(`${orphan} is no longer generated`);
  if (stale.length) {
    console.error("The JSLAYD Edge runtime is out of sync with packages/jslayd:");
    for (const line of stale) console.error(`  - ${line}`);
    console.error("\nRun: node supabase/scripts/build-jslayd-runtime.mjs");
    process.exit(1);
  }
  console.log(`✓ JSLAYD Edge runtime is in sync (${generated.size} modules)`);
} else {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const [name, body] of generated) writeFileSync(path.join(target, name), body);
  console.log(`✓ JSLAYD Edge runtime written to supabase/functions/_shared/jslayd (${generated.size} modules)`);
}
