import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

/**
 * Pictures that arrive without anybody asking for them.
 *
 * The resolver is tested on its own and the Telegram picker is tested on its
 * own, but the thing an author actually experiences is neither: they type a
 * topic, wait, and get a deck with photographs already on the slides. That
 * chain — generation, resolver, download, Storage, `presentation_assets`, the
 * exact element — has never been asserted end to end, and every link in it is
 * one that fails quietly.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node supabase/tests/auto-image-e2e.mjs
 *
 * Five real decks against production, one for each way the answer can go
 * wrong: a historical person, a place, an idea, a living person, and somebody
 * no encyclopaedia has heard of. The last one is the reason the test exists.
 * Everything it creates is deleted, and it proves the deletion.
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

/**
 * Unique per run and letters only.
 *
 * A trailing digit reads as a model number, which makes the intent reader call
 * this a product rather than a person — and then the run would be measuring a
 * refusal it never asked for.
 */
const invented = `Qoraqalpoq Sinovbek${Date.now().toString(36).replace(/\d/g, "x")}`;

const CASES = [
  { key: "A", topic: "Amir Temur va uning davlat boshqaruvi", subject: "Amir Temur", wants: "identity" },
  { key: "B", topic: "Registon maydoni tarixi", subject: "Registon maydoni", wants: "place" },
  { key: "C", topic: "Jamoaviy ishlashning afzalliklari", subject: null, wants: "generic" },
  { key: "D", topic: "Yulduz Usmonova hayoti va ijodi", subject: "Yulduz Usmonova", wants: "identity" },
  { key: "E", topic: `${invented} hayoti va faoliyati`, subject: invented, wants: "nobody" },
];

/** Providers that can only have answered because an identity was established. */
const IDENTITY_SAFE = new Set(["wikidata", "verified"]);
/** Providers that answer from an index of the subject rather than a mood. */
const CONTEXT_SAFE = new Set(["wikidata", "wikimedia", "verified"]);

