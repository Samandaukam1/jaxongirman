import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

/**
 * The acceptance scenario, end to end, against a real database.
 *
 * An admin copies the standard prompt, a model returns a specification, the
 * admin pastes it, the system validates it, the family is published, its accent
 * is changed, and the planner finds an element by a word nobody put in its
 * name. That is the whole product claim, so it is checked rather than described.
 *
 *   npm run test:jelement:smoke
 *
 * Runs against the local stack and cleans up after itself.
 */

const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" }));
const url = status.API_URL;
const serviceKey = status.SERVICE_ROLE_KEY;
const anonKey = status.ANON_KEY;

const service = createClient(url, serviceKey, { auth: { persistSession: false } });

/** Compiled from the package the admin page uses, so this is the real reader. */
const { compile, ANALYZER_PROMPT } = await import("../../packages/jelement/src/index.ts")
  .catch(async () => {
    // Node cannot import TypeScript; compile it the way the unit tests do.
    const { buildJelement } = await import("./helpers/build-jelement.mjs");
    return import(`${buildJelement()}/index.js`);
  });

const SPEC = `JELEMENT-FAMILY 1.0

[FAMILY]
name: Smoke Mining
slug: smoke-mining-${Date.now().toString(36)}
category: Mining
style: Industrial CGI
description: Smoke test family.

[COLOR_TOKENS]
primary: #101214
accent: #A7FF00
glass: #1B2728

[VISUAL_DNA]
material: matte graphite
lighting: soft top-left
detailDensity: 6

[SEARCH]
keywords: kon, mining

[ELEMENT 01]
canonicalName: mining haul truck
displayName: Kon yuk mashinasi
objectClass: vehicle
semantic:
  aliases: haul truck, dump truck
  uzbekTerms: kon yuk mashinasi, karer samosvali
  concepts: ore transportation
  contexts: open pit
geometry:
  components:
    body:
      shape: roundedRect
      box: 0.1 0.3 0.8 0.4
      fill: {{primary}}
    trim:
      shape: rect
      box: 0.1 0.68 0.8 0.04
      fill: {{accent}}
    window:
      shape: rect
      box: 0.6 0.34 0.2 0.14
      fill: {{glass}}
      recolorable: false
usage:
  slideRoles: hero, section
  visualWeight: 8

[ELEMENT 02]
canonicalName: survey total station
displayName: Geodezik asbob
objectClass: device
semantic:
  uzbekTerms: geodezik asbob
  concepts: site survey, measurement
geometry:
  components:
    body:
      shape: rect
      box: 0.3 0.2 0.4 0.4
      fill: {{primary}}
usage:
  slideRoles: explanation
`;

let familyId = null;
let adminId = null;

