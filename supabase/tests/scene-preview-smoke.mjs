import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

/**
 * Whether a real model can actually answer the scene schema.
 *
 * Everything about the engine is unit-tested against fakes, which proves the
 * arithmetic and proves nothing about the model. This asks the deployed
 * function for a real deck and checks what came back with the same rules the
 * engine uses: does it read, does it fit, does anything overlap, did the fonts
 * come from the library, are the colours the palette's.
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

const email = `scene-preview-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
let userId = "";
let deckId = null;

try {
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("test admin not created");
  userId = created.data.user.id;
  await service.from("user_roles").upsert({ user_id: userId, role: "admin" });

  const admin = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await admin.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  const topic = process.env.TOPIC ?? "Sun'iy intellektning ta'limdagi o'rni";
  const titles = (process.env.TITLES ?? "Kirish|Bugungi holat|Imkoniyatlar|Xulosa").split("|");

  console.log(`«${topic}» — ${titles.length} slayd\n`);
  const started = Date.now();
  const answer = await admin.functions.invoke("scene-preview", { body: { topic, titles, persist: true } });
  if (answer.error) {
    let detail = null;
    try { detail = await answer.error.context?.json?.(); } catch { /* consumed */ }
    throw new Error(detail?.error ?? answer.error.message);
  }
  const deck = answer.data;
  deckId = deck.presentationId ?? null;
  const seconds = ((Date.now() - started) / 1000).toFixed(0);

  console.log(`Vizual til: ${deck.dna.direction.mood} / ${deck.dna.direction.ground} / ${deck.dna.direction.brand}`);
  console.log(`Fontlar: ${Object.entries(deck.dna.fonts).map(([role, name]) => `${role}=${name}`).join(", ")}`);
  console.log("");

  check(deck.engine === "generative_v1", `the generative engine ran (${deck.engine})`);
  check(deck.slides.length === titles.length, `every slide came back (${deck.slides.length}/${titles.length})`);

  // The library is the only source of faces, and this is the first time a real
  // one has been consulted.
  const { data: families } = await service.from("font_families").select("canonical_name").eq("is_active", true).limit(1000);
  const known = new Set((families ?? []).map((row) => row.canonical_name));
  const invented = Object.values(deck.dna.fonts).filter((name) => !known.has(name));
  check(invented.length === 0, `every face is one the library holds (${invented.join(", ") || "all known"})`);

  const palette = new Set(Object.values(deck.dna.colors));
  let offPalette = 0;
  let overflowing = 0;
  let colliding = 0;

  for (const slide of deck.slides) {
    const faults = slide.faults.join(", ") || "—";
    console.log(`  ${slide.index} ${String(slide.title).slice(0, 24).padEnd(26)} ${String(slide.score).padStart(3)}/100  ${slide.attempts} urinish${slide.synthesised ? "  [engine qurdi]" : ""}  ${faults}`);
    if (!slide.rendered) continue;
    for (const row of slide.rendered.elements) {
      if (row.type === "text" && typeof row.style.color === "string" && !palette.has(row.style.color)) offPalette += 1;
    }
    if (slide.faults.includes("overflow")) overflowing += 1;
    if (slide.faults.includes("collision")) colliding += 1;
  }

  const scores = deck.observability.scores;
  const worst = Math.min(...scores);
  const average = scores.reduce((sum, one) => sum + one, 0) / scores.length;
  console.log("");
  check(colliding === 0, `nothing overlaps on any slide (${colliding})`);
  check(overflowing === 0, `no copy overflows its box (${overflowing})`);
  check(offPalette === 0, `every colour drawn is one the palette derived (${offPalette} strays)`);
  check(deck.slides.every((slide) => slide.scene), "every slide came back as a page");
  const designed = deck.slides.filter((slide) => !slide.synthesised).length;
  check(designed >= Math.ceil(deck.slides.length * 0.75),
    `most pages were designed rather than built from the brief (${designed}/${deck.slides.length})`);
  check(worst >= 90, `the weakest slide is still sound (${worst}/100)`);
  check(deck.observability.repeatedCompositions.length === 0,
    `no slide repeats the composition before it (${deck.observability.repeatedCompositions.join(", ") || "none"})`);

  /**
   * The deck as the product sees it.
   *
   * Returning JSON proves the engine; reading the saved rows back proves the
   * phone can draw them, the editor can open them and the exporter can read
   * them — which is the only claim worth making.
   */
  console.log("\nSaqlangan deck:");
  check(Boolean(deck.presentationId), "the deck was saved");
  if (deck.presentationId) {
    const saved = await service.from("presentations")
      .select("design_engine,design_dna,generated_slide_count").eq("id", deck.presentationId).single();
    check(saved.data?.design_engine === "generative_v1",
      `the deck says which engine made it (${saved.data?.design_engine ?? "—"})`);
    check(Boolean(saved.data?.design_dna?.fonts), "and the visual language it was made in");

    const savedSlides = await service.from("slides").select("id,position,quality_score").eq("presentation_id", deck.presentationId).order("position");
    const savedElements = await service.from("slide_elements").select("slide_id,type,x,y,width,height,z_index,style,content").eq("presentation_id", deck.presentationId);
    check((savedSlides.data ?? []).length === titles.length, `every slide was stored (${(savedSlides.data ?? []).length})`);
    check((savedElements.data ?? []).length > 0, `elements were stored (${(savedElements.data ?? []).length})`);

    // The apps store a 1000-wide model; anything outside it draws off-screen.
    const outside = (savedElements.data ?? []).filter((row) =>
      row.x < -1 || row.y < -1 || row.x + row.width > 1001 || row.y + row.height > 564);
    check(outside.length === 0, `nothing is stored outside the canvas the apps draw (${outside.length})`);

    const ranks = (savedElements.data ?? []).map((row) => row.z_index);
    check(ranks.every((rank) => Number.isInteger(rank)), "layers were ranked to integers the column can hold");

    // A picture, a scrim over it, and the title over that: the order the
    // renderer needs for text on a photograph to be readable.
    const scrims = (savedElements.data ?? []).filter((row) => row.content?.kind === "scrim");
    for (const scrim of scrims) {
      const onSlide = (savedElements.data ?? []).filter((row) => row.slide_id === scrim.slide_id);
      const image = onSlide.find((row) => row.type === "image");
      const above = onSlide.filter((row) => row.type === "text" && row.z_index > scrim.z_index);
      check(Boolean(image) && image.z_index < scrim.z_index && above.length > 0,
        "a scrim sits over its photograph and under the words");
    }

    const exported = await admin.functions.invoke("export-presentation", {
      body: { presentationId: deck.presentationId, format: "pptx" },
    });
    check(!exported.error, `the deck exports to PowerPoint${exported.error ? ` — ${exported.error.message}` : ""}`);
  }

  console.log(JSON.stringify({
    engine: deck.engine,
    presentation_id: deck.presentationId,
    seconds: Number(seconds),
    average_score: Number(average.toFixed(1)),
    minimum_score: worst,
    unaccepted: deck.observability.unacceptedSlides.length,
    synthesised: deck.observability.synthesisedSlides.length,
    repairs: deck.observability.repairCount,
    model_calls: deck.observability.askCount,
    repeated_compositions: deck.observability.repeatedCompositions.length,
  }));
} finally {
  if (deckId) {
    await service.from("presentations").delete().eq("id", deckId);
  }
  if (userId) {
    await service.from("user_roles").delete().eq("user_id", userId);
    await service.auth.admin.deleteUser(userId);
  }
}

const left = userId ? (await service.auth.admin.getUserById(userId)).data?.user : null;
check(!left, "the temporary administrator was deleted");

console.log(failures ? `\n${failures} scene preview check(s) failed.` : "\nAll scene preview checks passed.");
process.exit(failures ? 1 : 0);
