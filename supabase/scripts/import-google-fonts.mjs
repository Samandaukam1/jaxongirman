#!/usr/bin/env node
/**
 * The Google Fonts checkout, onto the shelf the app already reads.
 *
 * Reads `font-library/fonts-main`, which is the upstream repository, and fills
 * `font_families` / `font_faces` plus the `design-fonts` bucket — the same
 * three places `resolve-design-fonts` writes when a template names a font we do
 * not have. Nothing new is invented; this is the bulk path to the same shelf.
 *
 * **`METADATA.pb` is the source of truth, not the file name.** Every family in
 * that repository ships one, and it states the family's name, its category, its
 * licence and — per file — the style and the weight. Deriving those from
 * `Montserrat-SemiBoldItalic.ttf` works until it meets `PlayfairDisplay[wght].ttf`
 * or `Cabin-MediumItalic.ttf` versus `Cabin_Condensed-Medium.ttf`, and then it
 * quietly files things under the wrong family. The parser below reads only the
 * handful of fields we need, in the text format the repository uses.
 *
 * **Idempotent by content, not by name.** A face is skipped when the shelf
 * already holds a row with its SHA-256. Re-running after an interruption
 * uploads only what is missing, which is what makes importing two thousand
 * families in batches possible at all.
 *
 *   node supabase/scripts/import-google-fonts.mjs --limit 40
 *   node supabase/scripts/import-google-fonts.mjs --only montserrat,inter
 *   node supabase/scripts/import-google-fonts.mjs --dry-run
 *   node supabase/scripts/import-google-fonts.mjs            # everything
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIBRARY = path.join(repoRoot, "font-library", "fonts-main");
/** The licence folders. Anything else in the checkout is tooling, not fonts. */
const LICENCE_DIRS = ["ofl", "apache", "ufl", "cc-by-sa"];
const BUCKET = "design-fonts";
/** The prefix `resolve-design-fonts` already uses; faces are shared, not per design. */
const PREFIX = "library";
/** The bucket's own ceiling. Checking here saves a pointless round trip. */
const MAX_BYTES = 8 * 1024 * 1024;

const CATEGORY = {
  SANS_SERIF: "sans-serif",
  SERIF: "serif",
  DISPLAY: "display",
  HANDWRITING: "handwriting",
  MONOSPACE: "monospace",
};

/* ------------------------------------------------------------------ parsing */

/**
 * Enough of protobuf's text format to read a `METADATA.pb`.
 *
 * A general parser is not needed and would be worse: these files are generated,
 * one field per line, with `fonts { … }` and `axes { … }` as the only nesting
 * this cares about. Anything unrecognised is skipped rather than guessed at.
 */