async function main() {
  console.log("The standard prompt is what an admin copies…");
  assert.ok(ANALYZER_PROMPT.includes("JELEMENT-FAMILY 1.0"), "the prompt names the format");
  assert.ok(ANALYZER_PROMPT.length > 3000, "and is a real specification, not a sentence");

  console.log("Reading what the model returned…");
  const { family, diagnostics } = compile(SPEC);
  assert.deepEqual(diagnostics.errors, [], `the spec must compile:\n${diagnostics.errors.map((e) => e.message).join("\n")}`);
  assert.equal(family.elements.length, 2);

  // An admin, because the library is written by admins and by nobody else.
  const email = `jelement-smoke-${Date.now()}@example.com`;
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email, password: "smoke-password-1", email_confirm: true,
  });
  if (createError) throw createError;
  adminId = created.user.id;
  await service.from("user_roles").insert({ user_id: adminId, role: "admin" });

  const admin = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await admin.auth.signInWithPassword({ email, password: "smoke-password-1" });
  if (signInError) throw signInError;

  console.log("Importing…");
  const { data: saved, error: saveError } = await admin.rpc("admin_save_jelement_family", {
    p_spec: family, p_source_prompt: SPEC,
  });
  if (saveError) throw saveError;
  familyId = saved.id;
  assert.equal(saved.status, "draft", "an import is never published: a spec is a machine's reading of a picture");

  // Nothing is findable before publishing — a draft is not a catalogue.
  const { data: beforePublish } = await admin.rpc("jelement_search", { p_query: "mining haul truck" });
  assert.equal(beforePublish.length, 0, "a draft family does not answer searches");

  console.log("Publishing…");
  const { error: publishError } = await admin.rpc("admin_publish_jelement_family", { p_family_id: familyId });
  if (publishError) throw publishError;

  console.log("Searching the way a planner would…");
  const byName = await admin.rpc("jelement_search", { p_query: "mining haul truck" });
  assert.equal(byName.data[0].canonical_name, "mining haul truck", "the exact name finds it");

  const byUzbek = await admin.rpc("jelement_search", { p_query: "karer samosvali" });
  assert.equal(byUzbek.data[0].canonical_name, "mining haul truck", "and so does the Uzbek term");

  const byConcept = await admin.rpc("jelement_search", { p_query: "site survey" });
  assert.equal(byConcept.data[0].canonical_name, "survey total station",
    "a concept finds an element nobody named that");

  const nonsense = await admin.rpc("jelement_search", { p_query: "konus" });
  assert.equal(nonsense.data.length, 0, "and a word that merely looks similar finds nothing");

  // The shortlist is what goes to a model: small, and carrying no geometry.
  const payload = JSON.stringify(byName.data).length;
  assert.ok(payload < 2000, `a shortlist should stay small, got ${payload} bytes`);
  assert.equal(byName.data[0].render_spec, undefined, "and carry no render specification");

  console.log("Resolving the chosen element…");
  const elementId = byName.data[0].id;
  const { data: resolved } = await admin.rpc("jelement_resolve", { p_element_id: elementId });
  assert.ok(resolved.element, "a chosen element resolves in full");
  assert.equal(resolved.family.colorTokens.accent, "#A7FF00", "carrying the colours its shapes bind to");

  console.log("Recolouring the family…");
  const recoloured = { ...family, colorTokens: { ...family.colorTokens, accent: "#5B5BFF" } };
  const { error: recolourError } = await admin.rpc("admin_save_jelement_family", {
    p_spec: recoloured, p_family_id: familyId, p_source_prompt: SPEC,
  });
  if (recolourError) throw recolourError;

  const { data: afterRecolour } = await admin.rpc("jelement_resolve", { p_element_id: elementId });
  assert.equal(afterRecolour.family.colorTokens.accent, "#5B5BFF",
    "changing one role changes what every shape bound to it draws with");

  // The shape still says `accent`; it never carried the hex, which is the whole
  // reason a recolour reaches it.
  const components = afterRecolour.element.render_spec.components;
  const trim = components.find((component) => component.id === "trim");
  assert.equal(trim.fill, "accent", "the shape binds to the role, not to a colour");
  const glass = components.find((component) => component.id === "window");
  assert.equal(glass.recolorable, false, "and a layer that must not follow the accent does not");

  console.log("Archiving…");
  const versionBefore = afterRecolour.version;
  await admin.rpc("admin_publish_jelement_family", { p_family_id: familyId });
  const { error: archiveError } = await admin.rpc("admin_archive_jelement_family", { p_family_id: familyId });
  if (archiveError) throw archiveError;

  const { data: afterArchive } = await admin.rpc("jelement_search", { p_query: "mining haul truck" });
  assert.equal(afterArchive.length, 0, "an archived element leaves the catalogue");

  const { data: pinned } = await admin.rpc("jelement_resolve", {
    p_element_id: elementId, p_version: versionBefore,
  });
  assert.ok(pinned?.element, "but the version a deck pinned still resolves — archiving is not deletion");

  console.log("\nJElement smoke test passed.");
}

async function cleanup() {
  // Checked, because a cleanup that fails silently leaves rows that break
  // whatever runs next — and the first version of this test did exactly that.
  if (familyId) {
    const { error } = await service.from("jelement_families").delete().eq("id", familyId);
    if (error) throw new Error(`cleanup failed, rows left behind: ${error.message}`);
  }
  if (adminId) await service.auth.admin.deleteUser(adminId);

  const { count } = await service
    .from("jelement_families")
    .select("id", { count: "exact", head: true })
    .eq("id", familyId ?? "00000000-0000-0000-0000-000000000000");
  assert.equal(count ?? 0, 0, "the family this test created must be gone");

  console.log("Disposable data removed.");
}

try {
  await main();
} finally {
  await cleanup();
}
