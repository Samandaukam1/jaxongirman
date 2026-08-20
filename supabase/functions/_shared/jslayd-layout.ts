import {
  DEFAULT_META,
  purposeForLayout,
  readDocument,
  renderArchetype,
  selectArchetypes,
  textVolume,
  type JslaydDocument,
  type PlacedShape,
  type SlideData,
} from "./jslayd/index.ts";
import { planStory, selectPages, type PageProfile } from "./design-select.ts";
import { fillFromSlide, usableSlots } from "./pptx-writer.ts";
import { validateAndRepair } from "./layout.ts";
import type { ElementRow, GeneratedImage, SemanticSlide, SlideRow } from "./presentation-types.ts";

/**
 * The JSLAYD path through slide building.
 *
 * `layout.ts` renders a deck from a built-in blueprint; this renders one from a
 * published `.jslayd` document. Both end at the same rows, and both run the
 * same `validateAndRepair` safety net, so a JSLAYD deck is not a second kind of
 * presentation — it is the same presentation, laid out by a design that came
 * from the database instead of from the bundle.
 *
 * Which path a deck takes is decided once, in the pipeline, by whether the
 * presentation carries a `design_id`. Nothing here can be reached by a deck
 * that does not, which is what keeps the built-in designs untouched (§72).
 */

export type ResolvedDesign = {
  id: string;
  version: number;
  slug: string;
  document: JslaydDocument;
  /**
   * What each page of the family is for, where the design came from a template.
   *
   * Absent for a written design, and absent is not a degraded state: six
   * archetypes chosen by shape is exactly right for six archetypes. It is
   * twenty-five composed as a sequence that needs the sequence to be visible.
   */
  profiles?: readonly PageProfile[];
};

export type DesignRow = {
  id: string;
  slug: string;
  version: number;
  compiled_config: unknown;
};

/**
 * Turns a design row into something renderable, or reports why it is not.
 *
 * The document arrived from a table an admin writes and travelled over the
 * wire, so it is re-read against the schema here rather than trusted — "the
 * admin console compiled it" is a claim about a different process on a
 * different machine (§82).
 *
 * It answers with `null` and a reason rather than throwing. A design that
 * cannot be read must cost one deck its new look, never take the generator
 * down or leave a user with no presentation at all (§99).
 */
export function readDesign(row: DesignRow | null | undefined): { design: ResolvedDesign | null; reason: string | null } {
  if (!row) return { design: null, reason: "design row not found" };
  const read = readDocument(row.compiled_config);
  if (!read.document) {
    return {
      design: null,
      reason: read.diagnostics.errors.slice(0, 3).map((item) => item.message).join("; ") || "document rejected",
    };
  }
  return {
    design: { id: row.id, version: row.version, slug: row.slug, document: read.document },
    reason: null,
  };
}

type BuildInput = {
  presentationId: string;
  ownerId: string;
  design: ResolvedDesign;
  slides: SemanticSlide[];
  sources: string[];
  generatedImages: GeneratedImage[];
  uploadedImages: string[];
  authorName: string | null;
  teacherName: string | null;
  /**
   * Drawn JElements per slide, keyed by the archetype's slot id.
   *
   * Already rendered to shapes by the caller, so this file never imports the
   * element library. JSLAYD decides where a visual goes; an element is one of
   * the things that can go there, and keeping them apart at this seam is what
   * lets either change without the other.
   */
  slideElements?: readonly Record<string, readonly PlacedShape[]>[];
  /**
   * One archetype id per slide, chosen before the copy was written.
   *
   * `null` for a slide the caller did not plan — the four fixed slides are
   * built from data the server holds and need no budget. An id that is not in
   * the document is ignored rather than fatal: a design republished between
   * planning and rendering should cost a deck its ideal composition, not its
   * existence.
   */
  archetypeIds?: readonly (string | null)[];
  /**
   * What each template box will say, one entry per deck slide.
   *
   * `null` for a slide with no template page behind it — the four the server
   * assembles itself — and for every deck of a written design. Positional, to
   * match `archetypeIds`, because those two describe the same slide.
   */
  templateText?: readonly (Record<string, string> | null)[];
  /**
   * The colour family the user picked. A migrated design carries all eight, so
   * this is what keeps a JSLAYD deck as recolourable as the blueprint it came
   * from (§29). Unknown or absent resolves to the design's default.
   */
  paletteCode: string | null;
};

