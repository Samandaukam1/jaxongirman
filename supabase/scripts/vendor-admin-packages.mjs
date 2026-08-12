import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const source = path.join(repoRoot, "packages");
const target = path.join(repoRoot, "admin", "packages");

/**
 * Vendors the shared packages into the admin app.
 *
 *   node supabase/scripts/vendor-admin-packages.mjs
 *   node supabase/scripts/vendor-admin-packages.mjs --check
 *
 * The admin console is published from its own repository so it can be developed
 * and deployed on its own. That repository cannot reach `../packages`, so it
 * carries a copy — and a copy is exactly the thing that goes stale without
 * anyone noticing.
 *
 * This is the one place that copy is made, and `--check` is what fails a build
 * when the two have drifted. `packages/` is always the source; nothing is ever
 * edited under `admin/packages/`.
 */
const VENDORED = ["types", "jslayd", "slide-dom"];

/** Source files only: a build artefact or an installed tree is not the package. */
const SKIP = new Set(["node_modules", "dist", ".turbo", "tests"]);

function collect(root, base = "") {
  const files = new Map();
  for (const entry of readdirSync(path.join(root, base), { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const relative = path.join(base, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of collect(root, relative)) files.set(key, value);
    } else if (entry.isFile()) {
      files.set(relative, readFileSync(path.join(root, relative), "utf8"));
    }
  }
  return files;
}

const check = process.argv.includes("--check");
const stale = [];
let copied = 0;

for (const name of VENDORED) {
  const from = path.join(source, name);
  if (!existsSync(from) || !statSync(from).isDirectory()) {
    console.error(`missing package: packages/${name}`);
    process.exit(1);
  }
  const wanted = collect(from);
  const to = path.join(target, name);

  if (check) {
    const current = existsSync(to) ? collect(to) : new Map();
    for (const [file, body] of wanted) {
      if (!current.has(file)) stale.push(`${name}/${file} is missing`);
      else if (current.get(file) !== body) stale.push(`${name}/${file} is out of date`);
      current.delete(file);
    }
    for (const orphan of current.keys()) stale.push(`${name}/${orphan} is no longer part of the package`);
    continue;
  }

  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  for (const file of wanted.keys()) {
    const destination = path.join(to, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(from, file), destination);
    copied += 1;
  }
}

if (check) {
  if (stale.length) {
    console.error("The admin app's vendored packages have drifted from packages/:");
    for (const line of stale) console.error(`  - ${line}`);
    console.error("\nRun: node supabase/scripts/vendor-admin-packages.mjs");
    process.exit(1);
  }
  console.log(`✓ admin/packages is in sync (${VENDORED.join(", ")})`);
} else {
  console.log(`✓ vendored ${copied} files into admin/packages (${VENDORED.join(", ")})`);
}
