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
let draftId = null;

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

  console.log("\nOvoz berish:");
  // A fresh voter, because the one above already spent both votes directly.
  const casterEntry = { email: `mar-cast-${randomUUID()}@example.test`, username: `cast${stamp}` };
  await makeUser(casterEntry);
  people.caster = casterEntry;
  const caster = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const casterIn = await caster.auth.signInWithPassword({ email: casterEntry.email, password });
  if (casterIn.error) throw casterIn.error;

  const before = await caster.rpc("marathon_my_votes");
  check(before.data?.free_available === 1 && before.data?.premium_available === 1,
    `a new voter holds both votes (${JSON.stringify(before.data)})`);

  const cast1 = await caster.rpc("marathon_cast_vote", { p_candidate_id: people.candidate.id, p_kind: "free" });
  check(!cast1.error, `a vote is cast${cast1.error ? ` — ${cast1.error.message}` : ""}`);

  const again = await caster.rpc("marathon_cast_vote", { p_candidate_id: people.candidate.id, p_kind: "free" });
  check(Boolean(again.error) && /allaqachon/.test(again.error?.message ?? ""),
    `the same vote cannot be cast twice, and says so in words (${again.error?.message?.slice(0, 40) ?? "allowed"})`);

  const spent = await caster.rpc("marathon_my_votes");
  check(spent.data?.free_available === 0 && spent.data?.premium_available === 1,
    `what is left is what the ledger says (${JSON.stringify(spent.data)})`);

  const atSelf = await caster.rpc("marathon_cast_vote", { p_candidate_id: casterEntry.id, p_kind: "premium" });
  check(Boolean(atSelf.error), "nobody votes for themselves through the function either");

  const atStranger = await caster.rpc("marathon_cast_vote", { p_candidate_id: people.outsider.id, p_kind: "premium" });
  check(Boolean(atStranger.error) && /ishtirokchisi emas/.test(atStranger.error?.message ?? ""),
    "an account that never entered cannot be voted for");

  const premiumCast = await caster.rpc("marathon_cast_vote", { p_candidate_id: people.candidate.id, p_kind: "premium" });
  check(!premiumCast.error, "a premium vote is separate");

  console.log("\nBildirishnoma:");
  const notes = await service.from("notifications")
    .select("kind,title,body,payload").eq("user_id", people.candidate.id).eq("kind", "marathon_vote")
    .order("created_at", { ascending: false });
  const rows = notes.data ?? [];
  check(rows.length === 2, `the candidate was told about each vote (${rows.length})`);
  const free = rows.find((row) => row.payload?.kind === "free");
  const paid = rows.find((row) => row.payload?.kind === "premium");
  check(Boolean(free) && free.body.includes(casterEntry.username),
    `a direct vote names who cast it (${free?.body?.slice(0, 48) ?? "—"})`);
  check(Boolean(paid) && paid.title.includes("Premium"),
    `and a premium vote reads differently (${paid?.title ?? "—"})`);
  check(rows.every((row) => row.payload?.source === "direct"),
    "each one records how it arrived, so a marketplace vote can say less");

  console.log("\nMarafon o‘chirilganda:");
  await service.from("app_settings").update({ value: false }).eq("key", "student_marathon_enabled");
  const whileClosed = await caster.rpc("marathon_cast_vote", { p_candidate_id: people.candidate.id, p_kind: "premium" });
  check(Boolean(whileClosed.error), "no vote can be cast while the marathon is off");
  await service.from("app_settings").update({ value: true }).eq("key", "student_marathon_enabled");

  console.log("\nMaxfiylik:");
  const candidateClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const asCandidate = await candidateClient.auth.signInWithPassword({ email: people.candidate.email, password });
  if (asCandidate.error) throw asCandidate.error;
  const peeking = await candidateClient.from("marathon_vote_ledger").select("id,voter_id,source");
  check((peeking.data ?? []).length === 0,
    `a candidate cannot read who voted for them (${(peeking.data ?? []).length} rows)`);
  const ownVotes = await voterClient.from("marathon_vote_ledger").select("id");
  check((ownVotes.data ?? []).length > 0, "but a person can see the votes they cast");

  console.log("\nKampaniya sahifasi:");
  await service.from("app_settings").update({ value: false }).eq("key", "student_marathon_enabled");
  const closedPage = await candidateClient.rpc("marathon_active_campaign");
  check(!closedPage.error && closedPage.data === null, "the page has no campaign to draw while the marathon is off");
  const closedJoin = await voterClient.rpc("marathon_join");
  check(Boolean(closedJoin.error), "and nobody can enter one");

  await service.from("app_settings").update({ value: true }).eq("key", "student_marathon_enabled");
  const page = await candidateClient.rpc("marathon_active_campaign");
  const shown = page.data;
  check(!page.error && shown?.id === campaignId, `the running campaign is returned${page.error ? ` — ${page.error.message}` : ""}`);
  check((shown?.tiers ?? []).length === 4, `with its whole reward ladder (${(shown?.tiers ?? []).length})`);
  check((shown?.tiers ?? []).every((tier, index) => tier.position === index + 1),
    "in the order the milestones are climbed");
  check(shown?.tiers?.[0]?.votes_required === 1000 && shown?.tiers?.[0]?.reward_percent === 25,
    "each rung carrying what it costs and what it pays");

  // The countdown is measured against this, not against the phone.
  const clockGap = Math.abs(new Date(shown?.server_now ?? 0).getTime() - Date.now());
  check(Number.isFinite(clockGap) && clockGap < 120_000, `the answer carries the server's own clock (${Math.round(clockGap / 1000)}s apart)`);

  check(shown?.joined === true, "a participant is told they are in");
  // Six votes reached this candidate: two free, two premium directly, two bought.
  check(Number(shown?.total_votes) === 6 && Number(shown?.premium_votes) === 4,
    `and the page counts the same votes the ledger holds (${shown?.total_votes}/${shown?.premium_votes})`);

  const outsiderPage = await caster.rpc("marathon_active_campaign");
  check(outsiderPage.data?.joined === false, "somebody who never entered is not shown as a participant");

  const entering = await caster.rpc("marathon_join");
  check(!entering.error, `joining works${entering.error ? ` — ${entering.error.message}` : ""}`);
  const twiceIn = await caster.rpc("marathon_join");
  check(!twiceIn.error, "and pressing it twice is not an error");
  const enrolled = await service.from("marathon_participants")
    .select("*", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("user_id", people.caster.id);
  check((enrolled.count ?? 0) === 1, `joining twice leaves one row (${enrolled.count ?? 0})`);

  console.log("\nMarra qarori:");
  // The candidate is nowhere near a milestone yet: six votes against a
  // thousand. Nothing may be claimed on the strength of a screen saying so.
  const candidateVoter = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const candidateIn = await candidateVoter.auth.signInWithPassword({ email: people.candidate.email, password });
  if (candidateIn.error) throw candidateIn.error;

  const tooEarly = await candidateVoter.rpc("marathon_decide_milestone", { p_position: 1, p_decision: "claim" });
  check(Boolean(tooEarly.error) && /yetmadingiz/.test(tooEarly.error?.message ?? ""),
    `a milestone cannot be claimed before it is reached (${tooEarly.error?.message?.slice(0, 44) ?? "allowed"})`);

  // Lower the first two rungs to what this candidate actually has, rather than
  // manufacturing a thousand votes: the rule under test is the decision, not
  // the counting, which the ledger checks above already cover.
  await service.from("marathon_reward_tiers")
    .update({ votes_required: 3, premium_required: 2 }).eq("campaign_id", campaignId).eq("position", 1);
  await service.from("marathon_reward_tiers")
    .update({ votes_required: 5, premium_required: 3 }).eq("campaign_id", campaignId).eq("position", 2);

  const madeUp = await candidateVoter.rpc("marathon_decide_milestone", { p_position: 9, p_decision: "claim" });
  check(Boolean(madeUp.error), "a rung that does not exist cannot be answered");

  const nonsense = await candidateVoter.rpc("marathon_decide_milestone", { p_position: 1, p_decision: "maybe" });
  check(Boolean(nonsense.error), "and neither can a decision that is not one of the two");

  const carriedOn = await candidateVoter.rpc("marathon_decide_milestone", { p_position: 1, p_decision: "continue" });
  check(!carriedOn.error, `giving up a reward for the next one is recorded${carriedOn.error ? ` — ${carriedOn.error.message}` : ""}`);

  const again2 = await candidateVoter.rpc("marathon_decide_milestone", { p_position: 1, p_decision: "claim" });
  check(Boolean(again2.error) && /allaqachon/.test(again2.error?.message ?? ""),
    "and cannot be reconsidered afterwards");

  const written = await service.from("marathon_milestone_decisions")
    .select("decision,total_votes_at,premium_votes_at").eq("campaign_id", campaignId).eq("user_id", people.candidate.id);
  check((written.data ?? []).length === 1 && written.data?.[0]?.decision === "continue",
    "the decision is a row on the server, not a closed modal");
  check(Number(written.data?.[0]?.total_votes_at) === 6,
    `with the count it was made on (${written.data?.[0]?.total_votes_at})`);

  const decidedNote = await service.from("notifications")
    .select("title,payload").eq("user_id", people.candidate.id).eq("kind", "marathon_milestone");
  check((decidedNote.data ?? []).length === 1 && decidedNote.data?.[0]?.payload?.decision === "continue",
    "and the candidate has a record of it in their inbox");

  const claim = await candidateVoter.rpc("marathon_decide_milestone", { p_position: 2, p_decision: "claim" });
  check(!claim.error, `the next rung can then be claimed${claim.error ? ` — ${claim.error.message}` : ""}`);

  const afterClaim = await candidateVoter.rpc("marathon_decide_milestone", { p_position: 3, p_decision: "continue" });
  check(Boolean(afterClaim.error) && /olgansiz/.test(afterClaim.error?.message ?? ""),
    "a claim ends the ladder — nothing above it can be answered");

  const shownAfter = await candidateVoter.rpc("marathon_active_campaign");
  check((shownAfter.data?.decisions ?? []).length === 2,
    `the campaign answer carries both decisions (${(shownAfter.data?.decisions ?? []).length})`);

  const tampered = await candidateVoter.from("marathon_milestone_decisions").update({ decision: "continue" }).eq("campaign_id", campaignId);
  const tamperedRows = await service.from("marathon_milestone_decisions")
    .select("decision").eq("campaign_id", campaignId).eq("tier_position", 2).single();
  check(tamperedRows.data?.decision === "claim",
    `a candidate cannot rewrite their own decision (${tampered.error ? "refused" : "no rows changed"})`);

  // Put the ladder back before the rest of the run reads it.
  await service.from("marathon_reward_tiers")
    .update({ votes_required: 1000, premium_required: 300 }).eq("campaign_id", campaignId).eq("position", 1);
  await service.from("marathon_reward_tiers")
    .update({ votes_required: 2000, premium_required: 600 }).eq("campaign_id", campaignId).eq("position", 2);

  console.log("\nUlashish havolasi:");
  // The web landing page reads this with the anon key and nothing else.
  const guest = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const invite = await guest.rpc("marathon_candidate", { p_campaign_id: campaignId, p_user_id: people.candidate.id });
  const card = invite.data;
  check(!invite.error && card?.user_id === people.candidate.id,
    `a shared link resolves without signing in${invite.error ? ` — ${invite.error.message}` : ""}`);
  check(card?.username === people.candidate.username && card?.campaign_title?.includes(stamp),
    "and names the person and the campaign it was printed for");
  // What a poster already says, and nothing else: no counts, no e-mail, no
  // way to ask this endpoint who voted for whom.
  check(!("total_votes" in (card ?? {})) && !("premium_votes" in (card ?? {})) && !("email" in (card ?? {})),
    `it carries no vote counts and no contact details (${Object.keys(card ?? {}).join(",")})`);
  const clockGap2 = Math.abs(new Date(card?.server_now ?? 0).getTime() - Date.now());
  check(clockGap2 < 120_000, "and the deadline it draws is measured by the server's clock");

  const strangerLink = await guest.rpc("marathon_candidate", { p_campaign_id: campaignId, p_user_id: people.outsider.id });
  check(strangerLink.data === null, "a link to somebody who never entered resolves to nothing");

  const wrongCampaign = await guest.rpc("marathon_candidate", { p_campaign_id: randomUUID(), p_user_id: people.candidate.id });
  check(wrongCampaign.data === null, "and so does one whose campaign is not the one running");

  await service.from("app_settings").update({ value: false }).eq("key", "student_marathon_enabled");
  const whileDark = await guest.rpc("marathon_candidate", { p_campaign_id: campaignId, p_user_id: people.candidate.id });
  check(whileDark.data === null, "while the marathon is off the link says nothing about anybody");
  await service.from("app_settings").update({ value: true }).eq("key", "student_marathon_enabled");

  console.log("\nOvozlar bozori:");
  let marketFlag = null;
  const marketFlagRow = await service.from("app_settings").select("value").eq("key", "marathon.vote_marketplace_enabled").single();
  marketFlag = marketFlagRow.data?.value ?? false;

  await service.from("app_settings").update({ value: false }).eq("key", "marathon.vote_marketplace_enabled");
  const shutMarket = await voterClient.rpc("marathon_list_votes", { p_kind: "free", p_quantity: 1, p_unit_price: 9000 });
  check(Boolean(shutMarket.error), "nothing can be listed while the marketplace switch is off");

  await service.from("app_settings").update({ value: true }).eq("key", "marathon.vote_marketplace_enabled");

  // A seller who still holds both votes. The voters above have spent theirs.
  const sellerEntry = { email: `mar-sell-${randomUUID()}@example.test`, username: `sell${stamp}` };
  await makeUser(sellerEntry);
  people.seller = sellerEntry;
  const seller = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const sellerIn = await seller.auth.signInWithPassword({ email: sellerEntry.email, password });
  if (sellerIn.error) throw sellerIn.error;

  const tooCheap = await seller.rpc("marathon_list_votes", { p_kind: "premium", p_quantity: 1, p_unit_price: 100 });
  check(Boolean(tooCheap.error) && /minimal bozor narxidan past/.test(tooCheap.error?.message ?? ""),
    `a price under the floor is refused in words (${tooCheap.error?.message?.slice(0, 46) ?? "allowed"})`);

  const tooMany = await seller.rpc("marathon_list_votes", { p_kind: "premium", p_quantity: 4, p_unit_price: 20000 });
  check(Boolean(tooMany.error), "and nobody lists more votes than they hold");

  const listed = await seller.rpc("marathon_list_votes", { p_kind: "premium", p_quantity: 1, p_unit_price: 20000 });
  check(!listed.error, `a vote is listed${listed.error ? ` — ${listed.error.message}` : ""}`);
  check(listed.data?.quote?.buyer_total === 22400 && listed.data?.quote?.seller_net === 17600,
    `with 12% from each side (${JSON.stringify(listed.data?.quote ? {
      total: listed.data.quote.buyer_total, net: listed.data.quote.seller_net } : null)})`);

  const twiceListed = await seller.rpc("marathon_list_votes", { p_kind: "premium", p_quantity: 1, p_unit_price: 25000 });
  check(Boolean(twiceListed.error), "the same vote cannot be listed a second time");

  const walletWhileListed = await seller.rpc("marathon_my_votes");
  check(walletWhileListed.data?.premium_available === 0 && walletWhileListed.data?.premium_listed === 1,
    `a listed vote leaves the wallet and says where it went (${JSON.stringify(walletWhileListed.data)})`);

  const spendListed = await seller.rpc("marathon_cast_vote", { p_candidate_id: people.candidate.id, p_kind: "premium" });
  check(Boolean(spendListed.error) && /sotuvda/.test(spendListed.error?.message ?? ""),
    `and it cannot also be given away (${spendListed.error?.message?.slice(0, 40) ?? "allowed"})`);

  const freeStillThere = await seller.rpc("marathon_cast_vote", { p_candidate_id: people.candidate.id, p_kind: "free" });
  check(!freeStillThere.error, "while the other vote is untouched by the listing");

  console.log("\nBozor anonimligi:");
  const browsing = await caster.rpc("marathon_vote_market", { p_kind: "premium" });
  const lot = (browsing.data ?? [])[0];
  check(!browsing.error && Boolean(lot), `a buyer sees the lot${browsing.error ? ` — ${browsing.error.message}` : ""}`);
  check(!("seller_id" in (lot ?? {})) && !("username" in (lot ?? {})),
    `and nothing about who is selling it (${Object.keys(lot ?? {}).join(",")})`);
  check(lot?.buyer_total === 22400, `the price it quotes includes the buyer's 12% (${lot?.buyer_total})`);
  check(lot?.is_mine === false, "a buyer is told it is not their own lot");

  const rowRead = await caster.from("marathon_vote_listings").select("id,seller_id");
  check((rowRead.data ?? []).length === 0,
    `and the table itself is unreadable to anybody else (${(rowRead.data ?? []).length} rows)`);
  const ownRead = await seller.from("marathon_vote_listings").select("id");
  check((ownRead.data ?? []).length === 1, "while a seller can see their own");

  const notMine = await caster.rpc("marathon_cancel_vote_listing", { p_listing_id: listed.data?.listing_id });
  check(Boolean(notMine.error), "somebody else's listing cannot be taken down");

  const cancelled = await seller.rpc("marathon_cancel_vote_listing", { p_listing_id: listed.data?.listing_id });
  check(!cancelled.error, `a seller can withdraw their own${cancelled.error ? ` — ${cancelled.error.message}` : ""}`);
  const walletBack = await seller.rpc("marathon_my_votes");
  check(walletBack.data?.premium_available === 1 && walletBack.data?.premium_listed === 0,
    `and the vote comes back to them (${JSON.stringify(walletBack.data)})`);
  const emptyMarket = await caster.rpc("marathon_vote_market", { p_kind: "premium" });
  check((emptyMarket.data ?? []).length === 0, "a withdrawn lot is off the market");

  console.log("\nXarid va escrow:");
  // A fresh lot to buy, since the one above was withdrawn.
  const forSale = await seller.rpc("marathon_list_votes", { p_kind: "premium", p_quantity: 1, p_unit_price: 20000 });
  if (forSale.error) throw forSale.error;
  const listingId = forSale.data.listing_id;

  const ownLot = await seller.rpc("marathon_buy_votes", { p_listing_id: listingId, p_quantity: 1 });
  check(Boolean(ownLot.error), "nobody buys their own lot");

  const started = await caster.rpc("marathon_buy_votes", { p_listing_id: listingId, p_quantity: 1 });
  check(!started.error && started.data?.total_amount === 22400,
    `a purchase creates an order for the buyer's total${started.error ? ` — ${started.error.message}` : ` (${started.data?.total_amount})`}`);

  const heldOff = await voterClient.rpc("marathon_vote_market", { p_kind: "premium" });
  check((heldOff.data ?? []).length === 0, "and takes the lot off the market while it is being paid for");

  const reused = await caster.rpc("marathon_buy_votes", { p_listing_id: listingId, p_quantity: 1 });
  check(reused.data?.reused === true, "a second attempt at the same lot is the same order, not a second hold");

  const orderRow = await service.from("orders").select("id,seller_id,purpose,reference_code,total_amount")
    .eq("id", started.data.order_id).single();
  check(orderRow.data?.seller_id === null,
    "the order carries no seller — a buyer reads their own order and must not learn who sold");
  check(orderRow.data?.reference_code === listingId, "the listing is what the order points at");

  const buyerSees = await caster.from("marathon_vote_sales").select("id,seller_id");
  const sellerSees = await seller.from("marathon_vote_sales").select("id,buyer_id");
  check((buyerSees.data ?? []).length === 0 && (sellerSees.data ?? []).length === 0,
    `the sale row itself is readable by neither side (${(buyerSees.data ?? []).length}/${(sellerSees.data ?? []).length})`);

  // Paying, the way the provider callback does.
  const settled = await service.rpc("order_fulfil", { p_order_id: started.data.order_id });
  check(!settled.error, `fulfilment transfers the votes${settled.error ? ` — ${settled.error.message}` : ""}`);

  const again3 = await service.rpc("order_fulfil", { p_order_id: started.data.order_id });
  check(again3.data?.already === true, "a retried callback transfers nothing a second time");

  const transferred = await service.from("marathon_vote_ledger")
    .select("kind,source,voter_id").eq("campaign_id", campaignId).eq("candidate_id", people.caster.id);
  const arrived = (transferred.data ?? []).filter((row) => row.source === "marketplace");
  check(arrived.length === 1 && arrived[0]?.kind === "premium",
    `the buyer's tally gains exactly what was bought (${arrived.length})`);
  check(arrived[0]?.voter_id === people.seller.id,
    "recorded as the seller's allowance transferred, not as a vote out of nowhere");

  const notes2 = await service.from("notifications").select("user_id,title,body,payload")
    .in("user_id", [people.caster.id, people.seller.id]).eq("kind", "marathon_vote")
    .order("created_at", { ascending: false }).limit(2);
  const buyerNote = (notes2.data ?? []).find((row) => row.user_id === people.caster.id);
  const sellerNote = (notes2.data ?? []).find((row) => row.user_id === people.seller.id);
  check(Boolean(buyerNote) && Boolean(sellerNote), "both sides are told");
  check(!`${buyerNote?.body ?? ""}${sellerNote?.body ?? ""}`.includes(people.seller.username)
    && !`${buyerNote?.body ?? ""}${sellerNote?.body ?? ""}`.includes(people.caster.username),
    `and neither message names the other party (${sellerNote?.body?.slice(0, 46) ?? "—"})`);

  const sellerLedger = await seller.rpc("marathon_my_vote_sales");
  const sale = (sellerLedger.data ?? [])[0];
  check(sale?.seller_net === 17600 && sale?.status === "released",
    `the seller's own record shows what they earned (${JSON.stringify(sale ?? null)})`);
  check(!("buyer_id" in (sale ?? {})), "with no buyer in it");

  console.log("\nTashlab ketilgan xarid:");
  const spentAlready = await seller.rpc("marathon_list_votes", { p_kind: "free", p_quantity: 1, p_unit_price: 9000 });
  check(Boolean(spentAlready.error), "a vote already given away cannot be listed afterwards");

  // A fresh seller, to abandon a purchase against.
  const quitterEntry = { email: `mar-quit-${randomUUID()}@example.test`, username: `quit${stamp}` };
  await makeUser(quitterEntry);
  people.quitter = quitterEntry;
  const quitter = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const quitterIn = await quitter.auth.signInWithPassword({ email: quitterEntry.email, password });
  if (quitterIn.error) throw quitterIn.error;
  const abandoned = await quitter.rpc("marathon_list_votes", { p_kind: "free", p_quantity: 1, p_unit_price: 9000 });
  if (abandoned.error) throw abandoned.error;

  const startedThenLeft = await voterClient.rpc("marathon_buy_votes", { p_listing_id: abandoned.data.listing_id, p_quantity: 1 });
  if (startedThenLeft.error) throw startedThenLeft.error;
  await service.rpc("order_advance", { p_order_id: startedThenLeft.data.order_id, p_to: "cancelled" });

  const backOnSale = await service.from("marathon_vote_listings").select("status,remaining").eq("id", abandoned.data.listing_id).single();
  check(backOnSale.data?.status === "open" && backOnSale.data?.remaining === 1,
    `an abandoned purchase puts the lot back on the market (${JSON.stringify(backOnSale.data)})`);
  const escrowRow = await service.from("marathon_vote_sales").select("status").eq("order_id", startedThenLeft.data.order_id).single();
  check(escrowRow.data?.status === "refunded", "and the escrow is marked refunded rather than left open");

  await service.from("app_settings").update({ value: marketFlag }).eq("key", "marathon.vote_marketplace_enabled");

  console.log("\nAfisha:");
  const posterPath = `${campaignId}/poster-${stamp}.txt`;
  const uploaded = await service.storage.from("marathon-posters")
    .upload(posterPath, new Blob(["afisha"], { type: "text/plain" }), { upsert: true });
  check(!uploaded.error, `an administrator can put a poster up${uploaded.error ? ` — ${uploaded.error.message}` : ""}`);

  const publicUrl = service.storage.from("marathon-posters").getPublicUrl(posterPath).data.publicUrl;
  const fetched = await fetch(publicUrl);
  check(fetched.ok, `and anybody can see it without a signed URL (${fetched.status})`);

  const intruder = await voterClient.storage.from("marathon-posters")
    .upload(`${campaignId}/mine-${stamp}.txt`, new Blob(["yo‘q"], { type: "text/plain" }));
  check(Boolean(intruder.error), "but an ordinary account cannot put anything there");
  await service.storage.from("marathon-posters").remove([posterPath]);
  console.log("\nSaqlanish qonuni:");
  // §33: votes are not created. Every row in the ledger is either one of an
  // account's two direct votes or a transfer of somebody else's — so the total
  // can never exceed twice the number of accounts that have ever held an
  // allowance in this campaign, and the direct half can never exceed two per
  // account.
  const allRows = await service.from("marathon_vote_ledger")
    .select("voter_id,kind,source").eq("campaign_id", campaignId);
  const ledger = allRows.data ?? [];
  const voters = new Set(ledger.map((row) => row.voter_id));
  const direct = ledger.filter((row) => row.source === "direct");
  const perVoter = new Map();
  for (const row of direct) {
    const key = `${row.voter_id}:${row.kind}`;
    perVoter.set(key, (perVoter.get(key) ?? 0) + 1);
  }
  check([...perVoter.values()].every((count) => count === 1),
    "nobody cast the same kind of direct vote twice");
  check(direct.length <= voters.size * 2,
    `direct votes never exceed the allowance that produced them (${direct.length} ≤ ${voters.size * 2})`);
  // The buyer's side of it: what a completed sale put in the ledger is exactly
  // what was sold, no more. (The rows inserted directly above, to prove the
  // unique index does not bind a transfer, have no sale behind them and are
  // deliberately not counted here.)
  const boughtRows = await service.from("marathon_vote_ledger")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId).eq("candidate_id", people.caster.id).eq("source", "marketplace");
  const sold = await service.from("marathon_vote_sales")
    .select("quantity").eq("campaign_id", campaignId).eq("buyer_id", people.caster.id).eq("status", "released");
  const soldTotal = (sold.data ?? []).reduce((total, row) => total + Number(row.quantity), 0);
  check((boughtRows.count ?? 0) === soldTotal,
    `a completed sale puts exactly what was sold into the ledger (${boughtRows.count} = ${soldTotal})`);

  const escrowed = await service.from("marathon_vote_sales")
    .select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "escrow");
  check((escrowed.count ?? 0) === 0,
    `no sale is left holding votes nobody paid for (${escrowed.count ?? 0})`);

  console.log("\nAdmin boshqaruvi:");
  const adminEntry = { email: `mar-admin-${randomUUID()}@example.test`, username: `adm${stamp}` };
  await makeUser(adminEntry);
  people.admin = adminEntry;
  await service.from("user_roles").insert({ user_id: adminEntry.id, role: "admin" });
  const admin = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminIn = await admin.auth.signInWithPassword({ email: adminEntry.email, password });
  if (adminIn.error) throw adminIn.error;

  const outsiderView = await voterClient.rpc("admin_marathon_overview");
  check(outsiderView.data === null, "an ordinary account sees no console data");
  const outsiderWrite = await voterClient.rpc("admin_save_marathon_campaign", { p_title: "Yo‘q" });
  check(Boolean(outsiderWrite.error), "and cannot write a campaign");

  // §30: everything editable while the feature is invisible.
  await service.from("app_settings").update({ value: false }).eq("key", "student_marathon_enabled");
  const draft = await admin.rpc("admin_save_marathon_campaign", {
    p_title: `Qoralama ${stamp}`,
    p_description: "Sinov",
    p_starts_at: new Date(Date.now() - 60_000).toISOString(),
    p_ends_at: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  });
  check(!draft.error && draft.data?.status === "draft",
    `an administrator writes a campaign while the marathon is switched off${draft.error ? ` — ${draft.error.message}` : ""}`);
  draftId = draft.data?.id ?? null;

  const ladder = await admin.rpc("admin_set_marathon_tiers", {
    p_campaign_id: draftId,
    p_tiers: [
      { votes_required: 1000, premium_required: 300, reward_percent: 25 },
      { votes_required: 2000, premium_required: 600, reward_percent: 50 },
    ],
  });
  check(!ladder.error, `and its reward ladder${ladder.error ? ` — ${ladder.error.message}` : ""}`);

  const stillDark = await service.from("app_settings").select("value").eq("key", "student_marathon_enabled").single();
  check(stillDark.data?.value === false, "none of which turned the feature on");

  const noPoster = await admin.rpc("admin_launch_marathon", { p_campaign_id: draftId });
  check(Boolean(noPoster.error) && /Afisha/.test(noPoster.error?.message ?? ""),
    `a campaign with no poster cannot be launched (${noPoster.error?.message?.slice(0, 32) ?? "allowed"})`);

  await admin.rpc("admin_save_marathon_campaign", {
    p_id: draftId, p_title: `Qoralama ${stamp}`, p_poster_path: `${draftId}/poster.jpg`,
  });

  const clash = await admin.rpc("admin_launch_marathon", { p_campaign_id: draftId });
  check(Boolean(clash.error) && /davom etmoqda/.test(clash.error?.message ?? ""),
    "and two marathons cannot run at once");

  await service.from("marathon_campaigns").update({ status: "ended" }).eq("id", campaignId);
  const launched = await admin.rpc("admin_launch_marathon", { p_campaign_id: draftId, p_reason: "smoke" });
  check(!launched.error, `launching works once the way is clear${launched.error ? ` — ${launched.error.message}` : ""}`);

  const nowVisible = await service.from("app_settings").select("value").eq("key", "student_marathon_enabled").single();
  check(nowVisible.data?.value === true, "and that — an administrator pressing it — is what makes the app show the marathon");

  const ended = await admin.rpc("admin_end_marathon", { p_campaign_id: draftId });
  check(!ended.error, `ending works${ended.error ? ` — ${ended.error.message}` : ""}`);
  const darkAgain = await service.from("app_settings").select("value").eq("key", "student_marathon_enabled").single();
  check(darkAgain.data?.value === false, "and takes the marathon off the app with it");

  const auditRows = await service.from("admin_audit_logs").select("action")
    .in("action", ["marathon.launched", "marathon.ended", "marathon.campaign_saved"])
    .eq("admin_id", adminEntry.id);
  check((auditRows.data ?? []).length >= 3,
    `every one of those is in the audit log (${(auditRows.data ?? []).length})`);

} finally {
  if (previousFlag !== null) {
    await service.from("app_settings").update({ value: previousFlag }).eq("key", "student_marathon_enabled");
  }
  await service.from("marathon_campaigns").delete().eq("id", campaignId);
  if (draftId) await service.from("marathon_campaigns").delete().eq("id", draftId);
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
