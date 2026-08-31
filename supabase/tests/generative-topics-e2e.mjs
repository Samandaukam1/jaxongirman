import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

/**
 * Five decks, five subjects, one engine.
 *
 * One good deck says the engine can work; five different ones say it works.
 * The subjects are chosen to pull in different directions — a person, a place,
 * a science, a market, a classroom — because the failures this is looking for
 * are the ones a single topic hides: a mood that suits history and not
 * medicine, a font pairing that only reads on one palette, a page that is
 * always the same because the subject always was.
 *
 * The switch is turned on once, put back in a `finally`, and checked
 * afterwards. A global flag left on by a failed test changes what every
 * customer gets on their next generation.
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

const TOPICS = [
  ["TEXNOLOGIYA", "Sun'iy intellekt va mehnat bozori"],
  ["TARIX", "Amir Temur davlatining boshqaruv tizimi"],
  ["TIBBIYOT", "Yurak-qon tomir kasalliklari profilaktikasi"],
  ["BIZNES", "Kichik biznesda raqamli marketing"],
  ["TA'LIM", "Masofaviy ta'limning samaradorligi"],
];

const email = `topics-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
const decks = new Map();
let userId = "";
let previousFlag = null;

async function waitFor(presentationId, started) {
  let job = null;
  let stage = "";
  let quiet = 0;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const result = await service.from("generation_jobs")
      .select("status,stage,error_message").eq("presentation_id", presentationId).maybeSingle();
    if (result.error) throw result.error;
    job = result.data;
    if (job && job.stage !== stage) { stage = job.stage; quiet = 0; } else quiet += 1;
    if (job && job.status !== "running" && job.status !== "queued") break;
    if (quiet >= 45) break;
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  return { job, seconds: Number(((Date.now() - started) / 1000).toFixed(0)) };
}

try {
  const flag = await service.from("app_settings").select("value").eq("key", "design.generative_enabled").single();
  previousFlag = flag.data?.value ?? false;
  const on = await service.from("app_settings").update({ value: true }).eq("key", "design.generative_enabled");
  if (on.error) throw on.error;

  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("test user not created");
  userId = created.data.user.id;
  const wallet = await service.from("credit_wallets").upsert({ user_id: userId, balance: 400_000 }, { onConflict: "user_id" });
  if (wallet.error) throw wallet.error;

  const user = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await user.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  const slideCount = Number(process.env.SLIDE_COUNT ?? 6);
  const summary = [];

  for (const [kind, topic] of TOPICS) {
    const presentationId = randomUUID();
    decks.set(kind, presentationId);
    const started = Date.now();
    const generated = await user.functions.invoke("generate-presentation", {
      body: {
        presentationId, topic, title: topic, style: "super_professional", slideCount,
        sources: ["Jaxongirman generative topics E2E"],
        idempotencyKey: `topics:${presentationId}`,
      },
    });
    if (generated.error) {
      let detail = null;
      try { detail = await generated.error.context?.json?.(); } catch { /* consumed */ }
      console.log(`  ✖ ${kind}: ${detail?.error ?? generated.error.message}`);
      failures += 1;
      continue;
    }

    const { job, seconds } = await waitFor(presentationId, started);
    const deck = await service.from("presentations").select("design_engine,design_dna").eq("id", presentationId).single();
    const slides = await service.from("slides").select("id,quality_score,quality_report").eq("presentation_id", presentationId);
    const elements = await service.from("slide_elements").select("slide_id,x,y,width,height").eq("presentation_id", presentationId);

    const scores = (slides.data ?? []).map((slide) => slide.quality_score);
    const designed = (slides.data ?? []).filter((slide) => !slide.quality_report?.synthesised).length;
    const outside = (elements.data ?? []).filter((row) =>
      row.x < -1 || row.y < -1 || row.x + row.width > 1001 || row.y + row.height > 564).length;
    const dna = deck.data?.design_dna ?? {};

    summary.push({
      kind, seconds,
      status: job?.status ?? "?",
      slides: (slides.data ?? []).length,
      elements: (elements.data ?? []).length,
      worst: scores.length ? Math.min(...scores) : 0,
      designed,
      outside,
      mood: dna.direction?.mood ?? "?",
      ground: dna.direction?.ground ?? "?",
      display: dna.fonts?.display ?? "?",
    });

    console.log(`  ${kind.padEnd(12)} ${String(seconds).padStart(3)}s  ${(slides.data ?? []).length} slayd  ${String((elements.data ?? []).length).padStart(2)} element  eng past ${String(scores.length ? Math.min(...scores) : 0).padStart(3)}  ${designed}/${(slides.data ?? []).length} dizayn  ${dna.direction?.mood ?? "?"}/${dna.direction?.ground ?? "?"}  ${dna.fonts?.display ?? "?"}`);
  }

  console.log("");
  check(summary.length === TOPICS.length, `every subject produced a deck (${summary.length}/${TOPICS.length})`);
  check(summary.every((one) => one.status === "succeeded"), `every generation succeeded (${summary.filter((one) => one.status === "succeeded").length})`);
  check(summary.every((one) => one.slides === slideCount), `every deck has the slides it asked for (${summary.map((one) => one.slides).join(", ")})`);
  check(summary.every((one) => one.worst >= 85), `no slide anywhere is below the line (worst ${Math.min(...summary.map((one) => one.worst))})`);
  check(summary.every((one) => one.outside === 0), `nothing is stored off-canvas (${summary.reduce((sum, one) => sum + one.outside, 0)})`);
  check(summary.every((one) => one.designed * 2 >= one.slides), `most pages were designed on every subject (${summary.map((one) => `${one.designed}/${one.slides}`).join(" ")})`);

  /**
   * Different subjects should not look identical.
   *
   * A visual language chosen from the topic that comes back the same for a
   * classroom and a cardiology deck is a language chosen from nothing.
   */
  const moods = new Set(summary.map((one) => one.mood));
  check(moods.size >= 2, `the visual language varies by subject (${[...moods].join(", ")})`);

  const [wallet2, stuck] = await Promise.all([
    service.from("credit_wallets").select("reserved").eq("user_id", userId).maybeSingle(),
    service.from("generation_jobs").select("id", { count: "exact", head: true }).eq("owner_id", userId).in("status", ["queued", "running"]),
  ]);
  check(Number(wallet2.data?.reserved ?? 0) === 0, `no credit is left reserved (${wallet2.data?.reserved ?? 0})`);
  check((stuck.count ?? 0) === 0, `no job is left running (${stuck.count ?? 0})`);

  console.log(JSON.stringify({
    decks: summary.length,
    total_seconds: summary.reduce((sum, one) => sum + one.seconds, 0),
    worst_slide: Math.min(...summary.map((one) => one.worst)),
    designed: summary.reduce((sum, one) => sum + one.designed, 0),
    of: summary.reduce((sum, one) => sum + one.slides, 0),
    moods: [...moods],
  }));
} finally {
  if (previousFlag !== null) {
    await service.from("app_settings").update({ value: previousFlag }).eq("key", "design.generative_enabled");
  }
  if (userId) {
    for (const id of decks.values()) {
      const assets = await service.from("presentation_assets").select("storage_bucket,storage_path").eq("presentation_id", id);
      for (const row of assets.data ?? []) await service.storage.from(row.storage_bucket).remove([row.storage_path]);
    }
    await service.auth.admin.deleteUser(userId);
  }
}

const restored = await service.from("app_settings").select("value").eq("key", "design.generative_enabled").single();
check(restored.data?.value === previousFlag, `the switch is back where it was (${JSON.stringify(restored.data?.value)})`);
const left = await service.from("presentations").select("*", { count: "exact", head: true }).in("id", [...decks.values()]);
check((left.count ?? 0) === 0, `nothing temporary remains (${left.count ?? 0})`);

console.log(failures ? `\n${failures} check(s) failed across the five subjects.` : "\nAll five subjects passed.");
process.exit(failures ? 1 : 0);
