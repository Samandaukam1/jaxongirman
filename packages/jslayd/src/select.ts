import { textVolume, type SlideData } from "./content.ts";
import type { Archetype, JslaydDocument } from "./document.ts";
import { LEGACY_LAYOUT_TO_PURPOSE, type ArchetypePurpose } from "./spec.ts";

/**
 * Archetype selection (§42, §45).
 *
 * The writer produces content and a purpose; this picks the slide the design
 * drew for it. Deterministic throughout — same deck in, same layouts out — and
 * variant-aware, so a seven-slide deck that is four `text_image` slides in a
 * row gets `text_image_01`, `_02`, `_03`, `_01` rather than the same
 * composition four times (§41).
 */

export type Selection = {
  archetype: Archetype;
  /** True when nothing matched the requested purpose and a relative was used. */
  substituted: boolean;
};

/**
 * Purposes that can stand in for one another, in order of preference.
 *
 * A design is not required to draw all seventeen archetypes, so the generator
 * has to know which slide is the honest second choice — a `title_content` for a
 * missing `text_image` keeps the deck reading correctly, whereas a `cover`
 * would not.
 */
const SUBSTITUTES: Record<ArchetypePurpose, readonly ArchetypePurpose[]> = {
  cover: ["minimal_cover", "section", "title_content"],
  minimal_cover: ["cover", "section", "title_content"],
  section: ["cover", "title_content"],
  agenda: ["title_content", "features", "two_column"],
  // An introduction and an "about us" are both a paragraph with something
  // beside it; neither is a page a design is likely to draw specially, so both
  // fall to the ordinary text pages rather than to each other first.
  introduction: ["title_content", "text_image", "section"],
  about: ["title_content", "text_image", "features"],

  title_content: ["text_image", "two_column", "image_text"],
  text_image: ["image_text", "title_content", "two_column"],
  image_text: ["text_image", "title_content", "two_column"],
  full_image: ["text_image", "image_text", "section"],
  // Three or four peer cards. `three_column` is the same composition under the
  // name the language used before this one existed.
  features: ["three_column", "two_column", "title_content"],

  statistics: ["kpi_cards", "title_content", "chart", "two_column"],
  // Cards carrying a figure each: several statistics, laid out in a row.
  kpi_cards: ["statistics", "features", "three_column", "title_content"],
  // Several visuals at once. A design with no dashboard draws the chart it has
  // and loses the density, which is better than losing the numbers.
  dashboard: ["chart", "kpi_cards", "statistics", "title_content"],
  chart: ["dashboard", "statistics", "title_content", "two_column"],
  comparison: ["two_column", "table", "title_content"],
  timeline: ["process", "three_column", "title_content"],
  process: ["timeline", "infographic", "three_column", "title_content"],
  // A drawn explanation. Falls to the two page kinds that already sequence
  // things, because an infographic that cannot be drawn is a set of steps.
  infographic: ["process", "timeline", "features", "title_content"],

  // People are pictures with names under them, which is what a gallery is.
  team: ["gallery", "features", "three_column", "title_content"],
  gallery: ["full_image", "three_column", "image_text", "title_content"],
  table: ["two_column", "title_content", "comparison"],
  quote: ["section", "title_content"],

  conclusion: ["section", "title_content", "thank_you"],
  thank_you: ["conclusion", "section", "cover"],

  two_column: ["title_content", "comparison", "three_column"],
  three_column: ["features", "two_column", "title_content"],
  references: ["title_content", "conclusion"],
  custom: ["title_content"],
};

/** The purpose a legacy `LayoutName` maps to, for decks the old writer produced. */
export function purposeForLayout(layout: string): ArchetypePurpose {
  return LEGACY_LAYOUT_TO_PURPOSE[layout] ?? "title_content";
}

/**
 * Picks one archetype per slide.
 *
 * Selection runs over the whole deck at once rather than slide by slide,
 * because avoiding repetition is a property of the sequence: a chooser that
 * only sees one slide has no way to know it already used that composition.
 */
export function selectArchetypes(document: JslaydDocument, slides: readonly SlideData[]): Selection[] {
  const used = new Map<string, number>();
  return slides.map((slide) => {
    const chosen = selectOne(document, slide, used);
    used.set(chosen.archetype.id, (used.get(chosen.archetype.id) ?? 0) + 1);
    return chosen;
  });
}