const email = `auto-image-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
const decks = new Map(CASES.map((entry) => [entry.key, randomUUID()]));
const paths = [];
let userId = "";

async function waitForJob(presentationId, started) {
  let job = null;
  let stage = "";
  let quiet = 0;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const result = await service.from("generation_jobs")
      .select("id, status, stage, error_code, error_message").eq("presentation_id", presentationId).maybeSingle();
    if (result.error) throw result.error;
    job = result.data;
    if (job && job.stage !== stage) { stage = job.stage; quiet = 0; }
    else quiet += 1;
    if (job && job.status !== "running" && job.status !== "queued") break;
    // A stage that stops advancing is a worker that was killed: no code runs,
    // and the row says "running" for ever. Reported as itself.
    if (quiet >= 45) {
      console.log(`  ⚠︎  ${stage} bosqichida ${((Date.now() - started) / 1000).toFixed(0)}s o'zgarish yo'q`);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  return job;
}

try {
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("test user not created");
  userId = created.data.user.id;
  // Photographs are searched only for the paid style, so the account needs
  // credits before it may ask for one.
  const wallet = await service.from("credit_wallets").upsert({ user_id: userId, balance: 200_000 }, { onConflict: "user_id" });
  if (wallet.error) throw wallet.error;
  // Only so the run can ask the resolver directly what it decided about the
  // fabricated name; generation itself needs no role at all.
  await service.from("user_roles").upsert({ user_id: userId, role: "admin" });

  const user = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await user.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  console.log("Avtomatik eshik:");
  const anonymous = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const [who, client] of [["a signed-in app account", user], ["a signed-out client", anonymous]]) {
    const refused = await client.functions.invoke("telegram-image-bot", {
      body: { action: "auto_resolve", ownerId: userId, presentationId: [...decks.values()][0], query: "Amir Temur" },
    });
    let code = null;
    try { code = (await refused.error?.context?.json?.())?.code ?? null; } catch { /* consumed */ }
    check(Boolean(refused.error) && code === "forbidden", `${who} cannot drive the automatic endpoint (${code ?? "allowed"})`);
  }
  // And the one credential that may: the same call the generator makes.
  const internal = await service.functions.invoke("telegram-image-bot", {
    body: { action: "auto_resolve", ownerId: userId, presentationId: [...decks.values()][0], query: "Amir Temur", slideIndex: 0, imageSlot: "hero_image" },
  });
  check(internal.data?.status === "selected" && internal.data?.service === "telegram-image-bot",
    `the server may, and the service names itself (${internal.data?.status ?? internal.error?.message ?? "?"})`);
  check(["wikidata", "verified"].includes(internal.data?.provider),
    `and it answered through the resolver, not a stock library (${internal.data?.provider ?? "—"})`);
  if (internal.data?.path) paths.push(internal.data.path);

  for (const entry of CASES) {
    const presentationId = decks.get(entry.key);
    const started = Date.now();
    console.log(`\n${entry.key}) ${entry.topic}`);

    const generated = await user.functions.invoke("generate-presentation", {
      body: {
        presentationId,
        topic: entry.topic,
        title: entry.subject ?? entry.topic,
        style: "super_professional",
        // A published design with somewhere to put a picture. Left to the
        // generator, the photo path would be exercised one run in ten.
        designSlug: "minimal-kelajak",
        slideCount: 4,
        sources: ["Jaxongirman automatic image E2E"],
        idempotencyKey: `auto-image:${presentationId}`,
      },
    });
    if (generated.error) {
      const detail = typeof generated.error.context?.json === "function" ? await generated.error.context.json() : null;
      throw new Error(detail?.error ?? generated.error.message);
    }

    const job = await waitForJob(presentationId, started);
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    // Nothing about a picture may cost somebody their deck. The name nobody can
    // prove is the case that used to end a run, and is the one that matters.
    check(job?.status === "succeeded",
      `${entry.key}: the deck was generated in ${seconds}s${job?.error_message ? ` — ${job.error_message}` : ` (${job?.stage ?? "?"})`}`);

    const assets = await service.from("presentation_assets")
      .select("provider, storage_bucket, storage_path, metadata")
      .eq("presentation_id", presentationId).eq("kind", "stock");
    if (assets.error) throw assets.error;
    const photos = assets.data ?? [];
    for (const row of photos) if (row.storage_bucket === "stock-images") paths.push(row.storage_path);
    const providers = photos.reduce((tally, row) => {
      tally[row.provider ?? "?"] = (tally[row.provider ?? "?"] ?? 0) + 1;
      return tally;
    }, {});
    console.log(`   ${photos.length} ta rasm · ${Object.entries(providers).map(([name, count]) => `${name}: ${count}`).join(", ") || "—"}`);

    const about = (row) => String(row.metadata?.subject ?? "").toLowerCase();
    const wanted = (entry.subject ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const ofSubject = photos.filter((row) => wanted.length > 0 && wanted.every((part) => about(row).includes(part)));

    if (entry.wants === "identity") {
      check(photos.some((row) => IDENTITY_SAFE.has(row.provider ?? "")),
        `${entry.key}: a picture of the person was placed automatically, through an index that can prove who it is`);
      check(ofSubject.every((row) => IDENTITY_SAFE.has(row.provider ?? "")),
        `${entry.key}: no stock photograph was used as the person`);
    }
    if (entry.wants === "place") {
      check(photos.some((row) => CONTEXT_SAFE.has(row.provider ?? "")),
        `${entry.key}: the place was illustrated from an index of the place itself`);
      check(ofSubject.every((row) => CONTEXT_SAFE.has(row.provider ?? "")),
        `${entry.key}: the place was not filled with a handsome archway that is not it`);
    }
    if (entry.wants === "generic") {
      check(photos.length > 0, `${entry.key}: an idea was illustrated automatically`);
    }
    if (entry.wants === "nobody") {
      // The whole point: no image beats the wrong image. Everything else on
      // this deck may legitimately carry a picture — the person may not.
      check(ofSubject.length === 0, `${entry.key}: nobody else's face was used for a name nothing can prove (${ofSubject.length})`);
      const asked = await user.functions.invoke("image-resolver", { body: { query: invented, mode: "best" } });
      check(asked.data?.status === "no_image" && asked.data?.reason === "identity_unverified",
        `${entry.key}: the resolver says so in as many words (${asked.data?.status ?? "?"}/${asked.data?.reason ?? "?"})`);
    }

    // Every picture, whatever it is of: in the bucket, credited, and pinned to
    // the element that draws it.
    const elements = await service.from("slide_elements")
      .select("slide_id, content").eq("presentation_id", presentationId).eq("type", "image");
    if (elements.error) throw elements.error;
    const drawn = new Map();
    for (const element of elements.data ?? []) {
      const path = element.content?.storagePath;
      if (typeof path === "string") drawn.set(path, { slideId: element.slide_id, slot: element.content?.slot ?? null });
    }

    for (const row of photos) {
      const credit = row.metadata?.attribution ?? {};
      const where = drawn.get(row.storage_path);
      check(Boolean(credit.creator) && Boolean(credit.license) && /^https?:\/\//.test(credit.sourceUrl ?? ""),
        `${entry.key}: ${row.provider} — author, licence and source travelled with the file`);
      check(row.metadata?.resolved_via === "telegram-image-bot",
        `${entry.key}: ${row.provider} — found through the image service (${row.metadata?.resolved_via ?? "—"})`);
      check(row.metadata?.slide_id === where?.slideId && row.metadata?.image_slot === where?.slot && Boolean(where?.slot),
        `${entry.key}: ${row.provider} — pinned to the slide and slot that draws it (${row.metadata?.image_slot ?? "—"})`);
      const bytes = await service.storage.from(row.storage_bucket).download(row.storage_path);
      check(!bytes.error && (bytes.data?.size ?? 0) > 0, `${entry.key}: ${row.provider} — the file is in Storage (${bytes.data?.size ?? 0} b)`);
    }

    const distinct = new Set(photos.map((row) => row.storage_path));
    check(distinct.size === photos.length, `${entry.key}: no picture was stored twice`);
    const subjects = photos.map(about).filter(Boolean);
    check(new Set(subjects).size === subjects.length, `${entry.key}: no subject was illustrated twice in one deck`);

    const ledger = await service.from("credit_transactions").select("type").eq("user_id", userId).eq("job_id", job?.id ?? "");
    const kinds = (ledger.data ?? []).reduce((tally, row) => {
      tally[row.type] = (tally[row.type] ?? 0) + 1;
      return tally;
    }, {});
    check((kinds.reservation ?? 0) === 1 && (kinds.charge ?? 0) <= 1 && (kinds.refund ?? 0) === 0,
      `${entry.key}: charged once and only once (${Object.entries(kinds).map(([name, count]) => `${name}×${count}`).join(", ") || "—"})`);
  }

  console.log("\nTelegram holati:");
  const sessions = await service.from("telegram_image_sessions")
    .select("id", { count: "exact", head: true }).eq("user_id", userId);
  check((sessions.count ?? 0) === 0, `automatic generation opened no Telegram session (${sessions.count ?? 0})`);

  console.log("\nHisob va ish holati:");
  const [after, stuck] = await Promise.all([
    service.from("credit_wallets").select("reserved").eq("user_id", userId).maybeSingle(),
    service.from("generation_jobs").select("id", { count: "exact", head: true }).eq("owner_id", userId).in("status", ["queued", "running"]),
  ]);
  const leaked = Number(after.data?.reserved ?? 0);
  check(leaked === 0, `no credit is left reserved (${leaked})`);
  check((stuck.count ?? 0) === 0, `no job is left running (${stuck.count ?? 0})`);
  console.log(JSON.stringify({ credit_leak: leaked, stuck_jobs: stuck.count ?? 0 }));
} finally {
  await cleanup();
}

