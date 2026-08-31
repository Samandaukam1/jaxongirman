import { useCallback, useEffect, useState } from "react";

import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

/**
 * Whether the student marathon is showing.
 *
 * One switch, read from the settings table the operator controls, and false
 * until it says otherwise. Everything the marathon adds to the app — five
 * entry points, a poster, a section on the profile — is drawn only when this
 * answers true, so the feature can sit finished and invisible for as long as
 * we like.
 *
 * The default matters more than the query: a screen that waits for this before
 * drawing anything is a screen that stays blank if the answer never arrives.
 * It starts closed and opens when told.
 */
export function useMarathonEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("app_settings")
      .select("value")
      .eq("key", "student_marathon_enabled")
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setEnabled(data?.value === true);
      });
    return () => { cancelled = true; };
  }, []);

  return enabled;
}

/** A candidate as the search returns them: enough to recognise, no more. */
export type MarathonCandidate = {
  user_id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  total_votes: number;
  premium_votes: number;
};

export type MarathonVoteKind = "free" | "premium";

/** What this person still has to give, as the ledger sees it. */
export type MarathonVotes = {
  campaign_id: string | null;
  free_available: number;
  premium_available: number;
};

/**
 * Candidates, by username.
 *
 * The leading `@` is how people type a username and is not part of one, so it
 * is stripped here as well as in SQL — a search that returns nothing because
 * of a character the placeholder invited is a search that looks broken.
 */
