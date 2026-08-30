import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { buildJslayd } from "../../packages/jslayd/tests/build.mjs";
import { buildEdgeModules } from "../scripts/build-edge.mjs";

/**
 * How much of each box a generated deck actually fills.
 *
 * Every check in this repository asks whether copy is too long, because copy
 * that overflows is visibly cut off. Nothing asked the other question, and the
 * answer turned out to be that content boxes measured for 578 characters were
 * receiving 136 — one sentence in a space composed for a paragraph, on every
 * content slide of every deck. An author noticed before any test did.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node supabase/tests/text-fill-e2e.mjs
 *
 * Generates a real deck and measures the written copy against the budget the
 * design's own geometry produces. The thresholds are ratios rather than
 * character counts so they stay true for a design with different boxes.
 */

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? (() => {
  try {
    return readFileSync(new URL("../../user/.env", import.meta.url), "utf8")
      .match(/^EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m)?.[1]?.trim() ?? "";
  } catch { return ""; }
})();

if (!url || !serviceKey || !anonKey) {
  console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and an anon key are required.");
  process.exit(1);
}

const pkg = buildJslayd();
const edge = buildEdgeModules();
const { buildWritingBrief, checkFit } = await import(`${pkg}/index.js`);
const { readDesign } = await import(`${edge}/jslayd-layout.js`);
const { unzip } = await import(`${edge}/unzip.js`);

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "  ✓" : "  ✖"} ${what}`);
  if (!ok) failures += 1;
};

/** Roles that carry what a slide says, as opposed to labelling it. */
const CONTENT_ROLES = new Set(["body", "bullets", "quote", "statistic_label", "subtitle"]);
/** What "the box looks full" means, as a fraction of the design's own aim. */
const TARGET = 0.6;

const email = `text-fill-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
const presentationId = randomUUID();
const designSlug = process.env.DESIGN_SLUG ?? "buildora-editorial-construction";
let userId = "";
const exportPaths = [];
let cleanupStorageFailures = 0;

