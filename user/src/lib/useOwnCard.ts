import { useCallback, useState } from "react";

import { myMembership } from "@/lib/subscription";
import { supabase } from "@/lib/supabase";
import { tierOf, type Tier } from "@/lib/tier";
import { useFocusRefresh } from "@/lib/useFocusRefresh";
import { useAuth } from "@/providers/AuthProvider";

export type OwnCard = {
  name: string; username: string; bio: string; study: string; avatarUrl: string | null; initials: string;
  tier: Tier; planName: string | null; decks: number; games: number; coins: number;
};

/**
 * One's own profile card, as Profil shows it: name, handle, a line, study,
 * plan, and the three figures — read for the chat, which opens the same card.
 */
export function useOwnCard(): OwnCard | null {
  const { user } = useAuth();
  const [card, setCard] = useState<OwnCard | null>(null);
  const load = useCallback(async () => {
    if (!user) return;
    const [profile, wallet, membership, decks, games] = await Promise.all([
      supabase.from("profiles").select("first_name,last_name,full_name,username,bio,avatar_url,organization,field_of_study").eq("id", user.id).single(),
      supabase.from("credit_wallets").select("balance").eq("user_id", user.id).single(),
      myMembership().catch(() => null),
      supabase.from("presentations").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
      supabase.from("games").select("id", { count: "exact", head: true }).eq("owner_id", user.id).neq("kind", "mafia"),
    ]);
    const row = profile.data;
    const name = [row?.first_name, row?.last_name].filter(Boolean).join(" ") || row?.full_name || "";
    setCard({
      name,
      username: row?.username ?? "",
      bio: row?.bio ?? "",
      study: [row?.organization, row?.field_of_study].filter(Boolean).join(" · "),
      avatarUrl: row?.avatar_url ?? null,
      initials: name.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase(),
      tier: tierOf(membership?.member ? membership.planCode : null, Boolean(membership?.member)),
      planName: membership?.member ? membership.planName : null,
      decks: decks.count ?? 0,
      games: games.count ?? 0,
      coins: wallet.data?.balance ?? 0,
    });
  }, [user]);
  useFocusRefresh(useCallback(() => { void load(); }, [load]));
  return card;
}
