/**
 * A deck's scenes, turned into the rows the apps read.
 *
 * Pure, and kept apart from everything that needs Deno or a database, because
 * this is the conversion worth testing: layer order, geometry and the shape of
 * what the phone and the exporter will actually be handed.
 */

import type { GeneratedDeck } from "./scene-pipeline.ts";

export type SlideRow = Record<string, unknown>;
export type ElementRow = Record<string, unknown>;

/**
 * A deck's scenes, and the rows that draw them.
 *
 * Layers arrive fractional — a scrim sits at 3.5, between a photograph and the
 * words over it — and the column holds integers, so they are ranked per slide.
 * Ranking per slide rather than across the deck keeps each page's order
 * independent of how many elements the pages before it happened to have.
 */
export function deckToRows(deck: GeneratedDeck, input: { ownerId: string; presentationId: string; newId: () => string }): {
  slideRows: SlideRow[];
  elementRows: ElementRow[];
} {
  const slideRows: SlideRow[] = [];
  const elementRows: ElementRow[] = [];

  for (const slide of deck.slides) {
    if (!slide.rendered) continue;
    const slideId = input.newId();
    slideRows.push({
      id: slideId,
      presentation_id: input.presentationId,
      owner_id: input.ownerId,
      position: slide.index,
      title: slide.title,
      layout: "title_content",
      background: slide.rendered.background,
      quality_score: slide.score,
      quality_report: {
        engine: deck.engine,
        accepted: slide.accepted,
        synthesised: slide.synthesised,
        mirrored: slide.mirrored,
        attempts: slide.attempts,
        faults: slide.faults,
      },
    });

    const mine = slide.rendered.elements
      .map((row) => ({ row, layer: row.z_index }))
      .sort((a, b) => a.layer - b.layer);
    mine.forEach(({ row }, rank) => {
      elementRows.push({
        id: input.newId(),
        slide_id: slideId,
        presentation_id: input.presentationId,
        owner_id: input.ownerId,
        type: row.type,
        x: row.x,
        y: row.y,
        width: row.width,
        height: row.height,
        rotation: row.rotation,
        z_index: rank,
        opacity: row.opacity,
        locked: row.locked,
        style: row.style,
        content: row.content,
      });
    });
  }

  return { slideRows, elementRows };
}

/**
 * The pages a deck is made of, assembled from an outline.
 *
 * Pure, and here rather than in the pipeline, because this is the shape that
 * has twice been assembled by hand and twice lost a field on the way — the
 * author, the teacher, and which page was the cover. Edge functions are not
 * typechecked by `verify`; this is, and the test below holds it.
 *
 * The outline plans the body. The cover, the agenda, the bibliography and the
 * closing page are the deck's own furniture, and the engine composes them too
 * — a cover designed for its subject is most of what an author sees first.
 */
export type DeckPage = {
  title: string;
  research: string | null;
  kind: "cover" | "content" | "closing";
};

export function deckPagesFrom(input: {
  topic: string;
  outlineTitles: readonly string[];
  research: string | null;
  /**
   * What the deck actually cites.
   *
   * The bibliography page was given the research brief and asked to write
   * about it, which produces a page describing sources rather than listing
   * them. A graded deck is marked on this page; it has to carry the citations
   * themselves.
   */
  sources: readonly string[];
  agendaTitle: string;
  referencesTitle: string;
  thanksTitle: string;
}): DeckPage[] {
  return [
    { title: input.topic, research: null, kind: "cover" },
    { title: input.agendaTitle, research: input.outlineTitles.join("; "), kind: "content" },
    ...input.outlineTitles.map((title) => ({
      title,
      // The whole research brief for every page: it is one document and the
      // model is choosing which parts of it this page is about.
      research: input.research || null,
      kind: "content" as const,
    })),
    {
      title: input.referencesTitle,
      research: input.sources.length > 0
        ? `Shu manbalarni ro'yxat qilib yozing, o'zgartirmang va qo'shmang:\n${input.sources.map((one, at) => `${at + 1}. ${one}`).join("\n")}`
        : input.research || null,
      kind: "content",
    },
    { title: input.thanksTitle, research: null, kind: "closing" },
  ];
}
