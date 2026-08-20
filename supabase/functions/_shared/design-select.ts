/**
 * Which design, and which of its pages.
 *
 * A written design is a handful of archetypes chosen by what a slide *is* — a
 * quote page for a quote — and that is enough when there are six of them. A
 * template family is twenty-five pages that were composed as a sequence: an
 * opening, several ways of explaining, a way of comparing, a conclusion, a
 * sign-off. Picking ten of those by shape alone produces a deck with five
 * openings and no ending, which is the failure this file exists to prevent.
 *
 * Three questions, in the order they are asked:
 *
 *   1. Which family suits this subject? Scored against a closed taxonomy, so a
 *      match is a match rather than two spellings of one idea.
 *   2. What should each slide of the deck be doing? A story, planned across the
 *      whole deck rather than decided one slide at a time.
 *   3. Which page of the family does that job here? Chosen with what the
 *      neighbouring slides already used, because repetition is a property of
 *      the sequence and invisible to anything looking at one slide.
 *
 * Pure: no Deno, no database, no model. The pipeline supplies rows and this
 * decides, so every rule below is covered by `node --test`.
 */

import type { StoryRole } from "./pptx-classify.ts";
import type { WritableSlot } from "./pptx-writer.ts";

/* ------------------------------------------------------------ normalising */

/**
 * One spelling of a word, whatever it arrived as.
 *
 * Uzbek writes `o‘` with at least four different marks depending on the
 * keyboard — U+2018, U+02BB, a plain apostrophe, a backtick — and a topic table
 * that stores one of them matches a deck that typed another only by luck. The
 * marks are dropped rather than normalised to a single one, so every spelling
 * of `oʻzbekiston` collapses onto the same key.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʻʼ'`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type Topic = {
  slug: string;
  label: string;
  /** Every other name the subject answers to, in any language it arrives in. */
  synonyms: readonly string[];
};

/**
 * The subjects a piece of text is about.
 *
 * Matched on whole words: `bio` must not claim a deck about `biografiya`, and
 * substring matching is how that happens. A term of one or two letters is
 * ignored outright — it would match everything and mean nothing.
 */
export function matchTopics(text: string, taxonomy: readonly Topic[]): Map<string, number> {
  const haystack = ` ${normalise(text)} `;
  const found = new Map<string, number>();
  for (const topic of taxonomy) {
    // The topic's own name is worth more than a synonym: a deck that says
    // "kardiologiya" is about cardiology more certainly than one saying "yurak".
    const terms: [string, number][] = [
      [topic.label, 3],
      [topic.slug.replace(/-/g, " "), 3],
      ...topic.synonyms.map((term) => [term, 2] as [string, number]),
    ];
    let best = 0;
    for (const [term, weight] of terms) {
      const needle = normalise(term);
      if (needle.length < 3) continue;
      if (haystack.includes(` ${needle} `)) best = Math.max(best, weight);
    }
    if (best > 0) found.set(topic.slug, best);
  }
  return found;
}

/* --------------------------------------------------------------- families */

export type DesignCandidate = {
  id: string;
  slug: string;
  /** `{keyword, score}` as the column stores them. */
  keywords: readonly { keyword: string; score: number }[];
  /**
   * How many pages the family has, or 0 when the caller did not count.
   *
   * Zero means unknown rather than empty — a published design always has
   * archetypes — so it scores the middle of the range instead of last. A
   * catalogue listing that skipped the expensive column must not thereby rank
   * every written design below every template.
   */
  pages: number;
  /** Featured designs win ties, which is what the flag is for. */
  featured?: boolean;
};

export type DesignRank = { id: string; score: number; matched: string[] };

/**
 * How well each family suits the subject.
 *
 * A design claiming a subject at 100 must beat one claiming it at 50 by a wide
 * margin, so the design's own confidence multiplies the match's weight rather
 * than being added to it. A family that claims nothing scores above zero on
 * size alone: a neutral design is still usable, and a catalogue where nothing
 * matches must still answer.
 */
export function rankDesigns(
  candidates: readonly DesignCandidate[],
  wanted: ReadonlyMap<string, number>,
): DesignRank[] {
  return candidates
    .map((candidate) => {
      const matched: string[] = [];
      let score = 0;
      for (const claim of candidate.keywords) {
        const weight = wanted.get(claim.keyword);
        if (weight === undefined) continue;
        matched.push(claim.keyword);
        score += (Math.max(0, Math.min(100, claim.score)) / 100) * weight * 10;
      }
      // Range is worth a little on its own: a family of twenty pages can answer
      // a story a family of four has to repeat itself through.
      score += candidate.pages > 0 ? Math.min(6, candidate.pages / 4) : 3;
      if (candidate.featured) score += 1;
      return { id: candidate.id, score: Math.round(score * 100) / 100, matched };
    })
    .sort((first, second) =>
      second.score - first.score || (first.id < second.id ? -1 : 1));
}

