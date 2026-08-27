import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

/**
 * Which index a real deck's photographs actually came from.
 *
 * Everything about the provider order is unit-tested except the part that only
 * exists at runtime: that the deployed generator reaches Unsplash, that the key
 * is read on the server, and that what it found is stored with a credit
 * somebody could check. A stub answering my own ladder proves the stub obeys
 * me.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node supabase/tests/photo-provider-smoke.mjs
 *
 * Generates a real presentation as a real user, on the design the generator
 * would pick, and reads the provider back out of `presentation_assets` — the
 * row a credits slide is built from, not a log line written for this test.
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

const { unzip } = await import(`${buildEdgeModules()}/unzip.js`);

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "  ✓" : "  ✖"} ${what}`);
  if (!ok) failures += 1;
};

const email = `photo-smoke-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw created.error ?? new Error("Test user was not created");
const userId = created.data.user.id;
const presentationId = randomUUID();

try {
  // Photographs are only searched for a super_professional deck, which is a
  // paid style — so the account needs credits before it can ask for one.
  const wallet = await service.from("credit_wallets")
    .upsert({ user_id: userId, balance: 100_000 }, { onConflict: "user_id" });
  if (wallet.error) throw wallet.error;

  const user = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await user.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  const started = Date.now();
  const generated = await user.functions.invoke("generate-presentation", {
    body: {
      presentationId,
      topic: process.env.TOPIC ?? "Toshkent metrosining me'moriy merosi",
      title: "Metro me'morchiligi",
      style: "super_professional",
      /**
       * A design that has somewhere to put a picture.
       *
       * Photography is read from the design: an archetype that supports an
       * image is a slide with a hole in it, and a design whose pages are all
       * type gets no photographs rather than photographs it will drop. Two of
       * the twenty published designs qualify, so leaving the choice to the
       * generator tests the photo pipeline one run in ten.
       */
      designSlug: process.env.DESIGN_SLUG ?? "minimal-kelajak",
      slideCount: Number(process.env.SLIDE_COUNT ?? 4),
      sources: ["Jaxongirman photo provider smoke test"],
      idempotencyKey: `photo-smoke:${presentationId}`,
    },
  });
  if (generated.error) {
    const detail = typeof generated.error.context?.json === "function" ? await generated.error.context.json() : null;
    throw new Error(detail?.error ?? generated.error.message);
  }

  /**
   * The job, not the presentation.
   *
   * `presentations` gets its row late in the run, so polling it reads "queued"
   * for a deck that is halfway written — which reports a stall that is not
   * happening and hides one that is. `generation_jobs` carries the stage.
   */
  let job = null;
  let stage = "";
  let quiet = 0;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await service.from("generation_jobs")
      .select("status, stage, error_code, error_message").eq("presentation_id", presentationId).maybeSingle();
    if (result.error) throw result.error;
    job = result.data;
    if (job && job.stage !== stage) {
      stage = job.stage;
      quiet = 0;
      console.log(`  ${((Date.now() - started) / 1000).toFixed(0)}s  ${job.status}/${stage}`);
    } else {
      quiet += 1;
    }
    if (job && job.status !== "running" && job.status !== "queued") break;
    // A stage that stops advancing is a worker that died: the edge function's
    // wall clock ends the background task and leaves the row saying "running"
    // for ever. Reported as itself rather than as "no photographs found".
    // Well past the longest legitimate stage: research alone takes about eighty
    // seconds, so a threshold near that reports a healthy run as abandoned.
    if (quiet >= 45) {
      console.log(`  ⚠︎  ${stage} bosqichida ${((Date.now() - started) / 1000).toFixed(0)}s dan beri o'zgarish yo'q — ish tashlab ketilgan`);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }

  console.log(`\nGeneratsiya: ${job?.status ?? "yo‘q"}/${job?.stage ?? "-"} · ${((Date.now() - started) / 1000).toFixed(0)}s`);
  check(job?.status === "succeeded", `the deck was generated${job?.error_message ? `: ${job.error_message}` : ` (stopped at ${job?.stage ?? "?"})`}`);

  /**
   * What each stage cost, read back from the row rather than from the clock
   * here. A duration the test measures proves the test can measure; a duration
   * the pipeline stored proves the pipeline recorded it.
   */
  const steps = await service.from("generation_steps")
    .select("sequence, key, status, duration_ms, error_code")
    .eq("presentation_id", presentationId).order("sequence");
  const timed = (steps.data ?? []).filter((step) => step.duration_ms !== null);
  console.log("\nBosqichlar:");
  for (const step of timed) {
    console.log(`  ${step.key.padEnd(20)} ${String(step.duration_ms).padStart(6)}ms  ${step.status}${step.error_code ? ` ${step.error_code}` : ""}`);
  }
  check(timed.length > 0, "every finished stage recorded how long it took");
  check(timed.every((step) => step.status !== "running"), "no stage is left saying it is still running");

  const assets = await service.from("presentation_assets")
    .select("provider, storage_bucket, storage_path, metadata")
    .eq("presentation_id", presentationId).eq("kind", "stock");
  if (assets.error) throw assets.error;

  const photos = assets.data ?? [];
  console.log(`\nRasmlar: ${photos.length}`);
  check(photos.length > 0, "the deck carries photographs");

  // A template deck may legitimately answer with a library illustration where
  // the subject is not something a photo index has, so the report names both.
  const byProvider = photos.reduce((tally, row) => {
    tally[row.provider ?? "?"] = (tally[row.provider ?? "?"] ?? 0) + 1;
    return tally;
  }, {});
  for (const [provider, count] of Object.entries(byProvider)) console.log(`  ${provider}: ${count}`);

  /**
   * The assertion this test exists for.
   *
   * Not "a photograph was found" — Openverse would satisfy that, and did
   * before. The provider recorded on the row is what a credits slide reads and
   * what an audit reads, so it is what proves which index answered.
   */
  if (process.env.EXPECT_PROVIDER === "any") {
    check(photos.length > 0, `a picture was found (${Object.keys(byProvider).join(", ")})`);
  } else {
    check(Boolean(byProvider.unsplash), "at least one photograph came from Unsplash");
  }

  for (const row of photos) {
    const credit = row.metadata?.attribution ?? {};
    if (row.provider === "jelement") {
      // The library's own object: nobody outside to credit, but what was used
      // is still recorded, because a deck nobody can explain cannot be fixed.
      check(Boolean(credit.title), `${row.provider}: the element is named (${credit.title ?? "—"})`);
      check(row.metadata?.source === row.provider, `${row.provider}: metadata and column agree on the source`);
      continue;
    }
    check(Boolean(credit.creator), `${row.provider}: the photographer is recorded (${credit.creator ?? "—"})`);
    check(/^https?:\/\//.test(credit.sourceUrl ?? ""), `${row.provider}: a link back is recorded`);
    check(Boolean(credit.license), `${row.provider}: the licence is recorded (${credit.license ?? "—"})`);
    // Commons results carry a licence URL and are the ones whose terms are
    // actually conditional, so the link has to survive to the credits slide.
    if (row.provider === "wikimedia" || row.provider === "wikidata") {
      // Public-domain files carry no licence URL, which is correct rather than
      // missing: there are no terms to link to.
      const publicDomain = /public domain|^cc0/i.test(credit.license ?? "");
      check(publicDomain || /^https?:\/\//.test(credit.licenseUrl ?? ""),
        `${row.provider}: the licence link is recorded (${credit.licenseUrl || credit.license})`);
      check(!/[<>]/.test(credit.creator ?? ""), `${row.provider}: the credit is text, not markup`);
    }
    check(row.metadata?.source === row.provider, `${row.provider}: metadata and column agree on the source`);
  }

  /**
   * And the picture is in the file somebody downloads.
   *
   * Everything above proves a photograph was found, stored and credited. For a
   * deck built from a PowerPoint template that is only half the claim: the
   * export clones the original slide, so a picture that never reaches the media
   * part is a picture the customer never sees. The bytes in the package are the
   * only proof that matters.
   */
  if (process.env.CHECK_EXPORT === "1" && photos.length > 0) {
    const exported = await user.functions.invoke("export-presentation", {
      body: { presentationId, format: "pptx" },
    });
    if (exported.error) {
      const detail = typeof exported.error.context?.json === "function" ? await exported.error.context.json() : null;
      check(false, `the deck exported: ${detail?.error ?? exported.error.message}`);
    } else {
      // The export is a job too: the call returns an id and the file appears
      // when the work is done.
      const jobId = exported.data?.jobId ?? exported.data?.job_id ?? null;
      let path = null;
      let exportError = null;
      for (let attempt = 0; attempt < 45 && jobId; attempt += 1) {
        const row = await service.from("export_jobs")
          .select("status, storage_path, error_message").eq("id", jobId).maybeSingle();
        if (row.data?.storage_path) { path = row.data.storage_path; break; }
        if (row.data?.status === "failed") { exportError = row.data.error_message; break; }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      check(Boolean(path), `the export produced a file${exportError ? `: ${exportError}` : ""}`);

      if (path) {
        const download = await service.storage.from("exports").download(path);
        check(!download.error, "the exported file downloads");
        if (!download.error) {
          const bytes = new Uint8Array(await download.data.arrayBuffer());
          const stored = await service.storage.from(photos[0].storage_bucket).download(photos[0].storage_path);
          const wanted = new Uint8Array(await stored.data.arrayBuffer());

          // Unzipped rather than searched raw: a package stores its parts
          // compressed, so the photograph's bytes are not in the file as bytes.
          const entries = await unzip(bytes);
          const media = [...entries.entries()].filter(([name]) => /^ppt\/media\//.test(name));
          const match = media.find(([, part]) =>
            part.byteLength === wanted.byteLength && Buffer.from(part).equals(Buffer.from(wanted)));

          check(Boolean(match),
            `the found picture is a media part of the exported deck (${media.length} ta media, ${wanted.byteLength} bayt izlandi)`);
          if (match) console.log(`  · almashtirilgan qism: ${match[0]}`);
        }
      }
    }
  }

  // The file is really in the bucket, not just a row claiming it is.
  const [first] = photos;
  if (first) {
    const dir = first.storage_path.split("/").slice(0, -1).join("/");
    const name = first.storage_path.split("/").pop();
    const listed = await service.storage.from(first.storage_bucket).list(dir, { search: name });
    check((listed.data ?? []).some((object) => object.name === name), "the image file is in storage");
  }
} finally {
  if (process.env.KEEP === "1") {
    console.log(`\nKEEP=1 — qoldirildi: presentation ${presentationId}, user ${userId}`);
  } else {
  /**
   * Release before deleting.
   *
   * Deleting a job row that still holds a reservation strands the credits: the
   * watchdog sweeps jobs, and a job that no longer exists cannot be swept. The
   * test that checks nothing is left behind must not leave something behind.
   */
  const open = await service.from("generation_jobs")
    .select("id").eq("presentation_id", presentationId).in("status", ["running", "queued"]);
  for (const job of open.data ?? []) {
    await service.rpc("fail_generation", {
      p_job_id: job.id, p_error_code: "test_cleanup", p_error_message: "smoke test finished",
    });
  }

  await service.from("presentation_assets").delete().eq("presentation_id", presentationId);
  await service.from("presentations").delete().eq("id", presentationId);
  await service.from("credit_wallets").delete().eq("user_id", userId);
  await service.auth.admin.deleteUser(userId);
  }
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
