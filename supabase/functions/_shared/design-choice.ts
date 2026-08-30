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

import { matchTopics, pickWithRotation, rankDesigns, type DesignCandidate, type Topic } from "./design-select.ts";

export type ChosenDesign = { slug: string; score: number; matched: string[]; repeated: boolean };

/** How many of a person's recent decks a design has to sit out. */
const RECENT_DECKS = 3;

/**
 * The published designs of a tier, ranked against what the deck is about.
 *
 * The taxonomy is read rather than inferred: both sides of the comparison —
 * what a design claims and what a topic is — come from the same closed list, so
 * a match is a match rather than two spellings of one idea.
 */
export async function chooseDesign(
  service: SupabaseClient,
  input: { tier: string; topic: string; userId?: string | null },
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

  /**
   * How much of a title each template's opening page can actually show.
   *
   * One query for the tier rather than one per design, and only the opening
   * pages: a template's cover box is a fixed rectangle built around a word in
   * another language, and a deck whose cover cannot name its own subject is the
   * failure a reader notices first.
   *
   * A design with no profiles is a written one, whose type resizes to what it
   * is given. It is left unmeasured rather than scored as if it were tight.
   */
  const coverRoom = new Map<string, number>();
  const ids = (designs.data ?? []).map((row) => row.id as string);
  if (ids.length > 0) {
    const profiles = await service
      .from("design_slide_profiles")
      .select("design_id, source_index, text_map")
      .in("design_id", ids)
      .lte("source_index", 0);

    for (const profile of profiles.data ?? []) {
      const slots = (profile.text_map as { slots?: unknown[] } | null)?.slots
        ?? (Array.isArray(profile.text_map) ? profile.text_map : []);
      let biggest = 0;
      for (const entry of (slots ?? []) as { role?: unknown; characterCapacity?: unknown; characters?: unknown }[]) {
        const role = String(entry?.role ?? "");
        if (role !== "display" && role !== "title" && role !== "heading") continue;
        const room = Math.max(Number(entry?.characterCapacity) || 0, Number(entry?.characters) || 0);
        if (room > biggest) biggest = room;
      }
      if (biggest > 0) coverRoom.set(profile.design_id as string, biggest);
    }
  }

  const titleLength = input.topic.trim().length;
  const candidates: DesignCandidate[] = (designs.data ?? []).map((row) => ({
    id: row.slug as string,
    slug: row.slug as string,
    keywords: Array.isArray(row.keywords) ? row.keywords as { keyword: string; score: number }[] : [],
    // Counting pages would mean reading every document in the tier to rank
    // them; unknown is scored as the middle of the range instead.
    pages: 0,
    featured: Boolean(row.is_featured),
    ...(coverRoom.has(row.id as string) ? { coverRoom: coverRoom.get(row.id as string), titleLength } : {}),
  }));

  const wanted = matchTopics(input.topic, taxonomy);
  const ranked = rankDesigns(candidates, wanted);
  if (ranked.length === 0) return null;

  /**
   * The same subject should not come back wearing the same design.
   *
   * Ranking is deterministic, so a person generating two decks about one topic
   * — which is exactly what somebody does when the first attempt was not quite
   * right — got the identical composition twice, and reasonably concluded the
   * app has one design. Their own recent decks are read and those designs step
   * aside while anything else suitable exists.
   *
   * A fallback rather than a rule: if every published design in the tier has
   * been used recently, the best match wins anyway. Refusing to make a deck
   * because the catalogue is small would be a worse answer than a repeat.
   */
  const recent = new Set<string>();
  if (input.userId) {
    const bySlug = new Map((designs.data ?? []).map((row) => [row.id as string, row.slug as string]));
    const history = await service
      .from("presentations")
      .select("design_id, created_at")
      .eq("owner_id", input.userId)
      .not("design_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(RECENT_DECKS);
    if (history.error) console.error("design choice: history unreadable", history.error.message);
    for (const row of history.data ?? []) {
      const slug = bySlug.get(row.design_id as string);
      if (slug) recent.add(slug);
    }
  }

  const picked = pickWithRotation(ranked, recent);
  if (!picked) return null;
  return {
    slug: picked.chosen.id,
    score: picked.chosen.score,
    matched: picked.chosen.matched,
    repeated: picked.repeated,
  };
}
