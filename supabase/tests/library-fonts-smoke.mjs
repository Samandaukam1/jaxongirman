import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

/**
 * A design that names a Google family gets it, without anybody uploading a file.
 *
 * Two thousand families are on the shelf, so naming one in a prompt should be
 * the whole of choosing a font. This checks the part that only exists at
 * runtime: that the resolver finds the imported family rather than going back
 * to Google, that the faces land under the design, and — the reason this test
 * exists — that resolving does not rewrite the library's own record of what the
 * family is called.
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

const { buildJslayd } = await import("../../packages/jslayd/tests/build.mjs");
const dir = buildJslayd();
const { compile } = await import(`${dir}/compile.js`);
const { SAMPLE_PROMPT } = await import(`${dir}/standard.js`);
const { readDocument } = await import(`${dir}/serialize.js`);

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "  ✓" : "  ✖"} ${what}`);
  if (!ok) failures += 1;
};

/**
 * Point the sample's first font at the family under test, whatever it is called.
 *
 * Anchored to the `[FONTS]` block rather than to a font name, so the standard
 * can change its example without this quietly testing something else.
 */
function rename(prompt) {
  const at = prompt.indexOf("[FONTS]");
  if (at === -1) throw new Error("the standard has no [FONTS] block");
  const head = prompt.slice(0, at);
  const tail = prompt.slice(at).replace(/^(\s*)name: .*$/m, `$1name: ${NORMALIZED}`);
  return `${head}${tail}`
    .replace(/^name: .*$/m, "name: Library font smoke")
    .replace(/^slug: .*$/m, `slug: ${slug}`);
}

/** A family the import brought in, named in a case no design would use. */
const FAMILY = "Montserrat";
const NORMALIZED = "montserrat";

const before = await service.from("font_families")
  .select("id, canonical_name, source").eq("normalized_name", NORMALIZED).maybeSingle();
if (!before.data) {
  console.log(`${FAMILY} is not in the library; run the importer first.`);
  process.exit(0);
}

const email = `library-font-smoke-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw created.error ?? new Error("Test user was not created");
const userId = created.data.user.id;

const slug = `library-font-smoke-${Date.now().toString(36)}`;
let designId = null;

try {
  await service.from("user_roles").upsert({ user_id: userId, role: "admin" });
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await anon.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  /**
   * Compiled from a real prompt rather than hand-built.
   *
   * A JSON object shaped like a document is not a document — the resolver reads
   * it through the same reader the rest of the system uses, and a hand-written
   * one fails that read for reasons that have nothing to do with fonts.
   *
   * The family is named in lower case on purpose: that is the spelling that
   * used to rename the library's copy for every screen that reads it.
   */
  const { document, diagnostics } = compile(rename(SAMPLE_PROMPT));
  if (!document) throw new Error(`prompt did not compile: ${diagnostics.errors.map((e) => e.message).join(" | ")}`);

  /**
   * The rename has to have happened, or this test proves nothing.
   *
   * It used to match the sample's font by its literal name. When the standard's
   * example changed font, the replace silently stopped matching, the design
   * resolved a family nobody was testing, and every check still passed —
   * including the one about not renaming Montserrat, which by then never went
   * near Montserrat.
   */
  if (document.fonts[0]?.name !== NORMALIZED) {
    throw new Error(`the fixture did not rename font_1 (got "${document.fonts[0]?.name}")`);
  }

  const made = await service.from("presentation_designs")
    .insert({ slug, name: "Library font smoke", tier: "simple", status: "draft", compiled_config: document, created_by: userId })
    .select("id").single();
  if (made.error) throw made.error;
  designId = made.data.id;

  const { data, error } = await anon.functions.invoke("resolve-design-fonts", { body: { designId } });
  if (error) {
    const detail = typeof error.context?.json === "function" ? await error.context.json() : null;
    throw new Error(detail?.error ?? error.message);
  }

  const report = data.fonts ?? data.report ?? [];
  const entry = Array.isArray(report) ? report.find((row) => row.font === "font_1") : null;
  check(Boolean(entry), "the resolver reported on the declared font");
  check(entry?.source === "library", `it came from the library, not Google (source: ${entry?.source})`);
  check((entry?.faces ?? 0) > 0, `faces were attached (${entry?.faces})`);

  const attached = await service.from("presentation_design_fonts").select("font_id, asset_path").eq("design_id", designId);
  check((attached.data ?? []).length > 0, "the design now carries the faces");

  /**
   * The design is still readable afterwards.
   *
   * The resolver rewrites `compiled_config`, and it used to write the full
   * object key into each font face. `readDocument` refuses any asset carrying
   * a path separator — the rule that stops an imported file naming
   * `../../secret.ttf` — so attaching fonts from the library made the design
   * unreadable to everything that reads one. It surfaced as the sample writer
   * saying "Dizayn hujjati o'qilmadi" about a design that had just been saved.
   */
  const saved = await service.from("presentation_designs")
    .select("compiled_config").eq("id", designId).single();
  const reread = readDocument(saved.data.compiled_config);
  check(Boolean(reread.document),
    `the design still reads after resolving${reread.document ? "" : `: ${reread.diagnostics.errors.map((e) => e.message).join(" | ")}`}`);

  for (const font of reread.document?.fonts ?? []) {
    for (const face of font.faces ?? []) {
      check(!/[\\/]/.test(face.asset), `${font.id} stores a bare file name (${face.asset})`);
    }
  }

  /**
   * The assertion this whole test is for.
   *
   * The resolver used to upsert the family row, which on conflict rewrote
   * `canonical_name` — so a prompt saying "montserrat" renamed Montserrat in
   * the library, and the user's font picker showed the lower-case spelling
   * from then on.
   */
  const after = await service.from("font_families")
    .select("canonical_name, source").eq("normalized_name", NORMALIZED).maybeSingle();
  check(after.data?.canonical_name === before.data.canonical_name,
    `the library still calls it "${before.data.canonical_name}" (now "${after.data?.canonical_name}")`);
  check(after.data?.source === before.data.source,
    `the library's source is unchanged (${before.data.source} → ${after.data?.source})`);

  /**
   * The standard's own example resolves, unchanged.
   *
   * Every new design starts from this text, so a font named in it that the
   * library does not hold means the default experience is a design drawn in
   * the fallback — working, and in nobody's chosen typeface. The sample used
   * to name "Apelsen Display", which exists nowhere.
   */
  const sample = compile(SAMPLE_PROMPT).document;
  const names = sample.fonts.map((font) => font.name);
  const normalized = names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const held = await service.from("font_families")
    .select("normalized_name").in("normalized_name", normalized);
  const have = new Set((held.data ?? []).map((row) => row.normalized_name));

  for (const [at, name] of names.entries()) {
    check(have.has(normalized[at]), `the standard's example font "${name}" is in the library`);
  }
} finally {
  if (designId) {
    await service.from("presentation_design_fonts").delete().eq("design_id", designId);
    await service.from("presentation_designs").delete().eq("id", designId);
    await service.storage.from("design-fonts").remove([`${slug}/font_1-400.ttf`]).catch(() => {});
  }
  await service.from("user_roles").delete().eq("user_id", userId);
  await service.auth.admin.deleteUser(userId);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
