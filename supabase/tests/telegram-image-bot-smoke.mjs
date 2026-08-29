import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

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
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function invoke(client, body) {
  const result = await client.functions.invoke("telegram-image-bot", { body });
  if (!result.error) return result.data;
  let detail = null;
  try { detail = await result.error.context?.json?.(); } catch { /* response already consumed */ }
  const error = new Error(detail?.error ?? result.error.message);
  error.code = detail?.code;
  throw error;
}

async function resolver(client, query) {
  const result = await client.functions.invoke("image-resolver", {
    body: { query, mode: "candidates", limit: 6, orientation: "landscape" },
  });
  if (result.error) throw result.error;
  return result.data;
}

const email = `telegram-e2e-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
const outsiderEmail = `telegram-outsider-${randomUUID()}@example.test`;
const presentationId = randomUUID();
const slideId = randomUUID();
const targetId = randomUUID();
const controlId = randomUUID();
const paths = [];
const tokenHashes = [];
const sessionIds = [];
const claimedUpdateIds = [];
const fakeCandidate = "CrossUserCandidate01";
let userId = "";
let outsiderId = "";

// A real, decodable 1×1 PNG is sufficient for the pre-existing slot value.
const oldPng = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

try {
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("test user not created");
  userId = created.data.user.id;
  const outsider = await service.auth.admin.createUser({ email: outsiderEmail, password, email_confirm: true });
  if (outsider.error || !outsider.data.user) throw outsider.error ?? new Error("outsider not created");
  outsiderId = outsider.data.user.id;

  await service.from("user_roles").upsert({ user_id: userId, role: "admin" });
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const outsiderClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const outsiderSigned = await outsiderClient.auth.signInWithPassword({ email: outsiderEmail, password });
  if (outsiderSigned.error) throw outsiderSigned.error;

  const presentation = await service.from("presentations").insert({
    id: presentationId,
    owner_id: userId,
    title: "Telegram Image Bot E2E",
    topic: "Jamoaviy ishlashning afzalliklari",
    style: "simple",
    status: "ready",
    requested_slide_count: 1,
    generated_slide_count: 1,
  });
  if (presentation.error) throw presentation.error;
  const slide = await service.from("slides").insert({
    id: slideId,
    presentation_id: presentationId,
    owner_id: userId,
    position: 0,
    title: "Jamoaviy ishlashning afzalliklari",
    layout: "image_text",
    background: { color: "#ffffff" },
  });
  if (slide.error) throw slide.error;

  const initialPath = `${userId}/${presentationId}/${slideId}/before.png`;
  paths.push(initialPath);
  const upload = await service.storage.from("presentation-assets").upload(initialPath, oldPng, { contentType: "image/png" });
  if (upload.error) throw upload.error;
  const oldAsset = await service.from("presentation_assets").insert({
    presentation_id: presentationId,
    owner_id: userId,
    kind: "upload",
    storage_bucket: "presentation-assets",
    storage_path: initialPath,
    mime_type: "image/png",
    byte_size: oldPng.byteLength,
    width: 1,
    height: 1,
    metadata: { slide_index: 0, image_slot: "hero_image", source: "e2e_before" },
  });
  if (oldAsset.error) throw oldAsset.error;
  const elements = await service.from("slide_elements").insert([
    {
      id: targetId, slide_id: slideId, presentation_id: presentationId, owner_id: userId,
      type: "image", x: 40, y: 40, width: 560, height: 420, z_index: 1,
      style: { objectFit: "cover" },
      content: { kind: "image", slot: "hero_image", storageBucket: "presentation-assets", storagePath: initialPath },
    },
    {
      id: controlId, slide_id: slideId, presentation_id: presentationId, owner_id: userId,
      type: "image", x: 650, y: 40, width: 300, height: 220, z_index: 2,
      style: { objectFit: "cover" },
      content: { kind: "image", slot: "secondary_image", url: "https://example.test/control.png" },
    },
  ]);
  if (elements.error) throw elements.error;

  const beforeWallet = await service.from("credit_wallets").select("balance,reserved").eq("user_id", userId).maybeSingle();
  const beforeCredits = await service.from("credit_transactions").select("id", { count: "exact", head: true }).eq("user_id", userId);
  const beforeVerified = await service.from("verified_images").select("id", { count: "exact", head: true });
  const controlBefore = await service.from("slide_elements").select("content").eq("id", controlId).single();

  console.log("ImageResolver majburiy holatlari:");
  const generic = await resolver(client, "Jamoaviy ishlashning afzalliklari");
  check(generic.intent === "generic_concept", `generic concept classified (${generic.intent})`);
  check((generic.candidates ?? []).length > 0, `generic candidates exist (${generic.candidates?.length ?? 0})`);

  const place = await resolver(client, "Registon maydoni");
  check(place.intent === "specific_place", `Registon is a specific place (${place.intent})`);
  check((place.candidates ?? []).length > 0, `Registon has candidates (${place.candidates?.length ?? 0})`);
  check((place.candidates ?? []).every((item) => item.provider !== "unsplash"), "Registon does not use a random stock result");

  const historical = await resolver(client, "Amir Temur");
  check(historical.intent === "exact_person", `Amir Temur is identity-critical (${historical.intent})`);
  check((historical.candidates ?? []).every((item) => ["wikidata", "verified"].includes(item.provider)), "Amir Temur candidates are identity-safe");

  const singer = await resolver(client, "Yulduz Usmonova");
  check(singer.intent === "exact_person", `Yulduz Usmonova is identity-critical (${singer.intent})`);
  check((singer.candidates ?? []).every((item) => ["wikidata", "verified"].includes(item.provider)), "Yulduz Usmonova candidates are identity-safe");

  // Keep the synthetic subject name-shaped. A numeric suffix intentionally
  // means a product model to the deterministic intent reader.
  const inventedSuffix = Date.now().toString(36).replace(/\d/g, "x");
  const inventedName = `Qoraqalpoq Sinovbek${inventedSuffix}`;
  check(!/\d/.test(inventedName), "the fabricated name carries no digit a product rule could catch");
  const invented = await resolver(client, inventedName);
  check(invented.intent === "exact_person", `invented local name remains exact person (${invented.intent})`);
  check((invented.candidates ?? []).length === 0, "invented local name gets NO IMAGE");

  console.log("\nProduction session → selection → exact slot:");
  const opened = await invoke(client, {
    action: "create_session",
    presentationId,
    slideId,
    imageElementId: targetId,
    initialQuery: null,
  });
  const token = new URL(opened.deepLink).searchParams.get("start");
  tokenHashes.push(digest(token));
  check(opened.deepLink.startsWith("https://t.me/JaxongirmanAppImagesBot?start="), "deep link targets the production bot");
  check(Boolean(token) && !opened.deepLink.includes(presentationId) && !opened.deepLink.includes(slideId), "deep link contains only an opaque capability");
  const stored = await service.from("telegram_image_sessions").select("token_hash,status,image_slot").eq("token_hash", digest(token)).single();
  check(stored.data?.token_hash === digest(token) && stored.data?.token_hash !== token, "database stores only the token hash");

  const completed = await invoke(client, {
    action: "complete_session",
    token,
    query: "Jamoaviy ishlashning afzalliklari",
  });
  check(completed.ok === true, "backend selection completed");

  const [targetAfter, controlAfter, assetAfter, sessionAfter] = await Promise.all([
    service.from("slide_elements").select("content").eq("id", targetId).single(),
    service.from("slide_elements").select("content").eq("id", controlId).single(),
    service.from("presentation_assets").select("id,storage_bucket,storage_path,provider,source_url,license_name,license_url,attribution,width,height,metadata").eq("presentation_id", presentationId).eq("metadata->>source", "telegram").single(),
    service.from("telegram_image_sessions").select("status,consumed_at").eq("token_hash", digest(token)).single(),
  ]);
  const content = targetAfter.data?.content ?? {};
  const newPath = content.storagePath;
  if (typeof newPath === "string") paths.push(newPath);
  check(content.storageBucket === "presentation-assets" && typeof newPath === "string" && newPath !== initialPath, "target element points at the copied Storage asset");
  check(JSON.stringify(controlAfter.data?.content) === JSON.stringify(controlBefore.data?.content), "the other image slot did not change");
  check(assetAfter.data?.storage_path === newPath, "presentation_assets and the exact slot share one storage path");
  check(assetAfter.data?.metadata?.image_slot === "hero_image" && assetAfter.data?.metadata?.slide_id === slideId, "asset metadata pins slide and image slot");
  check(Boolean(assetAfter.data?.attribution) && Boolean(assetAfter.data?.license_name) && Boolean(assetAfter.data?.source_url), "attribution, licence and source are retained");
  check(sessionAfter.data?.status === "consumed" && Boolean(sessionAfter.data?.consumed_at), "one-time session is consumed");
  const storedObject = await service.storage.from("presentation-assets").download(newPath);
  check(!storedObject.error && (storedObject.data?.size ?? 0) > 0, "selected bytes exist in private Storage");
  const rendered = await service.storage.from("presentation-assets").createSignedUrl(newPath, 60);
  check(Boolean(rendered.data?.signedUrl), "renderer can resolve the new private asset URL");

  let duplicateRejected = false;
  try { await invoke(client, { action: "complete_session", token, query: "Jamoaviy ishlashning afzalliklari" }); }
  catch { duplicateRejected = true; }
  const telegramAssets = await service.from("presentation_assets").select("id", { count: "exact", head: true }).eq("presentation_id", presentationId).eq("metadata->>source", "telegram");
  check(duplicateRejected && telegramAssets.count === 1, "same callback/session can mutate only once");

  const expiredOpen = await invoke(client, { action: "create_session", presentationId, slideId, imageElementId: targetId, initialQuery: null });
  const expiredToken = new URL(expiredOpen.deepLink).searchParams.get("start");
  tokenHashes.push(digest(expiredToken));
  await service.from("telegram_image_sessions").update({ expires_at: new Date(Date.now() - 1_000).toISOString() }).eq("token_hash", digest(expiredToken));
  let expiredRejected = false;
  try { await invoke(client, { action: "complete_session", token: expiredToken, query: "Registon maydoni" }); }
  catch { expiredRejected = true; }
  check(expiredRejected, "expired session selection is rejected");

  const crossOpen = await invoke(client, { action: "create_session", presentationId, slideId, imageElementId: targetId, initialQuery: null });
  const crossToken = new URL(crossOpen.deepLink).searchParams.get("start");
  tokenHashes.push(digest(crossToken));
  let ownerRejected = false;
  try { await invoke(outsiderClient, { action: "complete_session", token: crossToken, query: "Registon maydoni" }); }
  catch { ownerRejected = true; }
  check(ownerRejected, "another app account cannot consume the deep link");

  const bound = await service.rpc("bind_telegram_image_session", {
    p_token_hash: digest(crossToken), p_telegram_user_id: 111111, p_telegram_chat_id: 111111,
  });
  if (bound.error) throw bound.error;
  sessionIds.push(bound.data.id);
  await service.from("telegram_image_candidates").insert({
    opaque_id: fakeCandidate,
    session_id: bound.data.id,
    provider: "wikimedia",
    download_url: "https://upload.wikimedia.org/example.jpg",
    original_url: "https://commons.wikimedia.org/example",
    attribution: { title: "test", creator: "test", license: "CC", sourceUrl: "https://commons.wikimedia.org/example" },
  });
  const crossRpc = await service.rpc("commit_telegram_image_selection", {
    p_session_id: bound.data.id, p_candidate_id: fakeCandidate, p_telegram_user_id: 222222,
    p_storage_bucket: "presentation-assets", p_storage_path: `${userId}/${presentationId}/${slideId}/never-written.jpg`,
    p_mime_type: "image/jpeg", p_byte_size: 100, p_width: 100, p_height: 100,
  });
  check(Boolean(crossRpc.error), "another Telegram account callback is rejected");

  const updateId = Number(String(Date.now()).slice(-12));
  claimedUpdateIds.push(updateId);
  const firstClaim = await service.rpc("claim_telegram_image_update", { p_update_id: updateId });
  const secondClaim = await service.rpc("claim_telegram_image_update", { p_update_id: updateId });
  check(firstClaim.data === true && secondClaim.data === false, "duplicate Telegram update_id is claimed once");

  const [afterWallet, afterCredits, afterVerified, stuck] = await Promise.all([
    service.from("credit_wallets").select("balance,reserved").eq("user_id", userId).maybeSingle(),
    service.from("credit_transactions").select("id", { count: "exact", head: true }).eq("user_id", userId),
    service.from("verified_images").select("id", { count: "exact", head: true }),
    service.from("generation_jobs").select("id", { count: "exact", head: true }).eq("owner_id", userId).in("status", ["queued", "running"]),
  ]);
  check(JSON.stringify(afterWallet.data) === JSON.stringify(beforeWallet.data) && afterCredits.count === beforeCredits.count, "Telegram selection creates no credit charge or reservation");
  check(afterVerified.count === beforeVerified.count, "ordinary Telegram selection never writes verified_images");
  check(stuck.count === 0, "test owner has no stuck generation jobs");

  console.log(JSON.stringify({
    credit_leak: (afterCredits.count ?? 0) - (beforeCredits.count ?? 0),
    stuck_jobs: stuck.count ?? 0,
    telegram_assets: telegramAssets.count ?? 0,
    exact_slot: assetAfter.data?.metadata?.image_slot ?? null,
  }));
} finally {
  await cleanup();
}

// A smoke test that runs against production and leaves rows behind is not a
// smoke test, it is a slow leak. Every deletion is by an identifier this run
// made, and each one runs whatever happened to the one before it.
async function safe(what, work) {
  try {
    const result = await work();
    if (result?.error) throw result.error;
  } catch (error) {
    console.log(`  \u2716 cleanup failed: ${what} (${error.message})`);
    failures += 1;
  }
}

async function cleanup() {
  await safe("telegram sessions are looked up", async () => {
    if (tokenHashes.length === 0) return null;
    const found = await service.from("telegram_image_sessions").select("id").in("token_hash", tokenHashes);
    for (const row of found.data ?? []) if (!sessionIds.includes(row.id)) sessionIds.push(row.id);
    return found;
  });
  if (sessionIds.length > 0) {
    await safe("telegram_image_candidates", () => service.from("telegram_image_candidates").delete().in("session_id", sessionIds));
    await safe("telegram_image_sessions", () => service.from("telegram_image_sessions").delete().in("id", sessionIds));
  }
  await safe("planted candidate", () => service.from("telegram_image_candidates").delete().eq("opaque_id", fakeCandidate));
  if (claimedUpdateIds.length > 0) {
    await safe("telegram_image_updates", () => service.from("telegram_image_updates").delete().in("update_id", claimedUpdateIds));
  }
  if (paths.length > 0) {
    await safe("storage objects", () => service.storage.from("presentation-assets").remove([...new Set(paths)]));
  }
  await safe("presentation_assets", () => service.from("presentation_assets").delete().eq("presentation_id", presentationId));
  await safe("slide_elements", () => service.from("slide_elements").delete().eq("presentation_id", presentationId));
  await safe("slides", () => service.from("slides").delete().eq("presentation_id", presentationId));
  await safe("presentation", () => service.from("presentations").delete().eq("id", presentationId));
  for (const id of [userId, outsiderId].filter(Boolean)) {
    await safe("user_roles", () => service.from("user_roles").delete().eq("user_id", id));
    await safe("auth user", () => service.auth.admin.deleteUser(id));
  }
}

async function countRows(table, column, values) {
  if (values.length === 0) return 0;
  const result = await service.from(table).select("*", { count: "exact", head: true }).in(column, values);
  if (result.error) throw result.error;
  return result.count ?? 0;
}

console.log("\nTozalash:");
let usersLeft = 0;
for (const id of [userId, outsiderId].filter(Boolean)) {
  const found = await service.auth.admin.getUserById(id);
  if (found.data?.user) usersLeft += 1;
}
const rowsLeft = (await Promise.all([
  countRows("presentations", "id", [presentationId]),
  countRows("slides", "presentation_id", [presentationId]),
  countRows("slide_elements", "presentation_id", [presentationId]),
  countRows("presentation_assets", "presentation_id", [presentationId]),
  countRows("telegram_image_sessions", "token_hash", tokenHashes),
  countRows("telegram_image_candidates", "session_id", sessionIds),
  countRows("telegram_image_candidates", "opaque_id", [fakeCandidate]),
  countRows("telegram_image_updates", "update_id", claimedUpdateIds),
  countRows("user_roles", "user_id", [userId, outsiderId].filter(Boolean)),
])).reduce((total, count) => total + count, 0);
const listed = await service.storage.from("presentation-assets").list(`${userId}/${presentationId}/${slideId}`);
const objectsLeft = (listed.data ?? []).length;
check(usersLeft === 0, `no temporary auth users remain (${usersLeft})`);
check(rowsLeft === 0, `no temporary rows remain (${rowsLeft})`);
check(objectsLeft === 0, `no temporary Storage objects remain (${objectsLeft})`);

console.log(JSON.stringify({ users_left: usersLeft, rows_left: rowsLeft, storage_left: objectsLeft }));
console.log(failures ? `\n${failures} Telegram production check(s) failed.` : "\nAll Telegram production checks passed.");
process.exit(failures ? 1 : 0);