export async function searchCandidates(query: string, limit = 20): Promise<MarathonCandidate[]> {
  const term = query.trim().replace(/^@+/, "");
  if (!term) return [];
  const { data, error } = await supabase.rpc("marathon_search_candidates", {
    p_query: term,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as MarathonCandidate[];
}

export async function myVotes(): Promise<MarathonVotes> {
  const { data, error } = await supabase.rpc("marathon_my_votes");
  if (error) throw error;
  return (data ?? { campaign_id: null, free_available: 0, premium_available: 0 }) as MarathonVotes;
}

/**
 * One vote. Every rule is checked in the database, so what comes back here is
 * either a recorded vote or a sentence explaining why there is not one.
 */
export async function castVote(candidateId: string, kind: MarathonVoteKind) {
  const { data, error } = await supabase.rpc("marathon_cast_vote", {
    p_candidate_id: candidateId,
    p_kind: kind,
  });
  if (error) throw error;
  return data as { vote_id: string; kind: MarathonVoteKind; candidate_total: number; candidate_premium: number };
}

/** What a candidate answered at a milestone, and when. */
export type MarathonDecision = {
  position: number;
  decision: "claim" | "continue";
  decided_at: string;
};

export type MarathonTier = {
  position: number;
  votes_required: number;
  premium_required: number;
  reward_percent: number;
};

/** The running campaign and where this person stands in it, in one answer. */
export type MarathonCampaign = {
  id: string;
  title: string;
  description: string;
  rules: string;
  poster_path: string | null;
  starts_at: string;
  ends_at: string;
  /** The server's own clock at the moment it answered, so a wrong phone cannot end the campaign early. */
  server_now: string;
  contract_cap: number;
  joined: boolean;
  total_votes: number;
  premium_votes: number;
  tiers: MarathonTier[];
  decisions: MarathonDecision[];
};

export async function activeCampaign(): Promise<MarathonCampaign | null> {
  const { data, error } = await supabase.rpc("marathon_active_campaign");
  if (error) throw error;
  return (data ?? null) as MarathonCampaign | null;
}

export async function joinMarathon(): Promise<void> {
  const { error } = await supabase.rpc("marathon_join");
  if (error) throw error;
}

/**
 * The poster's public URL.
 *
 * Public because a poster is marketing art every user sees, and signing a URL
 * for that costs a round trip and protects nothing.
 */
export function posterUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from("marathon-posters").getPublicUrl(path).data.publicUrl;
}

/**
 * The campaign clock, corrected for a wrong phone.
 *
 * The end time is the server's and so is the moment it was read, so the gap
 * between that moment and the device's own clock is the device's error — and
 * a phone whose date is a day out would otherwise be told the marathon is
 * over. The device is still what ticks between renders; it is only never the
 * thing the deadline is measured against.
 */
export function serverSkew(campaign: Pick<MarathonCampaign, "server_now">, received = Date.now()): number {
  const server = new Date(campaign.server_now).getTime();
  return Number.isFinite(server) ? server - received : 0;
}

/**
 * The running campaign, loaded once and shared by everything that draws it.
 *
 * The home poster, the profile card and `/marathon` all show the same three
 * numbers, and three screens each fetching them is three chances to disagree
 * about how many votes somebody has. It also measures the device's clock error
 * on every load, so the countdown every one of them draws is the same
 * countdown.
 */
export function useMarathonCampaign(): {
  campaign: MarathonCampaign | null;
  loading: boolean;
  error: string | null;
  /** Milliseconds to add to `Date.now()` to get the server's clock. */
  skew: number;
  reload: () => Promise<void>;
  join: () => Promise<void>;
  joining: boolean;
} {
  const enabled = useMarathonEnabled();
  const { user } = useAuth();
  const [campaign, setCampaign] = useState<MarathonCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  // State rather than a ref: the countdown is drawn from it, so a correction
  // that arrives after the first render has to redraw the clock.
  const [skew, setSkew] = useState(0);

  const reload = useCallback(async () => {
    if (!enabled) { setCampaign(null); return; }
    try {
      const asked = Date.now();
      const row = await activeCampaign();
      if (row) setSkew(serverSkew(row, asked));
      setCampaign(row);
      setError(null);
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }, [enabled]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void reload().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reload]);

  /**
   * A vote arriving moves these numbers without anybody pulling to refresh.
   *
   * Subscribed to the person's own notifications rather than to the ledger:
   * the ledger is deliberately unreadable to the candidate — it would name who
   * voted — so realtime would deliver them nothing. Every marathon event
   * already writes a notification in the same transaction as the thing it
   * announces, which makes it the one signal that is both visible and exactly
   * as timely as the write.
   */
  useEffect(() => {
    if (!enabled || !user) return;
    const channel = supabase
      .channel(`marathon-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const kind = (payload.new as { kind?: string }).kind ?? "";
          if (kind.startsWith("marathon")) void reload();
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, reload, user]);

  const join = useCallback(async () => {
    setJoining(true);
    try {
      await joinMarathon();
      await reload();
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setJoining(false);
    }
  }, [reload]);

  return { campaign, loading, error, skew, reload, join, joining };
}

/** How far along a milestone is, counted by whichever of its two demands is behind. */
export function tierProgress(tier: MarathonTier, campaign: MarathonCampaign): number {
  const votes = tier.votes_required > 0 ? campaign.total_votes / tier.votes_required : 1;
  const premium = tier.premium_required > 0 ? campaign.premium_votes / tier.premium_required : 1;
  return Math.max(0, Math.min(1, Math.min(votes, premium)));
}

/** A milestone counts only when both of its demands are met. */
export function tierReached(tier: MarathonTier, campaign: MarathonCampaign): boolean {
  return campaign.total_votes >= tier.votes_required && campaign.premium_votes >= tier.premium_required;
}

/** The milestone being worked toward, or null once they are all behind. */
export function nextTierOf(campaign: MarathonCampaign): MarathonTier | null {
  return campaign.tiers.find((tier) => !tierReached(tier, campaign)) ?? null;
}

/** A candidate as a share link identifies them: enough to recognise, no more. */
export type MarathonInvitedCandidate = {
  user_id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  campaign_id: string;
  campaign_title: string;
  poster_path: string | null;
  ends_at: string;
  server_now: string;
};

/**
 * Who a share link points at.
 *
 * Answers null for a link that has outlived its campaign, so a screen opened
 * from an old QR can say the link is stale instead of drawing an empty card.
 */
export async function invitedCandidate(campaignId: string, candidateId: string): Promise<MarathonInvitedCandidate | null> {
  const { data, error } = await supabase.rpc("marathon_candidate", {
    p_campaign_id: campaignId,
    p_user_id: candidateId,
  });
  if (error) throw error;
  return (data ?? null) as MarathonInvitedCandidate | null;
}

/**
 * Taking a milestone's reward, or giving it up for the next one.
 *
 * Both are irreversible and both are checked again in SQL — the screen decides
 * what to offer, never whether it was allowed.
 */
export async function decideMilestone(position: number, decision: "claim" | "continue"): Promise<void> {
  const { error } = await supabase.rpc("marathon_decide_milestone", {
    p_position: position,
    p_decision: decision,
  });
  if (error) throw error;
}

/**
 * The milestone a candidate owes an answer on, if any.
 *
 * Only rungs above the last one they answered, and the highest of those: a
 * candidate who blew past two milestones without opening the app should be
 * offered the better of them, not walked back through a reward they have
 * already outgrown. A claim ends the ladder, so after one there is nothing
 * left to ask.
 */
export function pendingMilestone(campaign: MarathonCampaign): MarathonTier | null {
  if (!campaign.joined) return null;
  if (campaign.decisions.some((decision) => decision.decision === "claim")) return null;
  const answered = campaign.decisions.reduce((highest, decision) => Math.max(highest, decision.position), 0);
  const open = campaign.tiers.filter((tier) => tier.position > answered && tierReached(tier, campaign));
  return open.length > 0 ? open[open.length - 1]! : null;
}

/** The rung a candidate would be continuing toward, if there is one. */
export function tierAfter(campaign: MarathonCampaign, position: number): MarathonTier | null {
  return campaign.tiers.find((tier) => tier.position > position) ?? null;
}

/** The reward a candidate has already asked for, once they have asked. */
export function claimedTier(campaign: MarathonCampaign): MarathonTier | null {
  const claim = campaign.decisions.find((decision) => decision.decision === "claim");
  return claim ? campaign.tiers.find((tier) => tier.position === claim.position) ?? null : null;
}