/**
 * The pipeline's semantic slide, as the render engine wants to read it.
 *
 * Image and element slots stay empty here and are filled once the archetype is
 * known — which slots exist is a property of the design, not of the content.
 */
function toSlideData(
  semantic: SemanticSlide,
  index: number,
  total: number,
  sources: string[],
  authorName: string | null,
  teacherName: string | null,
): SlideData {
  return {
    index,
    total,
    purpose: purposeForLayout(semantic.layout),
    title: semantic.title,
    subtitle: semantic.subtitle,
    body: semantic.body,
    bullets: semantic.bullets,
    quote: semantic.quote,
    statistic: semantic.statistic,
    chart: semantic.chart,
    table: semantic.table,
    images: {},
    elements: {},
    // The bibliography is the deck's second-to-last slide, and it is the only
    // one a `{{sources}}` binding should fill — every other slide would repeat
    // the whole list.
    sources: index === total - 2 ? sources : [],
    meta: { ...DEFAULT_META, author: authorName, teacher: teacherName, sectionLabel: semantic.purpose },
  };
}

/**
 * The archetype each slide is laid into.
 *
 * A template family knows what its pages are for, so the deck is planned as a
 * story and the pages are chosen against that plan. A written design does not
 * and does not need to: its archetypes are chosen by what each slide is, which
 * is what they were authored for. Both end at the same list, so nothing further
 * down learns which kind of design it is drawing.
 */
function baseSelection(
  design: ResolvedDesign,
  data: readonly SlideData[],
  pictures: readonly (unknown | null)[],
  fixed: readonly (string | null)[],
): { archetype: JslaydDocument["archetypes"][number]; substituted: boolean }[] {
  const profiles = design.profiles ?? [];
  if (profiles.length === 0) return selectArchetypes(design.document, data as SlideData[]);

  const plan = planStory(data.map((slide) => slide.purpose));
  const needs = data.map((slide, index) => ({
    purpose: slide.purpose,
    textVolume: textVolume(slide),
    hasImage: Boolean(pictures[index]),
  }));

  const byId = new Map(design.document.archetypes.map((archetype) => [archetype.id, archetype]));
  /**
   * One selection for the whole deck, not two that never met.
   *
   * The body slides were assigned their pages before a word was written and
   * cannot move — the copy was written for those boxes. The cover, agenda,
   * bibliography and closing slides are chosen here. Handing the settled ones
   * in means the free ones are spaced against what the deck actually contains;
   * running this without them produced a second opinion that was thrown away
   * for the body and kept for the four, so a closing page could repeat a page
   * from two slides earlier and nothing had noticed.
   */
  return selectPages(profiles, plan, needs, { fixed }).map((choice, index) => {
    const archetype = byId.get(choice.archetypeId);
    // A profile naming a page the document does not have means the two were
    // stored at different versions. The shape-based chooser still answers, so
    // the deck is laid out rather than abandoned.
    if (archetype) return { archetype, substituted: choice.substituted };
    return selectArchetypes(design.document, [data[index]!])[0]!;
  });
}

/**
 * What a finished slide records about where it came from.
 *
 * For a written design: the engine, and nothing else to say. For an imported
 * one: which source slide it is, how many boxes that slide has, and what each
 * of them will say — because the exporter clones that part and replaces exactly
 * those, and a deck somebody generated last week has to still export next month
 * without the design being re-read.
 *
 * `engine` is checked by the exporter before it does anything else, so
 * `"jslayd"` appearing on a template slide is a bug rather than a fallback.
 */
function templateReport(
  profile: PageProfile | undefined,
  written: Record<string, string> | null,
  slide: SlideData,
): Record<string, unknown> {
  if (!profile?.sourcePart) return { engine: "jslayd" };
  const slots = usableSlots(profile.slots ?? []);
  return {
    engine: "pptx_clone",
    source_slide_index: profile.sourceIndex ?? 0,
    source_slide_part: profile.sourcePart,
    text_objects_found: slots.length,
    /**
     * One entry per box, so the export needs the design only for the package
     * itself. A box the user later edits is read from its element instead.
     *
     * Four slides of every deck are assembled here rather than written — the
     * cover, the agenda, the bibliography and the closing line — so they arrive
     * with nothing from the writer and their boxes are filled from what they do
     * say. Without that the export refuses the whole deck, because a box with
     * no copy keeps the template's own words.
     */
    slots: written ?? Object.fromEntries(fillFromSlide(slots, {
      title: slide.title,
      subtitle: slide.subtitle,
      body: slide.body,
      bullets: slide.bullets,
    })),
  };
}

