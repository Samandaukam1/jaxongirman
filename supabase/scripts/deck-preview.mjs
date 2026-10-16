#!/usr/bin/env node
/**
 * Photographs a real deck: the rows a customer's generation saved, read from
 * the linked project and painted as one contact sheet.
 *
 *   node supabase/scripts/deck-preview.mjs <presentationId> [outDir] [--job=<operator trial job id>]
 *
 * Read-only against the database. Photographs live in a private bucket, so
 * they appear only for an operator trial deck (`--job`), whose own one-time
 * secret lets `ai-diagnose` sign its pictures for an hour; any other deck is
 * drawn with grey frames where its photographs are.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { repoRoot } from "./build-edge.mjs";
import { contactSheet } from "./glass-paint.mjs";

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
const presentationId = positional[0];
if (!/^[0-9a-f-]{36}$/.test(presentationId ?? "")) {
  console.error("usage: deck-preview.mjs <presentationId> [outDir] [--job=<jobId>]");
  process.exit(1);
}
const outDir = path.resolve(positional[1] ?? path.join(tmpdir(), "deck-preview"));
const jobId = args.find((arg) => arg.startsWith("--job="))?.split("=")[1] ?? null;
mkdirSync(outDir, { recursive: true });

const env = readFileSync(path.join(repoRoot, "user/.env"), "utf8");
const supabaseUrl = env.match(/^EXPO_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1]?.trim();
const anonKey = env.match(/^EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m)?.[1]?.trim();

function query(sql) {
  const raw = execFileSync("npx", ["supabase", "db", "query", "--linked", sql], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(raw.slice(raw.indexOf("{"))).rows;
}

const [presentation] = query(`select title, design_dna from public.presentations where id = '${presentationId}'`);
if (!presentation) throw new Error("presentation not found");
const slides = query(`select id, position, layout, background from public.slides where presentation_id = '${presentationId}' order by position`);
const elements = query(`select slide_id, type, x, y, width, height, rotation, opacity, z_index, style, content from public.slide_elements where presentation_id = '${presentationId}' order by z_index`);

const parse = (value) => (typeof value === "string" ? JSON.parse(value) : value ?? {});
const deck = slides.map((slide) => ({
  layout: slide.layout,
  background: parse(slide.background),
  rows: elements.filter((row) => row.slide_id === slide.id).map((row) => ({
    ...row,
    x: Number(row.x), y: Number(row.y), width: Number(row.width), height: Number(row.height),
    rotation: Number(row.rotation), opacity: Number(row.opacity),
    style: parse(row.style), content: parse(row.content),
  })),
}));

let links = {};
if (jobId) {
  const [job] = query(`select idempotency_key from public.generation_jobs where id = '${jobId}' and presentation_id = '${presentationId}'`);
  const secret = String(job?.idempotency_key ?? "").replace(/^operator-trial:/, "");
  const response = await fetch(`${supabaseUrl}/functions/v1/ai-diagnose`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anonKey },
    body: JSON.stringify({ action: "trial_images", jobId, secret }),
  });
  if (response.ok) links = (await response.json()).links ?? {};
  else console.error(`photographs not signed: HTTP ${response.status}`);
}
const GREY = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#888"/></svg>');
const imageUrl = (row) => links[row.content.storagePath] ?? row.content.url ?? GREY;

const dna = parse(presentation.design_dna);
const caption = `${presentation.title} · ${dna.direction?.mode ?? ""} · ${dna.direction?.mood ?? ""} · ${dna.fonts?.display?.family ?? ""} + ${dna.fonts?.body?.family ?? ""} · ${deck.map((slide) => slide.layout).join(", ")}`;
const png = contactSheet({ deck, caption, outDir, name: `deck-${presentationId.slice(0, 8)}`, supabaseUrl, imageUrl });
console.log(png);
