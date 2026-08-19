/**
 * Choosing the design when nobody chose one.
 *
 * "Jaxongir AI tanlaydi" is the default on the phone, which means most decks
 * arrive with a topic and no design. The decision is made here rather than in
 * the RPC, and the slug it produces is passed in exactly as a person's choice
 * would be — so the invariant the RPC exists to hold, that a deck is laid out
 * by a design somebody published and by nothing else, is untouched. The
 * generation records which design it used the same way either way.
 *
 * Failing to choose is not an error: it returns null, and the caller refuses
 * the generation with the same message a person would see for picking nothing.
 * A silent fallback to some arbitrary design is how withdrawn designs used to
 * keep appearing in finished decks.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js";

import { matchTopics, rankDesigns, type DesignCandidate, type Topic } from "./design-select.ts";

export type ChosenDesign = { slug: string; score: number; matched: string[] };

/**
 * The published designs of a tier, ranked against what the deck is about.
 *
 * The taxonomy is read rather than inferred: both sides of the comparison —
 * what a design claims and what a topic is — come from the same closed list, so
 * a match is a match rather than two spellings of one idea.
 */
export async function chooseDesign(
  service: SupabaseClient,
  input: { tier: string; topic: string },
): Promise<ChosenDesign | null> {
  const [designs, topics, synonyms] = await Promise.all([
    service
      .from("presentation_designs")
      .select("id, slug, keywords, is_featured")
      .eq("tier", input.tier)
      .eq("status", "published"),
    service.from("design_topics").select("id, slug, label_uz"),
    service.from("design_topic_synonyms").select("topic_id, term"),
  ]);

  if (designs.error || (designs.data ?? []).length === 0) {
    if (designs.error) console.error("design choice: catalogue unreadable", designs.error.message);
    return null;
  }

  const termsByTopic = new Map<string, string[]>();
  for (const row of synonyms.data ?? []) {
    const list = termsByTopic.get(row.topic_id as string) ?? [];
    list.push(row.term as string);
    termsByTopic.set(row.topic_id as string, list);
  }

  const taxonomy: Topic[] = (topics.data ?? []).map((row) => ({
    slug: row.slug as string,
    label: row.label_uz as string,
    synonyms: termsByTopic.get(row.id as string) ?? [],
  }));

  const candidates: DesignCandidate[] = (designs.data ?? []).map((row) => ({
    id: row.slug as string,
    slug: row.slug as string,
    keywords: Array.isArray(row.keywords) ? row.keywords as { keyword: string; score: number }[] : [],
    // Counting pages would mean reading every document in the tier to rank
    // them; unknown is scored as the middle of the range instead.
    pages: 0,
    featured: Boolean(row.is_featured),
  }));

  const wanted = matchTopics(input.topic, taxonomy);
  const ranked = rankDesigns(candidates, wanted);
  const best = ranked[0];
  if (!best) return null;
  return { slug: best.id, score: best.score, matched: best.matched };
}
