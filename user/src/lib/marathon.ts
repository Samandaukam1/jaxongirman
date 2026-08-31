import { useCallback, useEffect, useState } from "react";

import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

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