export function parseMetadata(text) {
  const family = { name: "", category: "", designer: "", licence: "", fonts: [], axes: [] };
  let block = null;
  let current = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    if (line === "}") {
      if (block === "fonts" && current) family.fonts.push(current);
      if (block === "axes" && current) family.axes.push(current);
      block = null; current = null;
      continue;
    }
    if (line.startsWith("fonts {")) { block = "fonts"; current = {}; continue; }
    if (line.startsWith("axes {")) { block = "axes"; current = {}; continue; }
    // `source { … }` and friends nest further; ignore everything inside them.
    if (/^\w+ \{$/.test(line)) { block = block ?? "other"; continue; }

    const match = /^(\w+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rest] = match;
    // A quoted value may be followed by a trailing `# comment`, so the string is
    // taken by its own quotes rather than by whatever is left on the line.
    const quoted = /^"((?:[^"\\]|\\.)*)"/.exec(rest);
    const value = quoted
      ? quoted[1].replace(/\\(["'\\])/g, "$1").replace(/\\n/g, "\n")
      : rest.split("#")[0].trim();

    if (block === "fonts" && current) { current[key] = value; continue; }
    if (block === "axes" && current) { current[key] = value; continue; }
    if (block) continue;

    if (key === "name") family.name = value;
    else if (key === "category") family.category = value;
    else if (key === "designer") family.designer = value;
    else if (key === "license") family.licence = value;
  }
  return family;
}

/** Lowercased, punctuation stripped — the same rule `font-source.ts` uses. */
export const normaliseFamily = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * What this cut is called, from the name the family gave it.
 *
 * `full_name` is "Montserrat SemiBold Italic"; the family is "Montserrat"; what
 * is left is the style. When nothing is left it is the Regular.
 */
export function styleName(fullName, familyName, italic) {
  const rest = String(fullName ?? "").replace(familyName, "").trim();
  if (rest) return rest;
  return italic ? "Italic" : "Regular";
}

/**
 * The faces a family offers.
 *
 * A variable font is one file covering a whole axis, and the metadata still
 * lists it with `weight: 400` and a `full_name` naming whichever instance the
 * generator happened to pick — "Montserrat Thin" for a file that is every
 * weight from 100 to 900. Recording that as a 400 called Thin would be wrong
 * twice, so a variable family is stored as one face per slant, named for what
 * it is.
 */
export function facesOf(family) {
  const variable = family.axes.some((axis) => axis.tag === "wght");
  if (!variable) {
    return family.fonts.map((font) => ({
      filename: font.filename,
      weight: Number(font.weight) || 400,
      italic: font.style === "italic",
      style: styleName(font.full_name, family.name, font.style === "italic"),
    }));
  }

  const bySlant = new Map();
  for (const font of family.fonts) {
    const italic = font.style === "italic";
    if (bySlant.has(italic)) continue;
    bySlant.set(italic, {
      filename: font.filename,
      weight: 400,
      italic,
      style: italic ? "Variable Italic" : "Variable",
    });
  }
  return [...bySlant.values()];
}

export function readFamilies(root = LIBRARY) {
  const found = [];
  for (const licence of LICENCE_DIRS) {
    const dir = path.join(root, licence);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folder = path.join(dir, entry.name);
      let text;
      try { text = readFileSync(path.join(folder, "METADATA.pb"), "utf8"); } catch { continue; }
      const family = parseMetadata(text);
      if (!family.name || family.fonts.length === 0) continue;
      found.push({ ...family, folder, licenceDir: licence });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/* -------------------------------------------------------------------- import */

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * A file name Supabase Storage will accept as an object key.
 *
 * Variable fonts are named `Montserrat[wght].ttf`, and storage refuses a key
 * containing square brackets — "Invalid key", after the upload has already been
 * sent. Seventeen of the first forty families failed on exactly that, and every
 * one of them was a variable font, which is to say the modern half of the
 * library.
 *
 * Only the key is rewritten. The bytes are untouched, the family and the weight
 * live in the database rather than in the path, and the original name is still
 * on disk in the checkout — so nothing is lost by calling the object
 * `Montserrat_wght_.ttf`.
 */
export const safeKey = (fileName) => fileName.replace(/[^A-Za-z0-9._-]/g, "_");

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? null : argv[at + 1] ?? "";
  };
  const dryRun = argv.includes("--dry-run");
  const limit = Number(flag("--limit") ?? "") || Infinity;
  const only = (flag("--only") ?? "").split(",").map((s) => normaliseFamily(s)).filter(Boolean);

  const families = readFamilies().filter((f) => (
    only.length === 0 || only.includes(normaliseFamily(f.name))
  )).slice(0, limit);

  const totals = {
    families: families.length,
    files: families.reduce((sum, f) => sum + facesOf(f).length, 0),
    uploaded: 0, skipped: 0, failed: 0, oversize: 0, missing: 0,
  };

  console.log(`Families found:   ${totals.families}`);
  console.log(`Font files found: ${totals.files}`);
  if (dryRun) {
    for (const family of families.slice(0, 10)) {
      const faces = facesOf(family);
      console.log(`  ${family.name} [${CATEGORY[family.category] ?? "sans-serif"}] — ${faces.map((f) => `${f.style} ${f.weight}${f.italic ? "i" : ""}`).join(", ")}`);
    }
    console.log("\nDry run: nothing uploaded.");
    return;
  }

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  for (const [index, family] of families.entries()) {
    const normalized = normaliseFamily(family.name);
    const category = CATEGORY[family.category] ?? "sans-serif";
    const faces = facesOf(family);
    const variable = family.axes.some((axis) => axis.tag === "wght");

    const upserted = await db.from("font_families").upsert({
      canonical_name: family.name,
      normalized_name: normalized,
      source: "google-fonts",
      category,
      is_variable: variable,
      is_active: true,
      updated_at: new Date().toISOString(),
      license_metadata: {
        provider: "google-fonts",
        license: family.licence || family.licenceDir.toUpperCase(),
        designer: family.designer,
        // Kept so the OFL text that shipped beside the file can always be found
        // again: the licence travels with the font, not with our copy of it.
        license_file: `${family.licenceDir}/${path.basename(family.folder)}`,
        terms: "https://fonts.google.com/attribution",
      },
    }, { onConflict: "normalized_name" }).select("id").single();

    if (upserted.error) {
      totals.failed += faces.length;
      console.error(`  ✖ ${family.name}: ${upserted.error.message}`);
      continue;
    }
    const familyId = upserted.data.id;

    for (const face of faces) {
      const source = path.join(family.folder, face.filename);
      let bytes;
      try { bytes = readFileSync(source); } catch { totals.missing += 1; continue; }
      if (statSync(source).size > MAX_BYTES) { totals.oversize += 1; continue; }

      const hash = sha256(bytes);
      const already = await db.from("font_faces").select("id").eq("content_hash", hash).maybeSingle();
      if (already.data) { totals.skipped += 1; continue; }

      const format = path.extname(face.filename).slice(1).toLowerCase();
      const objectPath = `${PREFIX}/${normalized}/${safeKey(face.filename)}`;
      const stored = await db.storage.from(BUCKET).upload(objectPath, bytes, {
        contentType: format === "otf" ? "font/otf" : "font/ttf",
        upsert: true,
      });
      if (stored.error) {
        totals.failed += 1;
        console.error(`  ✖ ${family.name} ${face.style}: ${stored.error.message}`);
        continue;
      }

      const row = await db.from("font_faces").upsert({
        family_id: familyId,
        weight: face.weight,
        italic: face.italic,
        style_name: face.style,
        format,
        storage_path: objectPath,
        content_hash: hash,
        byte_size: bytes.byteLength,
      }, { onConflict: "family_id,weight,italic" });
      if (row.error) { totals.failed += 1; console.error(`  ✖ ${family.name} ${face.style}: ${row.error.message}`); continue; }
      totals.uploaded += 1;
    }

    if ((index + 1) % 25 === 0) {
      console.log(`  … ${index + 1}/${families.length} families (${totals.uploaded} uploaded, ${totals.skipped} skipped)`);
    }
  }

  console.log("");
  console.log(`Families found:   ${totals.families}`);
  console.log(`Font files found: ${totals.files}`);
  console.log(`Uploaded:         ${totals.uploaded}`);
  console.log(`Skipped:          ${totals.skipped}   (already on the shelf, by checksum)`);
  console.log(`Failed:           ${totals.failed}`);
  if (totals.oversize) console.log(`Too large:        ${totals.oversize}   (over the bucket's 8 MB limit)`);
  if (totals.missing) console.log(`Missing on disk:  ${totals.missing}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
