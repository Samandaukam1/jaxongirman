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
