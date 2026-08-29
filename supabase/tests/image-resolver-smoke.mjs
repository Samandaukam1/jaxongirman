import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

/**
 * The resolver, against the real project.
 *
 * The routing rules are unit-tested next door against fakes, which proves the
 * rules. This proves the deployment: that the endpoint is reachable, that a
 * confirmed picture short-circuits the search, and — the one that matters —
 * that a person nobody can verify comes back with no picture rather than a
 * stranger's face.
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

const email = `resolver-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw created.error ?? new Error("Test user was not created");
const userId = created.data.user.id;

/**
 * A subject nobody has ever confirmed, so the cache test starts empty.
 *
 * Two words, because the cache key is the *named subject* rather than the raw
 * query — the resolver strips the scene words before looking anything up, and
 * a key built from the whole string would never be found again.
 */
const invented = `Qoraqalpoq Sinovbek${Date.now().toString(36)}`;
let normalized = "";

try {
  await service.from("user_roles").upsert({ user_id: userId, role: "admin" });
  const admin = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await admin.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  const resolve = async (body) => {
    const { data, error } = await admin.functions.invoke("image-resolver", { body });
    if (error) {
      const detail = typeof error.context?.json === "function" ? await error.context.json() : null;
      throw new Error(detail?.error ?? error.message);
    }
    return data;
  };

  /* ------------------------------------------------------------- routing */

  console.log("Intent va yo‘naltirish:");
  const generic = await resolve({ query: "modern business office", mode: "best" });
  check(generic.intent === "generic_concept", `an idea is generic (${generic.intent})`);
  check(generic.provider === "unsplash", `and goes to the stock library (${generic.provider})`);

  const historical = await resolve({ query: "Amir Temur", mode: "best" });
  check(historical.intent === "exact_person", `a historical figure is a person (${historical.intent})`);
  check(historical.provider === "wikidata", `proved through the encyclopaedia (${historical.provider})`);
  check(historical.confidence >= 0.9, `with high confidence (${historical.confidence})`);

  const place = await resolve({ query: "Registon maydoni", mode: "best" });
  check(place.intent === "specific_place", `a square is a place (${place.intent})`);
  check(place.status === "found", `and gets a picture (${place.provider ?? "none"})`);

  /* ------------------------------------------- the rule that matters most */

  console.log("\nNoto‘g‘ri odam oldini olish:");
  const unknown = await resolve({ query: invented, mode: "best" });
  // The resolver's own key, so the confirmation below is filed where the next
  // lookup will actually look.
  normalized = unknown.normalized;
  check(unknown.intent === "exact_person", "an unknown name still reads as a person");
  check(unknown.status === "no_image", `and gets no picture (${unknown.status})`);
  check(unknown.reason === "identity_unverified", `for a reason that says so (${unknown.reason})`);
  check(unknown.hit === null, "with nothing attached that a caller could use anyway");

  const offered = await resolve({ query: invented, mode: "candidates" });
  check((offered.candidates ?? []).length === 0, "and nothing is offered for confirmation either");
  check(Boolean(offered.note), "with a note saying it needs a person to confirm one");

  /* ------------------------------------------------------- the library */

  console.log("\nTasdiqlangan kutubxona:");
  // Called as the administrator, not as the service role: the function checks
  // `auth.uid()`, and the service role has none — which is the point of it.
  const verified = await admin.rpc("verify_image", {
    p_normalized_entity: normalized,
    p_display_name: invented,
    p_entity_type: "exact_person",
    p_storage_path: "verified/test-portrait.jpg",
    p_provider: "manual",
    p_source_url: "https://example.test/profile",
    p_creator: "Sinov Muallif",
    p_license: "All rights reserved",
  });
  check(!verified.error, `an administrator can confirm a picture${verified.error ? `: ${verified.error.message}` : ""}`);

  const cached = await resolve({ query: invented, mode: "best" });
  check(cached.status === "verified", `the same name now answers from memory (${cached.status})`);
  check(cached.provider === "verified", "without asking any provider");
  check(cached.storagePath === "verified/test-portrait.jpg", "and points at the confirmed file");
  check(cached.confidence === 1, "with full confidence");

  /* -------------------------------------------------------------- rights */

  console.log("\nHuquq va xavfsizlik:");
  const row = await service.from("verified_images").select("creator, license, source_url").eq("normalized_entity", normalized).maybeSingle();
  check(row.data?.creator === "Sinov Muallif", "the creator is kept");
  check(row.data?.license === "All rights reserved", "the licence is kept, whatever it says");
  check(Boolean(row.data?.source_url), "and the page it came from");

  // A confirmation is an assertion about a real person. It must not be
  // settable by whoever asks.
  const stranger = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const outsider = await stranger.from("verified_images").insert({
    normalized_entity: "hacker", display_name: "x", entity_type: "exact_person",
    image_storage_path: "x", provider: "x",
  });
  check(Boolean(outsider.error), "a signed-out client cannot write a confirmation");
} finally {
  await service.from("verified_images").delete().eq("normalized_entity", normalized);
  await service.from("user_roles").delete().eq("user_id", userId);
  await service.auth.admin.deleteUser(userId);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
