import {
  buildWritingBrief, checkFit, planArchetypes, purposeForLayout,
  type ArchetypeWritingBrief, type JslaydDocument, type SlotFit, type TextSlotBudget,
} from "./jslayd/index.ts";
import { planStory, selectPages, type PageProfile } from "./design-select.ts";
import type { RequiredSlideContent } from "./plan-schema.ts";
import type { StoryRole } from "./pptx-classify.ts";
import type { LayoutName, SemanticSlide } from "./presentation-types.ts";

/**
 * The bridge between a design's geometry and the model that writes into it.
 *
 * Everything here is arithmetic on the chosen design. No model is consulted:
 * which archetype draws a slide, how big its boxes are and how much copy they
 * hold are facts, and a generator that asked an LLM for them would be asking a
 * guess to stand in for a measurement.
 *
 * What the model gets back is small. A full JSLAYD document runs to tens of
 * kilobytes and would be resent for every slide; a deck's worth of briefs is a
 * few kilobytes once, because slides sharing an archetype share its brief.
 */

/** One slide, planned but not yet written. */
export type PlannedSlide = {
  index: number;
  layout: LayoutName;
  title: string;
  purpose: string;
  archetypeId: string;
  /**
   * What this slide is doing in the talk, where the design knows such a thing.
   *
   * Carried to the writer, not only to the renderer: a page composed to state
   * a problem and a page composed to answer one hold the same number of
   * characters and want completely different sentences in them.
   */
  role?: StoryRole;
};

export type DeckLayoutPlan = {
  slides: PlannedSlide[];
  /** Each distinct archetype once, however many slides use it. */
  briefs: ArchetypeWritingBrief[];
};

/**
 * Chooses a composition for every planned slide, before a word is written.
 *
 * The layout the outline asked for decides the purpose; the design decides
 * which of its archetypes serves that purpose best and least recently. What
 * comes back is carried through to the renderer, so the boxes the writer was
 * given are the boxes the copy lands in.
 */
export function planDeckLayout(
  document: JslaydDocument,
  slides: readonly { layout: LayoutName; title: string; purpose: string }[],
  options: { language?: string; profiles?: readonly PageProfile[] } = {},
): DeckLayoutPlan {
  if (options.profiles && options.profiles.length > 0) {
    return planByStory(document, slides, options.profiles, options);
  }

  const selections = planArchetypes(
    document,
    slides.map((slide) => {
      const purpose = purposeForLayout(slide.layout);
      return {
        purpose,
        needsChart: purpose === "chart",
        needsTable: purpose === "table",
        needsStats: purpose === "statistics",
        needsQuote: purpose === "quote",
      };
    }),
  );

  const briefs = new Map<string, ArchetypeWritingBrief>();
  const planned = selections.map((selection, index): PlannedSlide => {
    if (!briefs.has(selection.archetype.id)) {
      briefs.set(selection.archetype.id, buildWritingBrief(document, selection.archetype, options));
    }
    const slide = slides[index]!;
    return {
      index,
      layout: slide.layout,
      title: slide.title,
      purpose: slide.purpose,
      archetypeId: selection.archetype.id,
    };
  });

  return { slides: planned, briefs: [...briefs.values()] };
}

/** Purposes whose composition is built around a picture. */
const PICTORIAL = new Set(["text_image", "image_text", "full_image", "cover"]);

/**
 * The same plan, for a design that knows what its pages are for.
 *
 * The estimate of how much will be written is deliberately crude — nothing has
 * been written yet, which is the entire point of choosing first. It only has to
 * be good enough not to pick a page that cannot hold an ordinary amount of
 * copy; the budgets it produces are then what keeps the copy to that size.
 */
function planByStory(
  document: JslaydDocument,
  slides: readonly { layout: LayoutName; title: string; purpose: string }[],
  profiles: readonly PageProfile[],
  options: { language?: string },
): DeckLayoutPlan {
  const purposes = slides.map((slide) => purposeForLayout(slide.layout));
  const plan = planStory(purposes);
  const choices = selectPages(
    profiles,
    plan,
    purposes.map((purpose) => ({
      purpose,
      textVolume: purpose === "cover" || purpose === "section" || purpose === "thank_you" ? 60 : 320,
      hasImage: PICTORIAL.has(purpose),
    })),
  );

  const byId = new Map(document.archetypes.map((archetype) => [archetype.id, archetype]));
  const briefs = new Map<string, ArchetypeWritingBrief>();
  const planned = slides.map((slide, index): PlannedSlide => {
    const archetype = byId.get(choices[index]?.archetypeId ?? "") ?? document.archetypes[0]!;
    if (!briefs.has(archetype.id)) {
      briefs.set(archetype.id, buildWritingBrief(document, archetype, options));
    }
    return {
      index,
      layout: slide.layout,
      title: slide.title,
      purpose: slide.purpose,
      archetypeId: archetype.id,
      role: plan[index],
    };
  });

  return { slides: planned, briefs: [...briefs.values()] };
}

