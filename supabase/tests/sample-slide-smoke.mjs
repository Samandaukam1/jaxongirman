import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

/**
 * The sample writer, end to end, against a real project.
 *
 * Everything about this path is already unit-tested except the part that only
 * exists at runtime: that the deployed function can read a published design,
 * that Gemini answers the schema the blueprint generated, and that what comes
 * back fits the boxes it was measured against. Those three cannot be faked —
 * a stub answering a schema I wrote proves the stub obeys me.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node supabase/tests/sample-slide-smoke.mjs
 *
 * The temporary account is made admin because the function is admin-only, and
 * is deleted in a `finally` — including when an assertion throws. It is the
 * narrowest way to exercise the real guard rather than a version of it.
 */

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? readAnon();

function readAnon() {
  try {
    const env = readFileSync(new URL("../../user/.env", import.meta.url), "utf8");
    return env.match(/^EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m)?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

if (!url || !serviceKey || !anonKey) {
  console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and an anon key are required.");
  process.exit(1);
}

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const email = `sample-slide-smoke-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw created.error ?? new Error("Test user was not created");
const userId = created.data.user.id;

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "  ✓" : "  ✖"} ${what}`);
  if (!ok) failures += 1;
};

try {
  const granted = await service.from("user_roles").upsert({ user_id: userId, role: "admin" });
  if (granted.error) throw granted.error;

  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await anon.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  const published = await service
    .from("presentation_designs")
    .select("id, name, compiled_config")
    .eq("status", "published");
  if (published.error) throw published.error;
  if (!published.data?.length) {
    console.log("No published design to sample. Publish one and run again.");
    process.exit(0);
  }

  const read = (row) => (typeof row.compiled_config === "string"
    ? JSON.parse(row.compiled_config)
    : row.compiled_config);

  /**
   * Prefer a blueprint that draws a picture.
   *
   * The photo search is the half of this path that has no unit test — the key
   * and the network are both server-side — so if the project has a design that
   * can exercise it, that is the one worth spending the call on. `DESIGN_ID`
   * and `ARCHETYPE_ID` override, for checking one design in particular.
   */
  const wanted = process.env.DESIGN_ID;
  const rows = wanted ? published.data.filter((row) => row.id === wanted) : published.data;
  let design = null;
  let archetype = null;
  for (const row of rows) {
    const doc = read(row);
    const pick = process.env.ARCHETYPE_ID
      ? doc.archetypes?.find((entry) => entry.id === process.env.ARCHETYPE_ID)
      : doc.archetypes?.find((entry) => entry.selection?.supportsImage);
    if (pick) { design = { data: row }; archetype = pick; break; }
  }
  if (!design) {
    design = { data: rows[0] };
    const doc = read(rows[0]);
    archetype = doc.archetypes?.find((entry) => entry.purpose === "cover") ?? doc.archetypes?.[0];
  }

  console.log(`Design: ${design.data.name} · blueprint ${archetype?.id}`);

  const started = Date.now();
  const { data, error } = await anon.functions.invoke("sample-slide", {
    body: {
      designId: design.data.id,
      archetypeId: archetype?.id,
      topic: "Suv resurslarini tejash",
      language: "uz",
    },
  });
  if (error) {
    const detail = typeof error.context?.json === "function" ? await error.context.json() : null;
    throw new Error(detail?.error ?? error.message);
  }
  console.log(`Answered in ${((Date.now() - started) / 1000).toFixed(1)}s by ${data.writer?.model ?? "?"}`);

  check(data.slide !== null, "a slide came back");

  /**
   * A title only when the blueprint draws one.
   *
   * Not every page has one: the design this ran against first is a body page
   * with three parallel columns and no heading at all, and asserting a title
   * there reports the writer as broken for correctly leaving empty a slot that
   * does not exist.
   */
  const wantsTitle = (archetype?.elements ?? []).some((element) =>
    ["title", "chart_title", "table_title"].includes(element.source?.bind));
  if (wantsTitle) check(Boolean(data.slide?.title), "the title was written");
  else console.log("  · this blueprint has no title slot");
  check(data.slide?.purpose === archetype?.purpose, "the slide is for the blueprint that was asked for");
  check(Array.isArray(data.outcomes) && data.outcomes.length > 0, "every filled slot is reported");

  /**
   * The one assertion that is the whole point.
   *
   * A slot the model overflowed is reported and trimmed, never silently kept.
   * If this passes with overflows present, the design has a box too small for
   * what it is for — which is a finding about the design, not a failed test.
   */
  const trimmed = (data.outcomes ?? []).filter((outcome) => !outcome.fits);
  check(trimmed.every((outcome) => typeof outcome.trimmedFrom === "number"),
    "anything that did not fit says how much was cut");
  if (trimmed.length) {
    console.log(`  · ${trimmed.length} slot(s) overflowed and were trimmed: ${trimmed.map((o) => o.binding).join(", ")}`);
  }

  for (const outcome of data.outcomes ?? []) {
    const text = Array.isArray(outcome.text) ? outcome.text.join(" ") : outcome.text;
    check(typeof text === "string" && text.length > 0, `${outcome.binding} has text`);
  }

  // Geometry is the design's. A model that returned any is a model that was
  // given a chance to, which is the failure this whole split exists to prevent.
  const leaked = JSON.stringify(data.slide ?? {}).match(/"(x|y|width|height|fontSize|zIndex)":/);
  check(!leaked, "the answer carries no geometry");

  if (data.imageQuery) {
    console.log(`  · image query: ${data.imageQuery}${data.photo ? ` → ${data.photoSource}` : " → no photo"}`);
    if (data.photo) {
      /**
       * Which index answered, through the shared search.
       *
       * This is the same `searchStock` a customer's deck calls, so a photograph
       * arriving here from Unsplash is the whole provider order working
       * server-side: the key read, the ladder walked, the credit kept.
       */
      check(["unsplash", "openverse"].includes(data.photoSource), `the provider is named (${data.photoSource})`);
      check(Boolean(data.photo.attribution?.creator), `the photographer is recorded (${data.photo.attribution?.creator})`);
      check(/^https?:\/\//.test(data.photo.attribution?.sourceUrl ?? ""), "a link back is recorded");
    }
  }

  const denied = await service.from("user_roles").delete().eq("user_id", userId);
  if (denied.error) throw denied.error;
  const again = await anon.functions.invoke("sample-slide", {
    body: { designId: design.data.id, topic: "Suv resurslarini tejash", language: "uz" },
  });
  check(Boolean(again.error), "a caller who is not an admin is refused");
} finally {
  await service.from("user_roles").delete().eq("user_id", userId);
  await service.auth.admin.deleteUser(userId);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
