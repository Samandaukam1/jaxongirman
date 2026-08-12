import {
  DEFAULT_META,
  purposeForLayout,
  readDocument,
  renderArchetype,
  selectArchetypes,
  type JslaydDocument,
  type SlideData,
} from "./jslayd/index.ts";
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
   * The colour family the user picked. A migrated design carries all eight, so
   * this is what keeps a JSLAYD deck as recolourable as the blueprint it came
   * from (§29). Unknown or absent resolves to the design's default.
   */
  paletteCode: string | null;
};

/**
 * The pipeline's semantic slide, as the render engine wants to read it.
 *
 * Image slots stay empty here and are filled once the archetype is known —
 * which slots exist is a property of the design, not of the content.
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
    // The bibliography is the deck's second-to-last slide, and it is the only
    // one a `{{sources}}` binding should fill — every other slide would repeat
    // the whole list.
    sources: index === total - 2 ? sources : [],
    meta: { ...DEFAULT_META, author: authorName, teacher: teacherName, sectionLabel: semantic.purpose },
  };
}

export function buildJslaydSlides(input: BuildInput): { slides: SlideRow[]; elements: ElementRow[] } {
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

  // Selection runs over the whole deck so repetition can be avoided; a chooser
  // that sees one slide at a time cannot know it already used a composition.
  const chosen = selectArchetypes(input.design.document, data);

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
        engine: "jslayd",
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
