/**
 * Running a real deck's export, against real production rows, on this machine.
 *
 * The export runs inside an edge worker, and when one of those dies it leaves
 * behind a job stuck at "running" and a client holding "Edge Function returned
 * a non-2xx status code" — a sentence that names neither the deck, the design,
 * nor the step. Guessing from it is how an afternoon disappears.
 *
 * So this does exactly what `cloneIfTemplate` and `generateExport` do, with the
 * same rows and the same package, where the output is visible and the failure
 * has a stack. It writes nothing back: no job row, no storage object, no credit.
 *
 * Usage:
 *   node supabase/scripts/export-smoke.mjs                 # the ten newest decks
 *   node supabase/scripts/export-smoke.mjs <presentationId>
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 */

import { writeFileSync } from "node:fs";

import { buildEdgeModules } from "./build-edge.mjs";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("EXPO_PUBLIC_SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY kerak.");
  process.exit(2);
}

const edge = buildEdgeModules();
const { exportByCloning } = await import(`${edge}/pptx-clone-export.js`);

const rest = async (path) => {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`${path} → ${response.status} ${await response.text()}`);
  return response.json();
};

const download = async (bucket, path) => {
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
};

const wanted = process.argv[2];
const decks = wanted
  ? await rest(`presentations?select=id,title,status,design_id,design_version&id=eq.${wanted}`)
  : await rest("presentations?select=id,title,status,design_id,design_version&status=eq.ready&order=created_at.desc&limit=10");

let failures = 0;

for (const deck of decks) {
  console.log(`\n── ${deck.title.slice(0, 52)}`);

  const slides = await rest(`slides?select=id,position,quality_report&presentation_id=eq.${deck.id}&order=position`);
  const engines = new Set(slides.map((slide) => String(slide.quality_report?.engine ?? "—")));
  console.log(`   ${slides.length} slayd · engine: ${[...engines].join(", ")} · dizayn: ${String(deck.design_id).slice(0, 8)} v${deck.design_version}`);

  const clone = [...engines].includes("pptx_clone");
  if (!clone) { console.log("   JSLAYD yo‘li — bu skript klonlashni tekshiradi, o‘tkazib yuborildi."); continue; }

  if (!deck.design_id) {
    console.log("   ✖ dizayn o‘chirilgan (design_id null) — klonlash uchun paket yo‘q");
    failures += 1;
    continue;
  }

  const [design] = await rest(`presentation_designs?select=slug,design_source,source_asset_path,published_version&id=eq.${deck.design_id}`);
  if (!design?.source_asset_path) {
    console.log("   ✖ shablon fayli manzili yo‘q");
    failures += 1;
    continue;
  }

  const version = deck.design_version ?? design.published_version ?? 1;
  const profiles = await rest(
    `design_slide_profiles?select=archetype_id,source_slide_part,text_map&design_id=eq.${deck.design_id}&design_version=eq.${version}`,
  );
  console.log(`   ${profiles.length} sahifa profili (v${version})`);
  if (profiles.length === 0) {
    console.log("   ✖ sahifalar shablonga bog‘lanmagan — qayta import kerak");
    failures += 1;
    continue;
  }

  const ids = slides.map((slide) => `"${slide.id}"`).join(",");
  const elements = await rest(`slide_elements?select=slide_id,type,content&slide_id=in.(${ids})`);

  const bytes = await download("design-source", design.source_asset_path);
  if (!bytes) { console.log("   ✖ shablon fayli yuklab olinmadi"); failures += 1; continue; }
  console.log(`   paket ${(bytes.byteLength / 1048576).toFixed(1)} MB`);

  const started = Date.now();
  const result = await exportByCloning(bytes, slides, elements, profiles);
  const took = ((Date.now() - started) / 1000).toFixed(1);

  if (!result.ok) {
    console.log(`   ✖ ${took}s — ${result.reason}`);
    failures += 1;
    continue;
  }
  console.log(`   ✓ ${took}s — ${(result.bytes.byteLength / 1048576).toFixed(1)} MB, `
    + `${result.report.slides.length} sahifa, matn qoldig‘i ${result.report.leftoverText.length}, `
    + `tuzilish ${result.report.structuralFidelityPassed ? "butun" : "BUZILGAN"}`);
  if (wanted) {
    writeFileSync(`${deck.id}.pptx`, result.bytes);
    console.log(`   → ${deck.id}.pptx`);
  }
}

console.log(`\n${failures === 0 ? "Hammasi o‘tdi." : `${failures} ta deck eksport bo‘lmaydi.`}`);
process.exit(failures === 0 ? 0 : 1);