/* ------------------------------------------------------------------ story */

/** What a written slide's own purpose implies about its job in the talk. */
const ROLE_BY_PURPOSE: Record<string, StoryRole> = {
  cover: "welcome",
  agenda: "agenda",
  section: "overview",
  quote: "quote",
  statistics: "big_number",
  chart: "chart",
  table: "table",
  timeline: "timeline",
  comparison: "comparison",
  process: "process",
  full_image: "image_story",
  references: "references",
  thank_you: "thanks",
  conclusion: "conclusion",
};

/**
 * The shape of an explanation, in the order an explanation takes.
 *
 * Used for the slides whose purpose says nothing about their job — most of a
 * deck is `title_content` — so that the middle of a talk progresses instead of
 * being eight interchangeable pages.
 */
const NARRATIVE: readonly StoryRole[] = [
  "introduction", "overview", "importance", "key_concepts", "types",
  "structure", "methods", "analysis", "examples", "applications",
  "challenges", "solutions", "results", "recommendations",
];

/**
 * What each slide of this deck is doing.
 *
 * Planned across the whole deck rather than per slide, because the answer for
 * slide four depends on how many slides there are: in a deck of six the middle
 * is one explanation, and in a deck of twenty it is a sequence of them.
 */
export function planStory(purposes: readonly string[]): StoryRole[] {
  const total = purposes.length;
  const plan: StoryRole[] = [];
  // The narrative roles are spread over however many unclaimed slides there
  // are, so a short deck takes the opening of the sequence and a long one walks
  // the whole of it rather than repeating the first few.
  const unclaimed = purposes.filter((purpose, index) =>
    index > 0 && index < total - 1 && !ROLE_BY_PURPOSE[purpose]).length;
  let taken = 0;

  purposes.forEach((purpose, index) => {
    const known = ROLE_BY_PURPOSE[purpose];
    if (index === 0) { plan.push(known ?? "welcome"); return; }
    if (known) { plan.push(known); return; }
    if (index === total - 1) { plan.push("conclusion"); return; }

    const step = unclaimed <= 1
      ? 0
      : Math.round((taken / (unclaimed - 1)) * (NARRATIVE.length - 1));
    plan.push(NARRATIVE[Math.min(NARRATIVE.length - 1, step)]!);
    taken += 1;
  });

  return plan;
}

/* ------------------------------------------------------------------ pages */

export type PageProfile = {
  archetypeId: string;
  role: StoryRole;
  alternativeRoles: readonly StoryRole[];
  recommendedStoryPosition: number;
  layoutSignature: string;
  isTerminal: boolean;
  supportsImage: boolean;
  supportsChart: boolean;
  supportsTable: boolean;
  supportsQuote: boolean;
  supportsStats: boolean;
  minText: number;
  maxText: number;
  /**
   * The source slide this page is, where the design came from a file.
   *
   * Nothing in this module reads them — selection is about what a page can
   * hold, not where it came from. They travel with the profile because the
   * generator needs the same rows to know which slide to clone and which boxes
   * to write into, and carrying them here saves a second query for the same
   * table on the same request.
   */
  sourcePart?: string;
  sourceIndex?: number;
  slots?: readonly WritableSlot[];
};

/** What the slide needs a page to be able to hold. */
export type SlideNeeds = {
  purpose: string;
  textVolume: number;
  hasImage: boolean;
};

export type PageChoice = { archetypeId: string; substituted: boolean };

function canHold(page: PageProfile, needs: SlideNeeds): boolean {
  if (needs.purpose === "chart" && !page.supportsChart) return false;
  if (needs.purpose === "table" && !page.supportsTable) return false;
  if (needs.purpose === "statistics" && !page.supportsStats) return false;
  if (needs.purpose === "quote" && !page.supportsQuote) return false;
  return needs.textVolume >= page.minText && needs.textVolume <= page.maxText;
}

/**
 * No source slide twice inside this many slides.
 *
 * A deck built from a template is built out of that template's real pages, and
 * a reader recognises a page they saw two slides ago instantly — the design
 * stops reading as a design and starts reading as one slide repeated, which is
 * the complaint this exists to answer.
 *
 * Seven is a person's sense of "recently" in a deck rather than a measured
 * constant. It is also a ceiling, not a promise: a family with four pages
 * cannot put seven between repeats, so the window narrows to what the family
 * can actually deliver and the pages simply rotate.
 */
