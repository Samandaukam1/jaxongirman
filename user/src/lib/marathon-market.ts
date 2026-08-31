import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import { clientPlatform } from "@/providers/PaymentPolicyProvider";

/**
 * The vote market, from the client's side.
 *
 * Every figure here comes back from the server: the floor a price has to clear,
 * the fee each side pays, the total a buyer is charged. Nothing on this side
 * computes money — a client that worked out 12% itself would be a second answer
 * to a question the server already answers, and the two would drift.
 */

/** A lot as a buyer sees it. There is deliberately no seller in this shape. */
export type VoteLot = {
  listing_id: string;
  kind: "free" | "premium";
  remaining: number;
  unit_price: number;
  buyer_fee: number;
  buyer_total: number;
  /** Your own lot, shown so you are not offered your own votes. */
  is_mine: boolean;
};

/** What a seller has sold, with no buyer in it. */
export type VoteSale = {
  sale_id: string;
  kind: "free" | "premium";
  quantity: number;
  unit_price: number;
  seller_fee: number;
  seller_net: number;
  status: "escrow" | "released" | "refunded";
  created_at: string;
};

/** The arithmetic of a lot, as the server does it. */
export type VoteQuote = {
  base_price: number;
  unit_price: number;
  quantity: number;
  buyer_fee_rate: number;
  buyer_fee_amount: number;
  buyer_total: number;
  seller_fee_rate: number;
  seller_fee_amount: number;
  seller_net: number;
};

/**
 * Whether the market is open.
 *
 * Its own switch under the marathon's, so the campaign can run with the market
 * shut — which is how it will start. Closed until told otherwise, like every
 * other flag in this feature.
 */
export function useVoteMarketEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("app_settings")
      .select("key,value")
      .in("key", ["student_marathon_enabled", "marathon.vote_marketplace_enabled"])
      .then(({ data }) => {
        if (cancelled) return;
        const rows = data ?? [];
        const on = (key: string) => rows.find((row) => row.key === key)?.value === true;
        setEnabled(on("student_marathon_enabled") && on("marathon.vote_marketplace_enabled"));
      });
    return () => { cancelled = true; };
  }, []);

  return enabled;
}

export async function voteMarket(kind?: "free" | "premium"): Promise<VoteLot[]> {
  const { data, error } = await supabase.rpc("marathon_vote_market", {
    p_kind: kind ?? undefined,
  });
  if (error) throw error;
  return (data ?? []) as VoteLot[];
}

export async function voteQuote(unitPrice: number, quantity: number): Promise<VoteQuote> {
  const { data, error } = await supabase.rpc("marathon_vote_quote", {
    p_unit_price: unitPrice,
    p_quantity: quantity,
  });
  if (error) throw error;
  return data as unknown as VoteQuote;
}

export async function minVotePrice(campaignId: string, kind: "free" | "premium"): Promise<number> {
  const { data, error } = await supabase.rpc("marathon_min_vote_price", {
    p_campaign_id: campaignId,
    p_kind: kind,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function listVotes(kind: "free" | "premium", quantity: number, unitPrice: number): Promise<void> {
  const { error } = await supabase.rpc("marathon_list_votes", {
    p_kind: kind,
    p_quantity: quantity,
    p_unit_price: unitPrice,
  });
  if (error) throw error;
}

export async function cancelVoteListing(listingId: string): Promise<void> {
  const { error } = await supabase.rpc("marathon_cancel_vote_listing", { p_listing_id: listingId });
  if (error) throw error;
}

export async function myVoteSales(): Promise<VoteSale[]> {
  const { data, error } = await supabase.rpc("marathon_my_vote_sales", {});
  if (error) throw error;
  return (data ?? []) as VoteSale[];
}

/**
 * Starting a purchase.
 *
 * Returns the order to pay, which is the same order every other purchase in the
 * app produces — the checkout screen has never needed to know what it is for.
 */
export async function buyVotes(listingId: string, quantity = 1): Promise<{ order_id: string; total_amount: number }> {
  const { data, error } = await supabase.rpc("marathon_buy_votes", {
    p_listing_id: listingId,
    p_quantity: quantity,
    p_platform: clientPlatform,
  });
  if (error) throw error;
  return data as unknown as { order_id: string; total_amount: number };
}