/* -------------------------------------------------------------- the prompt */

/**
 * The brief as the model reads it.
 *
 * Trimmed to what changes what gets written: the box, the type it is set in,
 * and the budget. A model does not need `letterSpacing` to decide how many
 * words to use, and every field that does not change the answer is tokens spent
 * on every slide of every deck.
 */
function slotLine(slot: TextSlotBudget): Record<string, unknown> {
  return {
    id: slot.elementId,
    field: slot.binding,
    role: slot.role,
    box: `${slot.geometry.width}×${slot.geometry.height}`,
    fontSize: slot.typography.fontSize,
    maxLines: slot.typography.maxLines ?? slot.budget.estimatedLines,
    charsPerLine: slot.budget.estimatedCharactersPerLine,
    min: slot.budget.minimumCharacters,
    aim: slot.budget.preferredCharacters,
    limit: slot.budget.maximumCharacters,
    /**
     * The aim again, in a unit a model can actually count in.
     *
     * Given a character budget the writer produced a quarter of it, run after
     * run; given "three sentences" it writes three sentences. The number is
     * derived from the same budget, so a design with bigger boxes asks for
     * more without anybody maintaining a second set of figures. Only where a
     * floor exists — a caption is not short by mistake.
     */
    ...(slot.budget.minimumCharacters > 0
      ? { sentences: Math.max(1, Math.round(slot.budget.preferredCharacters / 110)) }
      : {}),
    ...(slot.budget.maximumItems === undefined ? {} : { maxItems: slot.budget.maximumItems }),
  };
}

export function briefForPrompt(brief: ArchetypeWritingBrief): Record<string, unknown> {
  return {
    archetype: brief.archetypeId,
    purpose: brief.purpose,
    slots: brief.slots.map(slotLine),
    ...(brief.visualZones.length === 0 ? {} : {
      // Only that a picture is there and how big it is. Copy is written around
      // it; it is not the writer's to move.
      visuals: brief.visualZones.map((zone) => `${zone.type} ${zone.width}×${zone.height}`),
    }),
  };
}

/* ------------------------------------------------------------- validation */

/** Which written field feeds which slot. */
function textFor(slide: SemanticSlide, binding: string): string | null {
  switch (binding) {
    case "title": return slide.title;
    case "subtitle": return slide.subtitle;
    case "body": return slide.body;
    case "bullets": return slide.bullets.join("\n");
    case "quote_text": return slide.quote?.text ?? null;
    case "quote_attribution": return slide.quote?.attribution ?? null;
    case "stat_value": return slide.statistic?.value ?? null;
    case "stat_label": return slide.statistic?.label ?? null;
    case "chart_title": return slide.chart ? slide.title : null;
    case "table_title": return slide.table ? slide.title : null;
    default: return null;
  }
}

/**
 * Preserve useful copy the model put in a field this composition cannot draw.
 *
 * The generic slide schema offers both `body` and `bullets`, while a concrete
 * archetype often offers only one. Before this bridge, four good bullet points
 * could sit in the semantic slide and disappear because the chosen page had a
 * paragraph box; the paragraph then looked empty and repeated rewrites tried
 * to recreate information the model had already supplied. Move, never invent:
 * every word comes from the same slide and the fit pass still trims it against
 * the real destination budget.
 */
export function adaptContentToBrief(slide: SemanticSlide, brief: ArchetypeWritingBrief): SemanticSlide {
  const bindings = new Set(brief.slots.map((slot) => slot.binding));
  const hasBody = bindings.has("body");
  const hasBullets = [...bindings].some((binding) => binding === "bullets" || /^bullet_[1-6]$/.test(binding));

  if (hasBody && !hasBullets && slide.bullets.length > 0) {
    const punctuate = (value: string) => /[.!?…]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;
    const merged = [slide.body?.trim() ?? "", ...slide.bullets.map(punctuate)].filter(Boolean).join(" ");
    return { ...slide, body: merged || null, bullets: [] };
  }

  if (hasBullets && !hasBody && slide.body?.trim()) {
    const additions = slide.body.trim().split(/(?<=[.!?…])\s+/).map((part) => part.trim()).filter(Boolean);
    return { ...slide, body: null, bullets: [...slide.bullets, ...additions] };
  }

  return slide;
}

/**
 * Which semantic field must carry the page's prose.
 *
 * Prefer the archetype's largest real content box, not a generic schema field
 * that the renderer may never read. Chart/table data can make a page speak on
 * their own, so only prose roles participate here.
 */