export const PAGE_REPEAT_WINDOW = 7;

/**
 * Which page of the family does each slide's job.
 *
 * Scored rather than filtered, because every constraint here is a preference
 * and a deck must come out the other side regardless. A page that matches the
 * role outright beats one that lists it as an alternative; a page whose
 * suggested position is near this slide's beats one composed for the other end
 * of a talk; and a composition used two slides ago loses to one that was not.
 *
 * One thing is not a preference. A page used inside the last few slides is
 * removed from the running rather than penalised, because a penalty is a number
 * that a strong enough role match beats — and it did, which is how a deck ended
 * up showing the same source slide three times while every individual choice
 * looked reasonable. The window narrows to the number of pages actually
 * available for a slide, so the pool it leaves is never empty: at most
 * `window - 1` pages can be blocked and there are at least `window` to choose
 * from.
 *
 * Terminal pages are held back for the last slide. A sign-off in the middle is
 * the single most obviously wrong thing a page selector can do.
 */
export function selectPages(
  profiles: readonly PageProfile[],
  plan: readonly StoryRole[],
  needs: readonly SlideNeeds[],
  options: {
    /**
     * Pages already decided, by slide.
     *
     * A template deck's copy is written box by box for one specific source
     * slide, so once a slide has been written its page cannot change — the
     * words would go to shape ids that are not on the page being cloned. Those
     * choices are taken as given and, importantly, counted: the slides still
     * free are spaced against them rather than against a second, different
     * selection nobody kept.
     */
    fixed?: readonly (string | null | undefined)[];
  } = {},
): PageChoice[] {
  if (profiles.length === 0) return [];

  const chosen: PageChoice[] = [];
  const recent: string[] = [];
  const usedCount = new Map<string, number>();
  /** The slide each page was last used on, for the window. */
  const usedAt = new Map<string, number>();
  const byId = new Map(profiles.map((page) => [page.archetypeId, page]));

  const remember = (page: PageProfile, index: number) => {
    recent.push(page.layoutSignature);
    if (recent.length > 3) recent.shift();
    usedCount.set(page.archetypeId, (usedCount.get(page.archetypeId) ?? 0) + 1);
    usedAt.set(page.archetypeId, index);
  };

  plan.forEach((wanted, index) => {
    const slide = needs[index] ?? { purpose: "title_content", textVolume: 0, hasImage: false };
    const last = index === plan.length - 1;

    const settled = byId.get(String(options.fixed?.[index] ?? ""));
    if (settled) {
      chosen.push({ archetypeId: settled.archetypeId, substituted: settled.role !== wanted });
      remember(settled, index);
      return;
    }

    const eligible = profiles.filter((page) => (page.isTerminal ? last : true));
    // What "recently" means for this family, which may have fewer pages than
    // the window is wide.
    const window = Math.max(1, Math.min(PAGE_REPEAT_WINDOW, eligible.length));
    const fresh = eligible.filter((page) => {
      const at = usedAt.get(page.archetypeId);
      return at === undefined || index - at >= window;
    });

    const scored = (fresh.length > 0 ? fresh : eligible)
      .map((page) => {
        let score = 0;
        if (page.role === wanted) score += 100;
        else if (page.alternativeRoles.includes(wanted)) score += 60;

        if (canHold(page, slide)) score += 30;
        if (slide.hasImage && page.supportsImage) score += 12;
        if (!slide.hasImage && page.supportsImage) score -= 6;

        // Where this page was composed to sit, against where this slide is.
        const here = plan.length <= 1 ? 1 : 1 + (index / (plan.length - 1)) * 17;
        const there = page.recommendedStoryPosition >= 999 ? 18 : page.recommendedStoryPosition;
        score -= Math.min(20, Math.abs(here - there) * 1.5);

        // Two slides is how far back a repeated composition still reads as one.
        const seenAt = recent.lastIndexOf(page.layoutSignature);
        if (seenAt >= 0) score -= (recent.length - seenAt) === 1 ? 25 : 12;
        score -= (usedCount.get(page.archetypeId) ?? 0) * 8;

        return { page, score };
      })
      .sort((first, second) =>
        second.score - first.score
        || (first.page.archetypeId < second.page.archetypeId ? -1 : 1));

    const best = scored[0]?.page ?? profiles[0]!;
    chosen.push({ archetypeId: best.archetypeId, substituted: best.role !== wanted });
    remember(best, index);
  });

  return chosen;
}
