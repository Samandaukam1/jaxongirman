#!/usr/bin/env node
/**
 * The site does not build without its legal pages.
 *
 * /privacy, /terms, /support, /delete-account and /refund are the URLs App Store
 * Connect and Google Play hold, and the company behind Jaxongirman —
 * “MUKAMMAL MEDIA GROUP” MChJ, with its registration certificate and publishing
 * notice — is named on them. They were lost once (2026-11) when a build came
 * from a checkout that did not have them. Run before `next build`, so a build
 * missing any of this fails, and Vercel keeps the deployment that has them live
 * instead of replacing it.
 *
 * Exits 1 with the list of what is missing; prints nothing when all is there.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED = [
  // The five store URLs.
  ...["privacy", "terms", "support", "delete-account", "refund"].map((slug) => ({ file: `app/${slug}/page.tsx`, has: "legalPage" })),
  // The page shell names the operator; the company's requisites and papers.
  { file: "app/_legal/LegalPage.tsx", has: "tasarrufidagi loyiha" },
  { file: "lib/company.ts", has: "MUKAMMAL MEDIA GROUP" },
  { file: "lib/site-pages.ts", has: "site_pages" },
  { file: "app/layout.tsx", has: "MUKAMMAL MEDIA GROUP" },
  { file: "public/legal/mukammal-media-group-guvohnoma.pdf" },
  { file: "public/legal/mukammal-media-group-guvohnoma.webp" },
  { file: "public/legal/mukammal-media-group-noshirlik-tasdiqnoma.pdf" },
  { file: "public/legal/mukammal-media-group-noshirlik-tasdiqnoma.webp" },
];

export function missingLegalPieces(root = web) {
  const missing = [];
  for (const { file, has } of REQUIRED) {
    const full = path.join(root, file);
    if (!existsSync(full) || statSync(full).size === 0) { missing.push(`${file} (missing)`); continue; }
    if (has && !readFileSync(full, "utf8").includes(has)) missing.push(`${file} (no "${has}")`);
  }
  return missing;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const missing = missingLegalPieces();
  if (missing.length) {
    console.error([
      "",
      "✖ The legal pages are incomplete, so this build stops — the live site keeps its current deployment.",
      "  App Store Connect and Google Play link to /privacy, /support and /delete-account.",
      "  Missing:",
      ...missing.map((item) => `   - ${item}`),
      "  Restore them from GitHub (git pull / git checkout origin/main -- <path>) rather than deleting this check.",
      "",
    ].join("\n"));
    process.exit(1);
  }
}
