import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The interface is set in Jaxongirman Sans — Bricolage Grotesque with
 * Manrope's Cyrillic (scripts/build-ui-font.py). A weight a screen names but
 * the root layout never loads renders in the platform's fallback with no error,
 * so every name in the code is checked against what is loaded.
 */

const userRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir, into = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, into);
    else if (/\.tsx?$/.test(name)) into.push(full);
  }
  return into;
}

const layout = readFileSync(path.join(userRoot, "app", "_layout.tsx"), "utf8");

test("every interface weight the code names is loaded, from a file that exists", () => {
  const named = new Set();
  for (const file of [...sources(path.join(userRoot, "app")), ...sources(path.join(userRoot, "src"))]) {
    for (const match of readFileSync(file, "utf8").matchAll(/"(JaxongirmanSans_\w+)"/g)) named.add(match[1]);
  }
  assert.ok(named.size >= 4, "the interface uses the face");
  for (const name of named) {
    const weight = name.replace("JaxongirmanSans_", "");
    assert.match(layout, new RegExp(`${name}: require\\("\\.\\./assets/fonts/JaxongirmanSans-${weight}\\.ttf"\\)`), name);
    statSync(path.join(userRoot, "assets", "fonts", `JaxongirmanSans-${weight}.ttf`));
  }
});

test("the font ships with its licence", () => {
  const licence = readFileSync(path.join(userRoot, "assets", "fonts", "OFL.txt"), "utf8");
  assert.match(licence, /Bricolage Grotesque Project Authors/);
  assert.match(licence, /Manrope Project Authors/);
  assert.match(licence, /SIL Open Font License, Version 1\.1/);
});