export function buildJslaydSlides(input: BuildInput): { slides: SlideRow[]; elements: ElementRow[] } {
  const profileByArchetype = new Map((input.design.profiles ?? []).map((profile) => [profile.archetypeId, profile]));
  const generated = new Map(input.generatedImages.map((item) => [item.slideIndex, item]));
  let uploadedIndex = 0;

  const pictures = input.slides.map((_, index) => {
    const generatedImage = generated.get(index);
    if (generatedImage) return { bucket: generatedImage.bucket, path: generatedImage.path };
    if (input.uploadedImages.length === 0) return null;
    return { bucket: "user-uploads", path: input.uploadedImages[uploadedIndex++ % input.uploadedImages.length]! };
  });

  const data = input.slides.map((semantic, index) =>
    toSlideData(semantic, index, input.slides.length, input.sources, input.authorName, input.teacherName),
  );

  // The archetypes the copy was written for, when the caller chose them before
  // writing. Honoured rather than re-derived: the writer was given this
  // archetype's boxes and wrote to their budgets, so laying the result into a
  // different composition would waste the one thing the early choice bought.
  //
  // Selection still runs over the whole deck when no choice was made, because
  // avoiding repetition is a property of the sequence and a chooser seeing one
  // slide cannot know it already used a composition.
  const preselected = input.archetypeIds ?? [];
  const chosen = baseSelection(input.design, data, pictures, preselected).map((selection, index) => {
    const wanted = preselected[index];
    if (!wanted) return selection;
    const archetype = input.design.document.archetypes.find((entry) => entry.id === wanted);
    return archetype ? { archetype, substituted: false } : selection;
  });

  const slideRows: SlideRow[] = [];
  const elementRows: ElementRow[] = [];

  chosen.forEach((selection, index) => {
    const slideId = crypto.randomUUID();
    const picture = pictures[index];
    const slide = data[index]!;

    // A slide carries one picture; a design may draw several slots. The picture
    // fills every slot the archetype declares, so a two-image composition shows
    // the same photograph twice rather than losing half its layout — and a
    // design that wants distinct pictures per slot is a generator change, not a
    // renderer one.
    if (picture) {
      for (const element of selection.archetype.elements) {
        if (element.type === "image" || element.type === "frame") slide.images[element.slot] = picture;
      }
    }

    // Elements are keyed by slot already, so they are handed straight over —
    // a slot the design does not declare is simply never read.
    const drawn = input.slideElements?.[index];
    if (drawn) slide.elements = { ...drawn };

    const rendered = renderArchetype(input.design.document, selection.archetype, slide, input.paletteCode);
    const rows: ElementRow[] = rendered.elements.map((element) => ({
      id: crypto.randomUUID(),
      slide_id: slideId,
      presentation_id: input.presentationId,
      owner_id: input.ownerId,
      type: element.type,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      z_index: element.z_index,
      opacity: element.opacity,
      locked: element.locked,
      style: element.style,
      content: element.content,
    }));

    const checked = validateAndRepair(rows, { authoredGeometry: true });
    slideRows.push({
      id: slideId,
      presentation_id: input.presentationId,
      owner_id: input.ownerId,
      position: index,
      title: input.slides[index]!.title,
      layout: input.slides[index]!.layout,
      background: rendered.background,
      quality_score: checked.score,
      quality_report: {
        ...checked.report,
        /**
         * Which engine will produce the exported file.
         *
         * A design imported from PowerPoint is not exported by drawing it —
         * the original package is cloned and its words replaced — and the
         * exporter has to be able to tell without re-reading the design.
         *
         * Read from the page, not from the design: a template's pages all carry
         * a source slide, and a design with none is drawn. Asking whether the
         * chosen page has one is the same question the exporter asks.
         */
        ...templateReport(profileByArchetype.get(selection.archetype.id), input.templateText?.[index] ?? null, slide),
        design: input.design.slug,
        design_version: input.design.version,
        archetype: selection.archetype.id,
        palette: input.paletteCode,
        // A substitution means the design had nothing drawn for what the writer
        // asked for. It is not an error, but it is the first thing to look at
        // when a deck reads oddly, so it is recorded rather than inferred.
        substituted: selection.substituted,
      },
    });
    elementRows.push(...checked.rows);
  });

  return { slides: slideRows, elements: elementRows };
}