export function requiredContentForBrief(brief: ArchetypeWritingBrief): RequiredSlideContent | null {
  const candidates = brief.slots
    .filter((slot) => CONTENT_ROLES.has(slot.role) && slot.budget.minimumCharacters > 0)
    .sort((a, b) => b.budget.preferredCharacters - a.budget.preferredCharacters);

  for (const slot of candidates) {
    if (slot.binding === "body") return "body";
    if (slot.binding === "bullets" || /^bullet_[1-6]$/.test(slot.binding)) return "bullets";
    if (slot.binding === "subtitle") return "subtitle";
    if (slot.binding === "quote_text" || slot.binding === "quote_attribution") return "quote";
    if (slot.binding === "stat_value" || slot.binding === "stat_label") return "statistic";
  }
  return null;
}

export type SlotProblem = SlotFit & {
  binding: string;
  role: string;
  /** What to aim for on the rewrite. */
  aim: number;
  /** Which way it is wrong: too much copy, or a box left looking empty. */
  direction: "shorten" | "expand";
  text: string;
};

/**
 * Slots that carry what a slide is actually saying.
 *
 * A design offers more boxes than most slides need and an unused caption is
 * whitespace — but a page whose every content box is empty is a heading over
 * nothing, and a deck of those is what an author is holding when they say the
 * slides have no text on them.
 */
const CONTENT_ROLES = new Set(["body", "bullets", "quote", "statistic_label", "subtitle"]);

/**
 * What does not fit, and by how much.
 *
 * Deliberately not "make the type smaller". Shrinking is the renderer's last
 * resort and it is what produced the eleven-point body text this whole change
 * exists to stop; the first answer to copy that does not fit is less copy.
 *
 * A slot the writer left empty is not a problem — a design offers more boxes
 * than every slide needs, and an empty one is whitespace rather than a hole.
 */
export function findSlotProblems(brief: ArchetypeWritingBrief, slide: SemanticSlide): SlotProblem[] {
  const problems: SlotProblem[] = [];

  /**
   * Whether this page says anything at all.
   *
   * Computed before the loop because it changes what an empty box means: the
   * first content slot on a page with nothing written on it has to be filled,
   * while the third caption on a page that already reads well does not.
   */
  const speaks = Boolean(slide.chart?.values?.length || slide.table?.rows?.length)
    || brief.slots.some((slot) => {
      if (!CONTENT_ROLES.has(slot.role)) return false;
      return Boolean(textFor(slide, slot.binding)?.trim());
    });
  let asked = false;

  for (const slot of brief.slots) {
    const text = textFor(slide, slot.binding);
    const written = text?.trim() ?? "";

    if (!written) {
      // One request per silent page, for the first box that can carry it.
      if (speaks || asked || !CONTENT_ROLES.has(slot.role) || slot.budget.minimumCharacters === 0) continue;
      asked = true;
      problems.push({
        ...checkFit(slot, ""),
        binding: slot.binding,
        role: slot.role,
        aim: slot.budget.preferredCharacters,
        direction: "expand",
        text: "",
      });
      continue;
    }

    const fit = checkFit(slot, written);
    if (fit.fits && fit.shortBy === 0) continue;

    problems.push({
      ...fit,
      binding: slot.binding,
      role: slot.role,
      aim: slot.budget.preferredCharacters,
      // Too long is the louder failure: copy that overflows is cut off on the
      // slide, while copy that is short only looks thin.
      direction: fit.overBy > 0 || fit.orphan ? "shorten" : "expand",
      text: written,
    });
  }

  // Loudest first: a title that does not fit is worth more attention than a
  // caption that does not, and a rewrite request has a budget of its own.
  // Overflow outranks shortfall, because one is cut off and the other is thin.
  return problems.sort((a, b) => (b.overBy - a.overBy) || (b.shortBy - a.shortBy));
}

/** Applies a rewritten field back onto the slide it belongs to. */
export function applyRewrite(slide: SemanticSlide, binding: string, text: string): SemanticSlide {
  switch (binding) {
    case "title": return { ...slide, title: text };
    case "subtitle": return { ...slide, subtitle: text };
    case "body": return { ...slide, body: text };
    case "bullets": return { ...slide, bullets: text.split("\n").map((line) => line.trim()).filter(Boolean) };
    case "quote_text":
      return slide.quote ? { ...slide, quote: { ...slide.quote, text } } : slide;
    case "quote_attribution":
      return slide.quote ? { ...slide, quote: { ...slide.quote, attribution: text } } : slide;
    case "stat_value":
      return slide.statistic ? { ...slide, statistic: { ...slide.statistic, value: text } } : slide;
    case "stat_label":
      return slide.statistic ? { ...slide, statistic: { ...slide.statistic, label: text } } : slide;
    default: return slide;
  }
}

