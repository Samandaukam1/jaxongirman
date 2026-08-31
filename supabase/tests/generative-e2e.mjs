import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

/**
 * A deck a customer would get, made by the generative engine.
 *
 * The preview proves the engine; this proves the product. It runs the real
 * generation function — the same job, the same credit reservation, the same
 * stages an author watches — with the engine switched on, and puts the switch
 * back where it found it whatever happens. A global flag left on by a failed
 * test would change what every customer gets.
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

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "  ✓" : "  ✖"} ${what}`);
  if (!ok) failures += 1;
};

const email = `generative-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
const presentationId = randomUUID();
let userId = "";
let previousFlag = null;

try {
  const flag = await service.from("app_settings").select("value").eq("key", "design.generative_enabled").single();
  previousFlag = flag.data?.value ?? false;
  const turnedOn = await service.from("app_settings").update({ value: true }).eq("key", "design.generative_enabled");
  if (turnedOn.error) throw turnedOn.error;

  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("test user not created");
  userId = created.data.user.id;
  const wallet = await service.from("credit_wallets").upsert({ user_id: userId, balance: 100_000 }, { onConflict: "user_id" });
  if (wallet.error) throw wallet.error;

  const user = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await user.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  const topic = process.env.TOPIC ?? "Suv resurslarini tejash";
  const slideCount = Number(process.env.SLIDE_COUNT ?? 6);
  console.log(`«${topic}» — ${slideCount} slayd, generativ engine\n`);

  const started = Date.now();
  const generated = await user.functions.invoke("generate-presentation", {
    body: {
      presentationId,
      topic,
      title: topic,
      style: "super_professional",
      slideCount,
      authorName: "Ali Valiyev",
      teacherName: "Dilnoza Karimova",
      sources: ["Jaxongirman generative E2E"],
      idempotencyKey: `generative:${presentationId}`,
    },
  });
  if (generated.error) {
    let detail = null;
    try { detail = await generated.error.context?.json?.(); } catch { /* consumed */ }
    throw new Error(detail?.error ?? generated.error.message);
  }

  let job = null;
  let stage = "";
  let quiet = 0;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const result = await service.from("generation_jobs")
      .select("status,stage,error_message").eq("presentation_id", presentationId).maybeSingle();
    if (result.error) throw result.error;
    job = result.data;
    if (job && job.stage !== stage) { stage = job.stage; quiet = 0; console.log(`  ${((Date.now() - started) / 1000).toFixed(0)}s  ${job.status}/${stage}`); }
    else quiet += 1;
    if (job && job.status !== "running" && job.status !== "queued") break;
    if (quiet >= 45) break;
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  console.log("");
  check(job?.status === "succeeded",
    `the deck was generated in ${seconds}s${job?.error_message ? ` — ${job.error_message}` : ` (${job?.stage ?? "?"})`}`);

  const deck = await service.from("presentations")
    .select("design_engine,design_dna,design_id,generated_slide_count,status").eq("id", presentationId).single();
  check(deck.data?.design_engine === "generative_v1", `the deck says which engine made it (${deck.data?.design_engine ?? "—"})`);
  // §37: no silent fallback. A deck that came from the old engine says so by
  // carrying a design; one made here carries none.
  check(deck.data?.design_id === null, "and no JSLAYD design was used");
  check(Boolean(deck.data?.design_dna?.fonts), "the visual language is recorded");
  check(deck.data?.status === "ready", `the deck is ready (${deck.data?.status})`);

  const slides = await service.from("slides").select("id,position,quality_score,quality_report").eq("presentation_id", presentationId).order("position");
  const elements = await service.from("slide_elements").select("slide_id,type,x,y,width,height,z_index,style,content").eq("presentation_id", presentationId);
  console.log("");
  for (const slide of slides.data ?? []) {
    const report = slide.quality_report ?? {};
    const mine = (elements.data ?? []).filter((row) => row.slide_id === slide.id).length;
    console.log(`  ${String(slide.position).padStart(2)} ${String(slide.quality_score).padStart(3)}/100  ${String(mine).padStart(2)} element${report.synthesised ? "  [engine qurdi]" : ""}${report.mirrored ? "  [ko'zgu]" : ""}  ${(report.faults ?? []).join(", ") || "—"}`);
  }
  console.log("");

  const scores = (slides.data ?? []).map((slide) => slide.quality_score);
  check((slides.data ?? []).length === slideCount, `every slide was stored (${(slides.data ?? []).length}/${slideCount})`);
  check(scores.every((score) => score >= 85), `no slide is below the line (worst ${Math.min(...scores)})`);
  const outside = (elements.data ?? []).filter((row) =>
    row.x < -1 || row.y < -1 || row.x + row.width > 1001 || row.y + row.height > 564);
  check(outside.length === 0, `nothing is stored outside the canvas the apps draw (${outside.length})`);
  const designed = (slides.data ?? []).filter((slide) => !slide.quality_report?.synthesised).length;
  check(designed * 2 >= (slides.data ?? []).length, `most pages were designed (${designed}/${(slides.data ?? []).length})`);

  /**
   * The cover, checked as its own thing.
   *
   * It is the page an author sees first and the only one whose subject is the
   * whole deck, so "the deck scored well" says nothing about whether it has a
   * cover on it.
   */
  console.log("Muqova:");
  const first = (slides.data ?? []).find((slide) => slide.position === 0);
  const onCover = (elements.data ?? []).filter((row) => row.slide_id === first?.id);
  const bleed = onCover.find((row) => row.type === "image" && row.width >= 999);
  check(Boolean(bleed), "a photograph fills the page");
  check(Boolean(bleed?.content?.storagePath || bleed?.content?.url), "and it is a picture that was actually found");
  const scrim = onCover.find((row) => row.content?.kind === "scrim");
  check(Boolean(scrim), "with a scrim between it and the words");
  check(Array.isArray(scrim?.style?.gradientStops), "that fades rather than covering it in flat black");
  const coverText = onCover.filter((row) => row.type === "text");
  const biggest = coverText.reduce((top, row) => (row.style?.fontSize ?? 0) > (top?.style?.fontSize ?? 0) ? row : top, null);
  check(Boolean(biggest) && (biggest.style?.fontSize ?? 0) >= 40, `the title dominates (${biggest?.style?.fontSize ?? 0}px)`);
  const words = coverText.map((row) => String(row.content?.text ?? "")).join(" ");
  check(words.includes("Ali Valiyev"), "the author is named");
  check(words.includes("Dilnoza Karimova"), "and so is the teacher");
  console.log("");

  /**
   * Overlap, measured on the rows that were stored.
   *
   * The engine checks the scene; this checks what came out of the conversion,
   * which is a different thing and the place two bugs have already hidden. A
   * photograph filling the page and the scrim over it are the ground every
   * cover is built on, so they are excluded — everything else has to keep out
   * of everything else's way.
   */
  const overlapping = [];
  for (const slide of slides.data ?? []) {
    const drawn = (elements.data ?? []).filter((row) =>
      row.slide_id === slide.id
      && row.content?.kind !== "scrim"
      && !(row.type === "image" && row.width >= 999));
    for (let i = 0; i < drawn.length; i += 1) {
      for (let j = i + 1; j < drawn.length; j += 1) {
        const a = drawn[i];
        const b = drawn[j];
        // A card holds what is inside it; that is not an overlap.
        const inside = (outer, box) =>
          box.x >= outer.x - 1 && box.y >= outer.y - 1
          && box.x + box.width <= outer.x + outer.width + 1
          && box.y + box.height <= outer.y + outer.height + 1;
        if (inside(a, b) || inside(b, a)) continue;
        const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (width > 2 && height > 2) overlapping.push(`${slide.position}:${a.type}×${b.type}`);
      }
    }
  }
  check(overlapping.length === 0, `nothing overlaps in the stored rows (${overlapping.join(", ") || "none"})`);

  const exported = await user.functions.invoke("export-presentation", { body: { presentationId, format: "pptx" } });
  check(!exported.error, `the deck exports to PowerPoint${exported.error ? ` — ${exported.error.message}` : ""}`);

  const [wallet2, stuck] = await Promise.all([
    service.from("credit_wallets").select("reserved").eq("user_id", userId).maybeSingle(),
    service.from("generation_jobs").select("id", { count: "exact", head: true }).eq("owner_id", userId).in("status", ["queued", "running"]),
  ]);
  check(Number(wallet2.data?.reserved ?? 0) === 0, `no credit is left reserved (${wallet2.data?.reserved ?? 0})`);
  check((stuck.count ?? 0) === 0, `no job is left running (${stuck.count ?? 0})`);

  console.log(JSON.stringify({
    engine: deck.data?.design_engine,
    seconds: Number(seconds),
    slides: (slides.data ?? []).length,
    elements: (elements.data ?? []).length,
    average_score: Number((scores.reduce((sum, one) => sum + one, 0) / Math.max(1, scores.length)).toFixed(1)),
    minimum_score: Math.min(...scores),
    designed,
    credit_leak: Number(wallet2.data?.reserved ?? 0),
    stuck_jobs: stuck.count ?? 0,
  }));
} finally {
  // The switch goes back where it was found, whatever happened above.
  if (previousFlag !== null) {
    await service.from("app_settings").update({ value: previousFlag }).eq("key", "design.generative_enabled");
  }
  if (userId) {
    const assets = await service.from("presentation_assets").select("storage_bucket,storage_path").eq("presentation_id", presentationId);
    for (const row of assets.data ?? []) await service.storage.from(row.storage_bucket).remove([row.storage_path]);
    await service.auth.admin.deleteUser(userId);
  }
}

const restored = await service.from("app_settings").select("value").eq("key", "design.generative_enabled").single();
check(restored.data?.value === previousFlag, `the switch is back where it was (${JSON.stringify(restored.data?.value)})`);
const left = await service.from("presentations").select("*", { count: "exact", head: true }).eq("id", presentationId);
check((left.count ?? 0) === 0, `nothing temporary remains (${left.count ?? 0})`);

console.log(failures ? `\n${failures} generative E2E check(s) failed.` : "\nAll generative E2E checks passed.");
process.exit(failures ? 1 : 0);
