import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

/**
 * The rules the marathon cannot be allowed to break, checked against
 * production.
 *
 * Every one of these is a way somebody could take money out of the thing: a
 * ledger that can be edited, a vote cast twice, a search that lists people who
 * never entered, a candidate reading who bought votes for them. They are
 * enforced in SQL rather than in an edge function, so they hold no matter what
 * calls them — and that is exactly what a test has to prove.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node supabase/tests/marathon-core-smoke.mjs
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

const stamp = randomUUID().slice(0, 8);
const campaignId = randomUUID();
const people = {
  candidate: { email: `mar-cand-${randomUUID()}@example.test`, username: `cand${stamp}` },
  outsider: { email: `mar-out-${randomUUID()}@example.test`, username: `out${stamp}` },
  voter: { email: `mar-voter-${randomUUID()}@example.test`, username: `voter${stamp}` },
};
const password = `${randomUUID()}Aa1!`;
let previousFlag = null;

async function makeUser(entry) {
  const created = await service.auth.admin.createUser({ email: entry.email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
  entry.id = created.data.user.id;
  const named = await service.from("profiles")
    .update({ username: entry.username, full_name: `Test ${entry.username}` })
    .eq("id", entry.id);
  if (named.error) throw named.error;
}

try {
  const flag = await service.from("app_settings").select("value").eq("key", "student_marathon_enabled").single();
  previousFlag = flag.data?.value ?? false;

  for (const entry of Object.values(people)) await makeUser(entry);

  const campaign = await service.from("marathon_campaigns").insert({
    id: campaignId,
    title: `Sinov marafoni ${stamp}`,
    description: "Test",
    starts_at: new Date(Date.now() - 3_600_000).toISOString(),
    ends_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    status: "active",
  });
  if (campaign.error) throw campaign.error;

  const tiers = await service.from("marathon_reward_tiers").insert([
    { campaign_id: campaignId, position: 1, votes_required: 1000, premium_required: 300, reward_percent: 25 },
    { campaign_id: campaignId, position: 2, votes_required: 2000, premium_required: 600, reward_percent: 50 },
    { campaign_id: campaignId, position: 3, votes_required: 3000, premium_required: 900, reward_percent: 75 },
    { campaign_id: campaignId, position: 4, votes_required: 4000, premium_required: 1200, reward_percent: 100 },
  ]);
  if (tiers.error) throw tiers.error;

  const joined = await service.from("marathon_participants").insert({ campaign_id: campaignId, user_id: people.candidate.id });
  if (joined.error) throw joined.error;

  console.log("Kampaniya va qoidalar:");
  const second = await service.from("marathon_campaigns").insert({
    id: randomUUID(), title: "Ikkinchi", starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + 86_400_000).toISOString(), status: "active",
  });
  check(Boolean(second.error), "only one campaign may run at a time");

  const backwards = await service.from("marathon_campaigns").insert({
    id: randomUUID(), title: "Teskari", starts_at: new Date(Date.now() + 86_400_000).toISOString(),
    ends_at: new Date().toISOString(), status: "draft",
  });
  check(Boolean(backwards.error), "a campaign cannot end before it starts");

  console.log("\nOvoz daftari:");
  const cast = await service.from("marathon_vote_ledger").insert({
    campaign_id: campaignId, candidate_id: people.candidate.id, voter_id: people.voter.id, kind: "free", source: "direct",
  }).select("id").single();
  check(!cast.error, `a vote is recorded${cast.error ? ` — ${cast.error.message}` : ""}`);

  const twice = await service.from("marathon_vote_ledger").insert({
    campaign_id: campaignId, candidate_id: people.candidate.id, voter_id: people.voter.id, kind: "free", source: "direct",
  });
  check(Boolean(twice.error), "the same free vote cannot be cast twice");

  const premium = await service.from("marathon_vote_ledger").insert({
    campaign_id: campaignId, candidate_id: people.candidate.id, voter_id: people.voter.id, kind: "premium", source: "direct",
  });
  check(!premium.error, "but a premium vote is separate from the free one");

  const bought = await service.from("marathon_vote_ledger").insert([
    { campaign_id: campaignId, candidate_id: people.candidate.id, voter_id: people.voter.id, kind: "premium", source: "marketplace" },
    { campaign_id: campaignId, candidate_id: people.candidate.id, voter_id: people.voter.id, kind: "premium", source: "marketplace" },
  ]);
  check(!bought.error, "a marketplace vote is a transfer and is not bound by that limit");

  const self = await service.from("marathon_vote_ledger").insert({
    campaign_id: campaignId, candidate_id: people.candidate.id, voter_id: people.candidate.id, kind: "free", source: "direct",
  });
  check(Boolean(self.error), "nobody votes for themselves");

  const edited = await service.from("marathon_vote_ledger").update({ kind: "premium" }).eq("id", cast.data?.id ?? "");
  check(Boolean(edited.error), "a recorded vote cannot be edited");
  const erased = await service.from("marathon_vote_ledger").delete().eq("id", cast.data?.id ?? "");
  check(Boolean(erased.error), "and it cannot be deleted");

  console.log("\nQidiruv:");
  const voterClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await voterClient.auth.signInWithPassword({ email: people.voter.email, password });
  if (signedIn.error) throw signedIn.error;

  await service.from("app_settings").update({ value: false }).eq("key", "student_marathon_enabled");
  const whileOff = await voterClient.rpc("marathon_search_candidates", { p_query: people.candidate.username });
  check(!whileOff.error && (whileOff.data ?? []).length === 0, "the search answers nothing while the marathon is off");

  await service.from("app_settings").update({ value: true }).eq("key", "student_marathon_enabled");
  const found = await voterClient.rpc("marathon_search_candidates", { p_query: `@${people.candidate.username}` });
  const row = (found.data ?? [])[0];
  check(!found.error && Boolean(row), `a candidate is found by username${found.error ? ` — ${found.error.message}` : ""}`);
  check(row?.user_id === people.candidate.id, "and it is the right account");
  // Four votes were recorded: one free, three premium.
  check(Number(row?.total_votes) === 4 && Number(row?.premium_votes) === 3,
    `with counts read from the ledger (${row?.total_votes}/${row?.premium_votes})`);

  const upper = await voterClient.rpc("marathon_search_candidates", { p_query: people.candidate.username.toUpperCase() });
  check((upper.data ?? []).length === 1, "case does not matter");

  const stranger = await voterClient.rpc("marathon_search_candidates", { p_query: people.outsider.username });
  check((stranger.data ?? []).length === 0, "an account that never entered is not a candidate");

  console.log("\nMaxfiylik:");
  const candidateClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const asCandidate = await candidateClient.auth.signInWithPassword({ email: people.candidate.email, password });
  if (asCandidate.error) throw asCandidate.error;
  const peeking = await candidateClient.from("marathon_vote_ledger").select("id,voter_id,source");
  check((peeking.data ?? []).length === 0,
    `a candidate cannot read who voted for them (${(peeking.data ?? []).length} rows)`);
  const ownVotes = await voterClient.from("marathon_vote_ledger").select("id");
  check((ownVotes.data ?? []).length > 0, "but a person can see the votes they cast");
} finally {
  if (previousFlag !== null) {
    await service.from("app_settings").update({ value: previousFlag }).eq("key", "student_marathon_enabled");
  }
  await service.from("marathon_campaigns").delete().eq("id", campaignId);
  await service.from("marathon_campaigns").delete().like("title", "Ikkinchi");
  for (const entry of Object.values(people)) {
    if (entry.id) await service.auth.admin.deleteUser(entry.id);
  }
}

const restored = await service.from("app_settings").select("value").eq("key", "student_marathon_enabled").single();
check(restored.data?.value === previousFlag, `the switch is back where it was (${JSON.stringify(restored.data?.value)})`);
const left = await service.from("marathon_campaigns").select("*", { count: "exact", head: true }).eq("id", campaignId);
check((left.count ?? 0) === 0, `nothing temporary remains (${left.count ?? 0})`);

console.log(failures ? `\n${failures} marathon check(s) failed.` : "\nAll marathon checks passed.");
process.exit(failures ? 1 : 0);