/* ------------------------------------------------- when it still will not fit */

export type Reseat = {
  index: number;
  from: string;
  to: string;
  /** Characters still over after the move. Zero is the point of doing it. */
  remaining: number;
};

/** Total characters over, across every slot of one composition. */
function overflowOf(brief: ArchetypeWritingBrief, slide: SemanticSlide): number {
  return findSlotProblems(brief, slide).reduce((sum, problem) => sum + problem.overBy, 0);
}

/**
 * Moving a slide that will not fit into a page that will.
 *
 * The rewriter is asked twice to shorten copy that overflows, and twice is
 * where asking stops being useful: a third request either returns the same
 * sentence or starts deleting the fact the slide existed to state. The old
 * answer past that point was to shrink the type until it stopped overflowing,
 * which is how a deck ends up with one slide set four points smaller than its
 * neighbours for reasons no reader can see.
 *
 * A family has other pages. Some of them are simply bigger. So rather than
 * making the words smaller, the slide is moved to a composition that holds
 * them — preferring one that does the same job in the talk, because a page
 * that fits and means the wrong thing is not an improvement.
 *
 * Nothing is moved unless it is strictly better, and a page that closes a deck
 * is never taken for a slide in the middle.
 */
export function reseatOverflowing(
  document: JslaydDocument,
  plan: DeckLayoutPlan,
  written: ReadonlyMap<number, SemanticSlide>,
  options: { profiles?: readonly PageProfile[]; language?: string } = {},
): { reseats: Reseat[]; briefs: ArchetypeWritingBrief[] } {
  const briefs = new Map(plan.briefs.map((brief) => [brief.archetypeId, brief]));
  const briefOf = (archetypeId: string): ArchetypeWritingBrief | null => {
    const known = briefs.get(archetypeId);
    if (known) return known;
    const archetype = document.archetypes.find((entry) => entry.id === archetypeId);
    if (!archetype) return null;
    const built = buildWritingBrief(document, archetype, options);
    briefs.set(archetypeId, built);
    return built;
  };

  const roleOf = new Map((options.profiles ?? []).map((profile) => [profile.archetypeId, profile.role]));
  const terminal = new Set((options.profiles ?? []).filter((profile) => profile.isTerminal).map((profile) => profile.archetypeId));
  const reseats: Reseat[] = [];

  for (const planned of plan.slides) {
    const slide = written.get(planned.index);
    const current = briefOf(planned.archetypeId);
    if (!slide || !current) continue;

    const before = overflowOf(current, slide);
    if (before === 0) continue;

    const last = planned.index === plan.slides.length - 1;
    const wanted = planned.role;

    let best: { id: string; overflow: number; sameRole: boolean } | null = null;
    for (const archetype of document.archetypes) {
      if (archetype.id === planned.archetypeId) continue;
      if (terminal.has(archetype.id) && !last) continue;
      const candidate = briefOf(archetype.id);
      if (!candidate) continue;

      const overflow = overflowOf(candidate, slide);
      const sameRole = wanted !== undefined && roleOf.get(archetype.id) === wanted;
      if (overflow >= before) continue;
      // A page that does the same job wins over a merely roomier one, and
      // roominess only decides between pages that agree about the job.
      const better = !best
        || (sameRole && !best.sameRole)
        || (sameRole === best.sameRole && overflow < best.overflow);
      if (better) best = { id: archetype.id, overflow, sameRole };
    }

    if (!best) continue;
    reseats.push({ index: planned.index, from: planned.archetypeId, to: best.id, remaining: best.overflow });
    planned.archetypeId = best.id;
  }

  return { reseats, briefs: [...briefs.values()] };
}


/**
 * The brief for one archetype, built on demand.
 *
 * `planDeckLayout` returns briefs for the compositions it planned, and callers
 * keep them in a map keyed by archetype id. A slide that ends up on an
 * archetype missing from that map — a late move, a substitution — then silently
 * skips every step that needs a budget: it is never adapted to the boxes it
 * will actually be drawn in, and its copy is never measured. That is how a list
 * of 991 characters reached a paragraph box built for 578.
 *
 * So the map gets a way to answer for any archetype in the document rather than
 * only for the ones planned in advance.
 */
export function briefForArchetype(
  document: JslaydDocument,
  archetypeId: string,
  options: { language?: string } = {},
): ArchetypeWritingBrief | null {
  const archetype = document.archetypes.find((entry) => entry.id === archetypeId);
  return archetype ? buildWritingBrief(document, archetype, options) : null;
}
