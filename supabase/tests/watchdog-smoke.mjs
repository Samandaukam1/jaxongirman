import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

/**
 * No job stays running for ever, and no reservation is stranded with it.
 *
 * The pgTAP file next door says the same thing and needs a local database with
 * these migrations on it; this runs against a real project, which is where the
 * question actually matters — the watchdog exists because a worker died in
 * production and nothing noticed.
 *
 * Everything it creates is temporary and removed, including the credit
 * reservation: a test about stranded credits must not strand any.
 */

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "  ✓" : "  ✖"} ${what}`);
  if (!ok) failures += 1;
};

const email = `watchdog-${randomUUID()}@example.test`;
const created = await service.auth.admin.createUser({ email, password: `${randomUUID()}Aa1!`, email_confirm: true });
if (created.error || !created.data.user) throw created.error ?? new Error("Test user was not created");
const userId = created.data.user.id;

const stalePresentation = randomUUID();
const livePresentation = randomUUID();
const staleJob = randomUUID();
const liveJob = randomUUID();

const RESERVED_STALE = 70;
const RESERVED_LIVE = 50;
const START_BALANCE = 500;

try {
  await service.from("credit_wallets")
    .upsert({ user_id: userId, balance: START_BALANCE, reserved: RESERVED_STALE + RESERVED_LIVE }, { onConflict: "user_id" });

  const decks = await service.from("presentations").insert([
    { id: stalePresentation, owner_id: userId, title: "Stale", topic: "Stale", style: "super_professional", requested_slide_count: 5, status: "generating" },
    { id: livePresentation, owner_id: userId, title: "Live", topic: "Live", style: "super_professional", requested_slide_count: 5, status: "generating" },
  ]);
  if (decks.error) throw decks.error;

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const jobs = await service.from("generation_jobs").insert([
    // Died an hour ago, mid-stage, holding credits.
    { id: staleJob, idempotency_key: `watchdog-stale-${staleJob}`, presentation_id: stalePresentation, owner_id: userId, status: "running", stage: "writing_content", reserved_credits: RESERVED_STALE, heartbeat_at: hourAgo, started_at: hourAgo },
    // Working right now. Killing a live deck under its author would be worse
    // than the stall this exists to clear.
    { id: liveJob, idempotency_key: `watchdog-live-${liveJob}`, presentation_id: livePresentation, owner_id: userId, status: "running", stage: "writing_content", reserved_credits: RESERVED_LIVE, heartbeat_at: new Date().toISOString() },
  ]);
  if (jobs.error) throw jobs.error;

  await service.from("generation_steps").insert({
    job_id: staleJob, presentation_id: stalePresentation, owner_id: userId,
    sequence: 4, key: "writing_content", label: "Mazmun yozilmoqda", status: "running", progress: 5, started_at: hourAgo,
  });

  const swept = await service.rpc("fail_stale_generations", { p_stale_minutes: 8 });
  if (swept.error) throw swept.error;
  console.log(`Watchdog: ${swept.data} ta job tozalandi`);

  const after = await service.from("generation_jobs").select("id,status,error_code,error_message").in("id", [staleJob, liveJob]);
  const stale = after.data?.find((row) => row.id === staleJob);
  const live = after.data?.find((row) => row.id === liveJob);

  check(stale?.status === "failed", `the stalled job is failed (${stale?.status})`);
  check(stale?.error_code === "stalled", `it says why, in a code a query can group by (${stale?.error_code})`);
  check(Boolean(stale?.error_message), "and in a sentence a person can read");
  check(live?.status === "running", `a job that is still moving is left alone (${live?.status})`);

  const wallet = await service.from("credit_wallets").select("balance,reserved").eq("user_id", userId).single();
  check(wallet.data?.balance === START_BALANCE + RESERVED_STALE,
    `the reserved credits came back (${START_BALANCE} → ${wallet.data?.balance})`);
  check(wallet.data?.reserved === RESERVED_LIVE,
    `only the live job's hold remains (${wallet.data?.reserved})`);

  const ledger = await service.from("credit_transactions").select("type,amount").eq("job_id", staleJob).eq("type", "refund");
  check((ledger.data ?? []).length === 1, `the refund is in the ledger, once (${(ledger.data ?? []).length})`);
  check(ledger.data?.[0]?.amount === RESERVED_STALE, `for the amount that was held (${ledger.data?.[0]?.amount})`);

  const step = await service.from("generation_steps").select("status,error_code").eq("job_id", staleJob).eq("key", "writing_content").single();
  check(step.data?.status === "failed", "the step it died on stops saying it is running");
  check(step.data?.error_code === "stalled", "and carries the same code as the job");

  // Safe to call as often as it is reached, which is what lets it run beside
  // every generation instead of on a schedule nobody maintains.
  const again = await service.rpc("fail_stale_generations", { p_stale_minutes: 8 });
  check(again.data === 0, `a second sweep finds nothing (${again.data})`);
  const settled = await service.from("credit_wallets").select("balance").eq("user_id", userId).single();
  check(settled.data?.balance === START_BALANCE + RESERVED_STALE,
    "so the balance does not drift upward on every call");
} finally {
  // The live job still holds a reservation; release it before the wallet goes,
  // or this test leaves behind exactly what it was written to catch.
  await service.rpc("fail_generation", { p_job_id: liveJob, p_error_code: "test_cleanup", p_error_message: "smoke test finished" });
  await service.from("generation_steps").delete().in("job_id", [staleJob, liveJob]);
  await service.from("credit_transactions").delete().in("job_id", [staleJob, liveJob]);
  await service.from("generation_jobs").delete().in("id", [staleJob, liveJob]);
  await service.from("presentations").delete().in("id", [stalePresentation, livePresentation]);
  await service.from("credit_wallets").delete().eq("user_id", userId);
  await service.auth.admin.deleteUser(userId);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
