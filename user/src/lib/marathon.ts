import { useEffect, useState } from "react";

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
