/**
 * Exporting a deck that was made from a PowerPoint template.
 *
 * The ordinary exporter draws a deck: it reads the stored rows and builds a
 * new file that looks like them. For a design imported from PowerPoint that is
 * the wrong operation — the uploaded package is the design, so the export is
 * that package with the chosen pages kept and their words replaced.
 *
 * This is the join. It works out which source slide each finished slide came
 * from, which shape each piece of copy belongs in, and hands both to the
 * cloner. It never draws anything.
 *
 * When it cannot do that safely it says so and returns nothing, so the caller
 * refuses the export rather than quietly falling back to a redrawing — which
 * would ship a file that looks like the design was recreated, which is the one
 * outcome this mode exists to prevent.
 */

import { clonePresentation, type CloneReport, type SlidePlan } from "./pptx-clone.ts";
import type { TextEdit } from "./pptx-text.ts";
import { unzip } from "./unzip.ts";
import { zip } from "./zip.ts";

/** Shaped like the rows, so this file can be tested without a database. */
export type SlideRow = {
  id: string;
  position: number;
  quality_report: Record<string, unknown> | null;
};

export type ElementRow = {
  slide_id: string;
  type: string;
  content: Record<string, unknown> | null;
};

/** One editable box of a source slide, as `design_slide_profiles` stores it. */
export type SlotRow = {
  shapeId?: string;
  paragraphs?: number;
  binding?: string | null;
  elementId?: string | null;
  originalText?: string;
  shapeName?: string;
};

export type PageProfileRow = {
  archetype_id: string;
  source_slide_part: string;
  text_map: SlotRow[];
};

export type ClonePlanResult =
  | { ok: true; plan: SlidePlan[] }
  | { ok: false; reason: string };

/**
 * Which source slide each finished slide is, and what goes in its boxes.
 *
 * Copy comes from two places and the order matters. A box the design drew in
 * the preview exists as an editable element, so what that element now says wins
 * — a deck somebody corrected exports the correction. Every other box, and
 * there are always more of them than the preview has fields for, is read from
 * what the generator wrote for it.
 *
 * The rule this enforces is the one the whole mode rests on: **every** editable
 * box of the source slide gets an edit. A box left out keeps the template's own
 * words, and the file ships with somebody else's sample sentence in it. So a
 * gap is a refusal, named by shape, rather than a slide that looks fine until
 * somebody scrolls to it.
 */
export function planClone(
  slides: readonly SlideRow[],
  elements: readonly ElementRow[],
  profiles: readonly PageProfileRow[],
): ClonePlanResult {
  const byArchetype = new Map(profiles.map((profile) => [profile.archetype_id, profile]));
  const textBySlide = new Map<string, Map<string, string>>();

  for (const element of elements) {
    if (element.type !== "text") continue;
    const elementId = String(element.content?.elementId ?? "");
    if (!elementId) continue;
    const forSlide = textBySlide.get(element.slide_id) ?? new Map<string, string>();
    forSlide.set(elementId, String(element.content?.text ?? ""));
    textBySlide.set(element.slide_id, forSlide);
  }

  const ordered = [...slides].sort((first, second) => first.position - second.position);
  const plan: SlidePlan[] = [];

  for (const slide of ordered) {
    const archetype = String(slide.quality_report?.archetype ?? "");
    const profile = byArchetype.get(archetype);
    if (!profile || !profile.source_slide_part) {
      // The four slides the server assembles itself — cover, agenda,
      // bibliography, closing — have no archetype from the template, and a
      // deck missing them is not the deck somebody generated.
      return { ok: false, reason: `«${archetype || "nomsiz"}» sahifasi shablon sahifasiga bog'lanmagan.` };
    }

    const drawn = textBySlide.get(slide.id) ?? new Map<string, string>();
    const stored = slide.quality_report?.slots;
    const written: Record<string, unknown> = stored && typeof stored === "object" ? stored as Record<string, unknown> : {};

    const edits: TextEdit[] = [];
    const missing: string[] = [];

    for (const slot of profile.text_map ?? []) {
      if (!slot.shapeId) continue;
      const edited = slot.elementId ? drawn.get(slot.elementId) : undefined;
      const generated = written[slot.shapeId];
      const text = edited ?? (typeof generated === "string" ? generated : undefined);
      if (text === undefined) {
        missing.push(slot.shapeName || slot.shapeId);
        continue;
      }

      // Split back into the paragraph count the original box held: a box of
      // three lines wants three replacements, not one long one.
      const lines = text.split("\n");
      const wanted = Math.max(1, slot.paragraphs ?? 1);
      const paragraphs = lines.length >= wanted
        ? lines.slice(0, wanted - 1).concat(lines.slice(wanted - 1).join(" "))
        : lines.concat(Array<string>(wanted - lines.length).fill(""));
      edits.push({ shapeId: slot.shapeId, paragraphs });
    }

    if (missing.length > 0) {
      return {
        ok: false,
        reason: `${slide.position + 1}-slaydda ${missing.length} ta matn qutisiga matn yozilmagan `
          + `(${missing.slice(0, 3).join(", ")}). Taqdimotni qayta yarating.`,
      };
    }

    plan.push({ sourcePart: profile.source_slide_part, edits });
  }

  return { ok: true, plan };
}

export type CloneExport =
  | { ok: true; bytes: Uint8Array; report: CloneReport }
  | { ok: false; reason: string; report?: CloneReport };

/**
 * The finished file, built out of the template's own parts.
 *
 * Leftover template copy fails the export rather than shipping: a customer
 * opening a deck with somebody else's sample sentence in it is the failure
 * with no excuse, and it is cheaper to refuse here than to explain later.
 */
export async function exportByCloning(
  packageBytes: Uint8Array,
  slides: readonly SlideRow[],
  elements: readonly ElementRow[],
  profiles: readonly PageProfileRow[],
): Promise<CloneExport> {
  const planned = planClone(slides, elements, profiles);
  if (!planned.ok) return { ok: false, reason: planned.reason };

  const entries = await unzip(packageBytes);
  const { files, report } = clonePresentation(entries, planned.plan);

  const blocking = report.problems.filter((problem) => problem.code !== "template_text_remains");
  if (files.length === 0 || blocking.length > 0) {
    return { ok: false, reason: blocking[0]?.message ?? "Shablon paketi klonlanmadi.", report };
  }
  if (report.leftoverText.length > 0) {
    return {
      ok: false,
      reason: `Shablon matni almashtirilmagan: «${report.leftoverText[0]!.slice(0, 60)}».`,
      report,
    };
  }

  return { ok: true, bytes: await zip(files), report };
}