/**
 * Chooses the archetypes for a deck before a word of it is written.
 *
 * `selectArchetypes` reads the copy — `suits` gates on how much text a slide
 * carries — which is right at render time and impossible at planning time,
 * when the whole reason for choosing early is to know how much to write.
 *
 * So this gates on what is already known: the slide's purpose, and whether the
 * archetype can carry a chart, a table, a statistic or a quotation. The volume
 * band is skipped, because the copy is about to be written to fit whatever this
 * returns rather than the other way round.
 *
 * The caller is expected to carry the result through to `buildJslaydSlides`.
 * Selecting again afterwards would usually land in the same place — the copy
 * was written to this archetype's budget — but "usually" is not a property to
 * build a renderer on.
 */
export function planArchetypes(
  document: JslaydDocument,
  plans: readonly { purpose: ArchetypePurpose; needsChart?: boolean; needsTable?: boolean; needsStats?: boolean; needsQuote?: boolean }[],
): Selection[] {
  const used = new Map<string, number>();

  return plans.map((plan) => {
    const wanted = [plan.purpose, ...(SUBSTITUTES[plan.purpose] ?? [])];

    for (const [rank, purpose] of wanted.entries()) {
      const fitting = document.archetypes.filter((archetype) => {
        if (archetype.purpose !== purpose) return false;
        const rules = archetype.selection;
        if (plan.needsChart && !rules.supportsChart) return false;
        if (plan.needsTable && !rules.supportsTable) return false;
        if (plan.needsStats && !rules.supportsStats) return false;
        if (plan.needsQuote && !rules.supportsQuote) return false;
        return true;
      });
      if (fitting.length > 0) {
        const chosen = pick(fitting, used);
        used.set(chosen.id, (used.get(chosen.id) ?? 0) + 1);
        return { archetype: chosen, substituted: rank > 0 };
      }
    }

    const chosen = document.archetypes[0]!;
    used.set(chosen.id, (used.get(chosen.id) ?? 0) + 1);
    return { archetype: chosen, substituted: true };
  });
}

export function selectOne(document: JslaydDocument, slide: SlideData, used: ReadonlyMap<string, number>): Selection {
  const wanted = [slide.purpose, ...(SUBSTITUTES[slide.purpose] ?? [])];
  for (const [rank, purpose] of wanted.entries()) {
    const fitting = document.archetypes.filter((archetype) => archetype.purpose === purpose && suits(archetype, slide));
    const best = rank === 0 ? fitting : fitting.length ? fitting : [];
    if (best.length > 0) return { archetype: pick(best, used), substituted: rank > 0 };
  }

  // Nothing of the right shape exists. Rather than force content into a slide
  // that cannot hold it, take whatever can hold it, and only then fall back to
  // the design's first archetype so a deck is never left without a slide.
  const anySuitable = document.archetypes.filter((archetype) => suits(archetype, slide));
  if (anySuitable.length > 0) return { archetype: pick(anySuitable, used), substituted: true };
  return { archetype: document.archetypes[0]!, substituted: true };
}

/**
 * Can this archetype carry what the slide is *for*?
 *
 * Only the slide's purpose is binding. A writer fills in a quotation and a
 * figure on most slides whether or not they are the point of one, so treating
 * "carries a quote" as "must display a quote" disqualified almost every
 * archetype and dropped whole decks onto their cover composition. The built-in
 * engine never behaved that way either: it simply does not draw a quote on a
 * timeline, and neither does this.
 */
function suits(archetype: Archetype, slide: SlideData): boolean {
  const rules = archetype.selection;
  if (slide.purpose === "chart" && !rules.supportsChart) return false;
  if (slide.purpose === "table" && !rules.supportsTable) return false;
  if (slide.purpose === "statistics" && !rules.supportsStats) return false;
  if (slide.purpose === "quote" && !rules.supportsQuote) return false;
  const volume = textVolume(slide);
  return volume >= rules.minText && volume <= rules.maxText;
}

/**
 * Highest priority wins; among equals, the least-used variant.
 *
 * The id is the final tiebreak so the choice never depends on the order the
 * archetypes happen to sit in the document — two compiles of one design must
 * lay out a deck identically.
 */
function pick(candidates: readonly Archetype[], used: ReadonlyMap<string, number>): Archetype {
  return [...candidates].sort((first, second) => {
    const byUse = (used.get(first.id) ?? 0) - (used.get(second.id) ?? 0);
    if (byUse !== 0) return byUse;
    const byPriority = second.selection.priority - first.selection.priority;
    if (byPriority !== 0) return byPriority;
    return first.id < second.id ? -1 : 1;
  })[0]!;
}