async function safe(what, work) {
  try {
    const result = await work();
    if (result?.error) throw result.error;
  } catch (error) {
    console.log(`  ✖ cleanup failed: ${what} (${error.message})`);
    failures += 1;
  }
}

/**
 * The account is what is deleted; the decks come with it.
 *
 * Deleting a presentation on its own is refused — the ledger rows for its
 * generation job are immutable, and that refusal is correct: an audit trail
 * nobody may edit is worth more than a tidy row count. Removing the account
 * takes the whole tree, which is the path a real deletion request would take
 * too. Storage first, because bytes in a bucket are the one thing no cascade
 * reaches.
 */
async function cleanup() {
  if (paths.length > 0) {
    await safe("stock images", () => service.storage.from("stock-images").remove([...new Set(paths)]));
  }
  if (userId) {
    await safe("user_roles", () => service.from("user_roles").delete().eq("user_id", userId));
    await safe("auth user", () => service.auth.admin.deleteUser(userId));
  }
  // Only if something survived the account: a deck with no ledger behind it
  // can still be removed by name.
  const survivors = await service.from("presentations").select("id").in("id", [...decks.values()]);
  for (const row of survivors.data ?? []) {
    await safe(`presentation ${row.id}`, () => service.from("presentations").delete().eq("id", row.id));
  }
}

console.log("\nTozalash:");
const ids = [...decks.values()];
const left = await Promise.all([
  service.from("presentations").select("*", { count: "exact", head: true }).in("id", ids),
  service.from("slides").select("*", { count: "exact", head: true }).in("presentation_id", ids),
  service.from("presentation_assets").select("*", { count: "exact", head: true }).in("presentation_id", ids),
  service.from("generation_jobs").select("*", { count: "exact", head: true }).in("presentation_id", ids),
]);
const rowsLeft = left.reduce((total, result) => total + (result.count ?? 0), 0);
const usersLeft = userId && (await service.auth.admin.getUserById(userId)).data?.user ? 1 : 0;
const objects = await service.storage.from("stock-images").list(`${userId}/${ids[0]}`);
check(usersLeft === 0, `no temporary auth users remain (${usersLeft})`);
check(rowsLeft === 0, `no temporary rows remain (${rowsLeft})`);
check((objects.data ?? []).length === 0, `no temporary Storage objects remain (${(objects.data ?? []).length})`);

console.log(failures ? `\n${failures} automatic-image check(s) failed.` : "\nAll automatic-image checks passed.");
process.exit(failures ? 1 : 0);