try {
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("test user not created");
  userId = created.data.user.id;
  const wallet = await service.from("credit_wallets").upsert({ user_id: userId, balance: 100_000 }, { onConflict: "user_id" });
  if (wallet.error) throw wallet.error;

  const user = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await user.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  const started = Date.now();
  const generated = await user.functions.invoke("generate-presentation", {
    body: {
      presentationId,
      topic: process.env.TOPIC ?? "Giyohvandlikka qarshi kurash va profilaktika",
      title: "Giyohvandlikka qarshi kurash",
      style: "super_professional",
      designSlug,
      slideCount: Number(process.env.SLIDE_COUNT ?? 8),
      sources: ["Jaxongirman text fill E2E"],
      idempotencyKey: `text-fill:${presentationId}`,
    },
  });
  if (generated.error) {
    const detail = typeof generated.error.context?.json === "function" ? await generated.error.context.json() : null;
    throw new Error(detail?.error ?? generated.error.message);
  }

  let job = null;
  let stage = "";
  let quiet = 0;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const result = await service.from("generation_jobs")
      .select("id,status,stage,error_message").eq("presentation_id", presentationId).maybeSingle();
    if (result.error) throw result.error;
    job = result.data;
    if (job && job.stage !== stage) { stage = job.stage; quiet = 0; } else quiet += 1;
    if (job && job.status !== "running" && job.status !== "queued") break;
    if (quiet >= 45) break;
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  check(job?.status === "succeeded",
    `the deck was generated in ${((Date.now() - started) / 1000).toFixed(0)}s${job?.error_message ? ` — ${job.error_message}` : ""}`);
  const generationSeconds = Number(((Date.now() - started) / 1000).toFixed(1));

  const layoutStep = await service.from("generation_steps")
    .select("key,message").eq("presentation_id", presentationId).eq("key", "visual_identity").maybeSingle();
  if (layoutStep.data?.message) console.log(`\nLayout: ${layoutStep.data.message}`);

  const deck = await service.from("presentations").select("design_id").eq("id", presentationId).single();
  const design = await service.from("presentation_designs")
    .select("id,slug,published_version,compiled_config").eq("id", deck.data.design_id).single();
  const read = readDesign({ ...design.data, version: design.data.published_version });
  if (!read.design) throw new Error(read.reason ?? "design unreadable");
  const document = read.design.document;

  const slides = await service.from("slides")
    .select("id,position,quality_report").eq("presentation_id", presentationId).order("position");
  const elements = await service.from("slide_elements")
    .select("slide_id,type,content").eq("presentation_id", presentationId);
  const groundedSources = await service.from("presentation_sources")
    .select("id", { count: "exact", head: true })
    .eq("presentation_id", presentationId);
  if (groundedSources.error) throw groundedSources.error;

  const totals = new Map();
  const writtenBodyLike = { used: 0, aim: 0 };
  const silent = [];
  const overflowing = [];

  console.log(`\n«${design.data.slug}» — yozilgan / mo'ljal / chegara:`);
  for (const slide of slides.data ?? []) {
    const archetype = document.archetypes.find((entry) => entry.id === slide.quality_report?.archetype);
    if (!archetype) continue;
    const brief = buildWritingBrief(document, archetype, { language: "uz" });
    const onSlide = (elements.data ?? []).filter((row) => row.slide_id === slide.id);
    const mine = onSlide.filter((row) => row.type === "text");
    const parts = [];
    let speaks = onSlide.some((row) =>
      row.type === "chart"
      && ["bar", "donut"].includes(row.content?.chartType)
      && Array.isArray(row.content?.values)
      && row.content.values.length >= 2);

    // A list element carries no `elementId` — the renderer writes markers
    // instead — so slots are matched by id where there is one and by position
    // among what is left where there is not. Getting this wrong reports a
    // filled agenda as an empty one, which is how the first measurement of
    // this deck understated itself.
    const spare = mine.filter((row) => !row.content?.elementId);
    let at = 0;
    const fixed = slide.position < 2 || slide.position >= (slides.data?.length ?? 0) - 2;

    for (const slot of brief.slots) {
      const element = mine.find((row) => row.content?.elementId === slot.elementId) ?? spare[at++];
      const text = typeof element?.content?.text === "string"
        ? element.content.text
        : Array.isArray(element?.content?.items) ? element.content.items.join("\n") : "";
      const written = text.trim();
      if (written && CONTENT_ROLES.has(slot.role)) speaks = true;
      // Only what the writer produced. The cover carries the author's own
      // topic and the bibliography page a fixed heading; both are laid into
      // whatever box the design has, and shrinking type to fit them is the
      // renderer's job rather than a writing failure.
      const generatedRole = ["title", "subtitle", "body", "bullets", "quote", "statistic_label"].includes(slot.role);
      if (written && !fixed && generatedRole && !checkFit(slot, written).fits) {
        overflowing.push(`${slide.position}/${slot.role}`);
      }
      if (!fixed && ["body", "bullets"].includes(slot.role)) {
        writtenBodyLike.used += written.length;
        writtenBodyLike.aim += slot.budget.preferredCharacters;
      }

      const row = totals.get(slot.role) ?? { used: 0, aim: 0, slots: 0, empty: 0 };
      row.used += written.length;
      row.aim += slot.budget.preferredCharacters;
      row.slots += 1;
      if (!written) row.empty += 1;
      totals.set(slot.role, row);
      parts.push(`${slot.role}=${written.length}/${slot.budget.preferredCharacters}`);
    }

    // A divider is not silent: a page whose design offers no content box at
    // all is a deliberate composition, and demanding a paragraph on it would
    // be asking the deck to fight its own design.
    const canSpeak = brief.slots.some((slot) => CONTENT_ROLES.has(slot.role));
    if (canSpeak && !speaks) silent.push(slide.position);
    console.log(`  ${String(slide.position).padStart(2)} ${String(slide.quality_report?.archetype ?? "?").padEnd(20)} ${parts.join("  ")}`);
  }

  console.log("\nrol                yozilgan   mo'ljal   nisbat   bo'sh");
  for (const [role, row] of totals) {
    console.log(`${role.padEnd(20)}${String(row.used).padStart(7)}${String(row.aim).padStart(10)}     ${(row.used / row.aim).toFixed(2)}    ${row.empty}/${row.slots}`);
  }

  // Measure only model-written content slides. Agenda bullets and other fixed
  // server copy are intentionally concise and used to pull a healthy deck
  // below the threshold even though the actual body boxes were full.
  const bodyLike = writtenBodyLike;
  const ratio = bodyLike.aim > 0 ? bodyLike.used / bodyLike.aim : 0;

  console.log("");
  check(bodyLike.aim > 0, "the deck has content boxes to fill");
  // The measured baseline before this change was 0.23–0.27 of aim. Three times
  // that is 0.7, and the aim already holds the design's whitespace back, so a
  // full box is the target rather than a risk.
  check(ratio >= TARGET, `content boxes are filled, not sampled (${ratio.toFixed(2)} of aim, was 0.25)`);
  check(silent.length === 0, `every slide says something (${silent.length} silent: ${silent.join(", ") || "none"})`);
  check(overflowing.length === 0, `nothing overflows its box (${overflowing.join(", ") || "none"})`);
  check((groundedSources.count ?? 0) > 0, `research/context grounding is preserved (${groundedSources.count ?? 0} sources)`);

  const generatedSlideIds = new Set((slides.data ?? [])
    .filter((slide) => slide.position >= 2 && slide.position < (slides.data?.length ?? 0) - 2)
    .map((slide) => slide.id));
  const sentences = (elements.data ?? [])
    .filter((row) => row.type === "text" && generatedSlideIds.has(row.slide_id))
    .flatMap((row) => {
      const content = typeof row.content?.text === "string"
        ? row.content.text
        : Array.isArray(row.content?.items) ? row.content.items.join(". ") : "";
      return content.split(/(?<=[.!?])\s+|\n+/)
        .map((sentence) => sentence.toLocaleLowerCase("uz").replace(/\s+/g, " ").trim())
        .filter((sentence) => sentence.length >= 30)
        .map((sentence) => ({ sentence, slideId: row.slide_id }));
    });
  const sentenceSlides = new Map();
  for (const { sentence, slideId } of sentences) {
    const seen = sentenceSlides.get(sentence) ?? new Set();
    seen.add(slideId);
    sentenceSlides.set(sentence, seen);
  }
  const duplicateSentences = [...sentenceSlides.values()].filter((slideIds) => slideIds.size > 1).length;
  if (duplicateSentences > 0) {
    console.log("Cross-slide duplicates:", [...sentenceSlides]
      .filter(([, slideIds]) => slideIds.size > 1)
      .slice(0, 3)
      .map(([sentence]) => sentence.slice(0, 160)));
  }
  check(duplicateSentences === 0, `no repeated filler sentences (${duplicateSentences} duplicates)`);

  const chartRows = (elements.data ?? []).filter((row) =>
    row.type === "chart"
    && ["bar", "donut"].includes(row.content?.chartType)
    && Array.isArray(row.content?.labels)
    && Array.isArray(row.content?.values)
    && row.content.labels.length >= 2
    && row.content.labels.length === row.content.values.length);
  check(chartRows.length >= 1, `the deck contains a visible bar/pie chart (${chartRows.length})`);

  /**
   * Two charts in a row should not be the same chart.
   *
   * Ordered by the slide they sit on, because a deck reads in that order and
   * "two bars one slide apart" is what a reader sees. A repeat is allowed only
   * where the numbers cannot be drawn the other way — a doughnut is parts of a
   * whole, so a negative value keeps its bar.
   */
  const positionOf = new Map((slides.data ?? []).map((row) => [row.id, row.position]));
  const inOrder = chartRows
    .slice()
    .sort((a, b) => (positionOf.get(a.slide_id) ?? 0) - (positionOf.get(b.slide_id) ?? 0));
  const repeats = [];
  for (let at = 1; at < inOrder.length; at += 1) {
    const before = inOrder[at - 1];
    const now = inOrder[at];
    if (before.content.chartType !== now.content.chartType) continue;
    const drawable = now.content.values.every((value) => value >= 0)
      && now.content.values.some((value) => value > 0);
    if (drawable) repeats.push(`${positionOf.get(before.slide_id)}→${positionOf.get(now.slide_id)}:${now.content.chartType}`);
  }
  check(repeats.length === 0, `no two consecutive charts share a shape (${repeats.join(", ") || "none"})`);
  console.log(`  ℹ  chart tartibi: ${inOrder.map((row) => `${positionOf.get(row.slide_id)}:${row.content.chartType}`).join(", ") || "—"}`);

  // The database preview is not the product claim: the exported PowerPoint
  // must carry a real chart part. Generate the actual production .pptx, open
  // its ZIP package and require a native bar/doughnut chart node.
  const requestedExport = await user.functions.invoke("export-presentation", {
    body: { presentationId, format: "pptx" },
  });
  if (requestedExport.error) {
    const detail = typeof requestedExport.error.context?.json === "function"
      ? await requestedExport.error.context.json()
      : null;
    throw new Error(detail?.error ?? requestedExport.error.message);
  }
  const exportJobId = requestedExport.data?.jobId;
  let exportJob = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await service.from("export_jobs")
      .select("status,storage_path,error_message").eq("id", exportJobId).maybeSingle();
    if (result.error) throw result.error;
    exportJob = result.data;
    if (exportJob && !["queued", "running"].includes(exportJob.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  check(exportJob?.status === "succeeded", `production PPTX export succeeds${exportJob?.error_message ? ` — ${exportJob.error_message}` : ""}`);
  let pptxChartParts = 0;
  if (exportJob?.storage_path) {
    exportPaths.push(exportJob.storage_path);
    const file = await service.storage.from("exports").download(exportJob.storage_path);
    if (file.error || !file.data) throw file.error ?? new Error("export file missing");
    const parts = await unzip(new Uint8Array(await file.data.arrayBuffer()));
    const decoder = new TextDecoder();
    const charts = [...parts].filter(([name]) => /^ppt\/charts\/[^/]+\.xml$/i.test(name));
    pptxChartParts = charts.filter(([, bytes]) => /<c:(barChart|doughnutChart)\b/.test(decoder.decode(bytes))).length;
  }
  check(pptxChartParts >= 1, `the PPTX package contains a native bar/pie chart (${pptxChartParts})`);

  const [walletAfter, rewrites, stuck] = await Promise.all([
    service.from("credit_wallets").select("reserved").eq("user_id", userId).single(),
    service.from("ai_usage").select("id", { count: "exact", head: true })
      .eq("presentation_id", presentationId).eq("operation", "content_rewrite"),
    service.from("generation_jobs").select("id", { count: "exact", head: true })
      .eq("owner_id", userId).in("status", ["queued", "running"]),
  ]);
  for (const result of [walletAfter, rewrites, stuck]) {
    if (result.error) throw result.error;
  }
  check(Number(walletAfter.data?.reserved ?? 0) === 0, "no credits remain reserved");
  check((stuck.count ?? 0) === 0, "no generation job remains stuck");

  console.log(JSON.stringify({
    design: design.data.slug,
    fill_ratio: Number(ratio.toFixed(2)),
    silent_slides: silent.length,
    overflowing: overflowing.length,
    charts: chartRows.length,
    chart_shape_repeats: repeats.length,
    pptx_chart_parts: pptxChartParts,
    generation_seconds: generationSeconds,
    rewrite_passes: rewrites.count ?? 0,
    grounded_sources: groundedSources.count ?? 0,
    duplicate_sentences: duplicateSentences,
    credit_leak: Number(walletAfter.data?.reserved ?? 0),
    stuck_jobs: stuck.count ?? 0,
  }));
} finally {
  // KEEP=1 leaves the deck in place for inspection. Off by default, because a
  // test that runs against production and keeps what it made is a leak.
  if (userId && !process.env.KEEP) {
    if (exportPaths.length > 0) {
      const removed = await service.storage.from("exports").remove(exportPaths);
      if (removed.error) cleanupStorageFailures += 1;
    }
    const assets = await service.from("presentation_assets").select("storage_bucket,storage_path").eq("presentation_id", presentationId);
    for (const row of assets.data ?? []) {
      const removed = await service.storage.from(row.storage_bucket).remove([row.storage_path]);
      if (removed.error) cleanupStorageFailures += 1;
    }
    await service.auth.admin.deleteUser(userId);
  }
}

if (process.env.KEEP) console.log(`\nKEPT: presentation ${presentationId} owner ${userId}`);
const left = process.env.KEEP
  ? { count: 0 }
  : await service.from("presentations").select("*", { count: "exact", head: true }).eq("id", presentationId);
check((left.count ?? 0) === 0, `nothing temporary remains (${left.count ?? 0})`);
const jobsLeft = await service.from("generation_jobs").select("id", { count: "exact", head: true }).eq("presentation_id", presentationId);
const exportsLeft = await service.from("export_jobs").select("id", { count: "exact", head: true }).eq("presentation_id", presentationId);
check((jobsLeft.count ?? 0) === 0 && (exportsLeft.count ?? 0) === 0,
  `no temporary jobs remain (${jobsLeft.count ?? 0} generation, ${exportsLeft.count ?? 0} export)`);
const userLeft = userId ? await service.auth.admin.getUserById(userId) : null;
check(!userLeft?.data?.user, "the temporary auth user was deleted");
check(cleanupStorageFailures === 0, `temporary Storage cleanup succeeded (${cleanupStorageFailures} errors)`);

console.log(failures ? `\n${failures} text fill check(s) failed.` : "\nAll text fill checks passed.");
process.exit(failures ? 1 : 0);
