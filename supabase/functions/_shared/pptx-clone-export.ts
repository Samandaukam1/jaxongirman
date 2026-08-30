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

import { clonePresentation, readRelationships, resolveTarget, type CloneReport, type MediaEdit, type SlidePlan } from "./pptx-clone.ts";
import type { ExportElement } from "./export-model.ts";
import { orientationOf, readSlidePictures, replaceablePictures, type SlidePicture } from "./pptx-pictures.ts";
import type { TextEdit } from "./pptx-text.ts";
import { unzip } from "./unzip.ts";
import { zip, type ZipFile } from "./zip.ts";

/** Bytes to put on a page, and the shape they are. */
export type PictureFill = {
  bytes: Uint8Array;
  /** Width over height of the fetched image, for choosing which hole it fits. */
  aspect: number;
};

/** Shaped like the rows, so this file can be tested without a database. */
export type SlideRow = {
  id: string;
  position: number;
  quality_report: Record<string, unknown> | null;
};

export type ElementRow = {
  id?: string;
  slide_id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  z_index?: number;
  opacity?: number;
  style?: Record<string, unknown> | null;
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
      let text = edited ?? (typeof generated === "string" ? generated : undefined);
      if (text === undefined) {
        missing.push(slot.shapeName || slot.shapeId);
        continue;
      }

      /**
       * Copy that is still the template's own copy is emptied, not shipped.
       *
       * The writer is told not to reuse the sample and mostly does not — then
       * meets a box saying `www.reallygreatsite.com`, which has no plausible
       * second answer, and hands it straight back. One such box fails the whole
       * export, so a deck somebody paid for could not be downloaded at all
       * because of a footer.
       *
       * The writer now catches this, but decks generated before it did are
       * still in the database and would fail forever. Blanking here is the same
       * rule at the last line of defence: the box keeps its size, its fill and
       * its place and simply says nothing, which is the smaller failure by a
       * long way. Eight characters is the threshold the leftover check uses, so
       * what is emptied here is exactly what would be refused there.
       */
      const original = (slot.originalText ?? "").trim();
      if (original.length >= 8 && text.trim().toLowerCase() === original.toLowerCase()) text = "";

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

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function relsFor(part: string): string {
  const cut = part.lastIndexOf("/");
  return `${part.slice(0, cut)}/_rels/${part.slice(cut + 1)}.rels`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setFile(files: ZipFile[], name: string, bytes: Uint8Array): void {
  const existing = files.find((file) => file.name === name);
  if (existing) existing.bytes = bytes;
  else files.push({ name, bytes });
}

function contentTypeTag(markup: string, part: string): string | null {
  for (const match of markup.matchAll(/<Override\b[^>]*\/>/g)) {
    const name = /\bPartName="([^"]+)"/.exec(match[0])?.[1]?.replace(/^\//, "");
    if (name === part) return match[0];
  }
  const extension = part.split(".").pop()?.toLowerCase();
  if (!extension) return null;
  for (const match of markup.matchAll(/<Default\b[^>]*\/>/g)) {
    if (/\bExtension="([^"]+)"/.exec(match[0])?.[1]?.toLowerCase() === extension) return match[0];
  }
  return null;
}

function addContentType(markup: string, donor: string, sourcePart: string, outputPart: string): string {
  const tag = contentTypeTag(donor, sourcePart);
  if (!tag) return markup;
  if (tag.startsWith("<Default")) {
    const extension = /\bExtension="([^"]+)"/.exec(tag)?.[1];
    if (!extension || new RegExp(`<Default\\b[^>]*Extension="${escapeRegex(extension)}"`).test(markup)) return markup;
    return markup.replace("</Types>", `${tag}</Types>`);
  }
  if (new RegExp(`<Override\\b[^>]*PartName="/${escapeRegex(outputPart)}"`).test(markup)) return markup;
  const renamed = tag.replace(/\bPartName="[^"]+"/, `PartName="/${outputPart}"`);
  return markup.replace("</Types>", `${renamed}</Types>`);
}

function validChartElement(element: ElementRow): boolean {
  if (element.type !== "chart") return false;
  const content = element.content ?? {};
  const type = content.chartType;
  const labels = content.labels;
  const values = content.values;
  return (type === "bar" || type === "donut")
    && Array.isArray(labels) && Array.isArray(values)
    && labels.length >= 2 && labels.length === values.length
    && values.every((value) => typeof value === "number" && Number.isFinite(value));
}

/**
 * Adds the real editable PowerPoint chart parts to a cloned template deck.
 *
 * PptxGenJS produces the chart XML and its embedded workbook once. We then
 * transplant that standards-compliant object into the cloned source page,
 * remapping relationship ids and part names so none of the template's own
 * charts, media or ids can collide with it. The source slide, layout, master,
 * theme and every existing object remain byte-for-byte apart from the one page
 * and relationship file that now reference the new chart.
 */
async function injectVisualStatistic(
  files: ZipFile[],
  report: CloneReport,
  slides: readonly SlideRow[],
  elements: readonly ElementRow[],
  chartDonor?: (element: ExportElement) => Promise<Uint8Array>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ordered = [...slides].sort((first, second) => first.position - second.position);
  const chart = elements.find(validChartElement);
  if (!chart) return { ok: true };
  // The pure clone tests and older callers do not load an npm chart renderer.
  // Production always supplies it from `export-presentation`; keeping the
  // dependency at that boundary leaves this OOXML planner runnable in Node.
  if (!chartDonor) return { ok: true };
  const slideIndex = ordered.findIndex((slide) => slide.id === chart.slide_id);
  const outputPart = report.slides[slideIndex]?.outputPart;
  if (slideIndex < 0 || !outputPart) {
    return { ok: false, reason: "Diagramma joylashadigan shablon sahifasi topilmadi." };
  }

  const donorBytes = await chartDonor({
    id: chart.id ?? "visual-statistic",
    slide_id: chart.slide_id,
    presentation_id: "template-clone",
    type: "chart",
    x: chart.x ?? 500,
    y: chart.y ?? 150,
    width: chart.width ?? 420,
    height: chart.height ?? 320,
    rotation: chart.rotation ?? 0,
    z_index: chart.z_index ?? 1,
    opacity: chart.opacity ?? 1,
    style: chart.style ?? {},
    content: chart.content ?? {},
  } as ExportElement);
  const donor = await unzip(donorBytes);
  const donorSlidePart = "ppt/slides/slide1.xml";
  const donorSlide = donor.get(donorSlidePart);
  const donorSlideRels = donor.get(relsFor(donorSlidePart));
  const donorManifest = donor.get("[Content_Types].xml");
  if (!donorSlide || !donorSlideRels || !donorManifest) {
    return { ok: false, reason: "Diagramma PowerPoint paketi tayyorlanmadi." };
  }

  let payload = /<p:spTree\b[^>]*>([\s\S]*?)<\/p:spTree>/.exec(decoder.decode(donorSlide))?.[1] ?? "";
  payload = payload
    .replace(/<p:nvGrpSpPr\b[\s\S]*?<\/p:nvGrpSpPr>/, "")
    .replace(/<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/, "");
  const donorChartRid = /<c:chart\b[^>]*r:id="([^"]+)"/.exec(payload)?.[1];
  if (!payload.trim() || !donorChartRid) {
    return { ok: false, reason: "Diagramma PowerPoint obyektiga aylantirilmadi." };
  }

  const slideRelationship = readRelationships(decoder.decode(donorSlideRels))
    .find((relationship) => relationship.id === donorChartRid);
  if (!slideRelationship || slideRelationship.external) {
    return { ok: false, reason: "Diagramma PowerPoint bog‘lanishi topilmadi." };
  }
  const donorChartPart = resolveTarget(donorSlidePart, slideRelationship.target);
  const donorChart = donor.get(donorChartPart);
  if (!donorChart) return { ok: false, reason: "Diagramma PowerPoint qismi topilmadi." };

  let suffix = 1;
  const names = new Set(files.map((file) => file.name));
  while (names.has(`ppt/charts/jaxongirmanChart${suffix}.xml`)) suffix += 1;
  const chartBase = `jaxongirmanChart${suffix}`;
  const outputChartPart = `ppt/charts/${chartBase}.xml`;
  const outputChartRelsPart = relsFor(outputChartPart);
  const donorChartRelsPart = relsFor(donorChartPart);
  const donorChartRels = donor.get(donorChartRelsPart);
  let outputChartRels = donorChartRels ? decoder.decode(donorChartRels) : "";

  const donorTypes = decoder.decode(donorManifest);
  let manifest = decoder.decode(files.find((file) => file.name === "[Content_Types].xml")?.bytes ?? new Uint8Array());
  manifest = addContentType(manifest, donorTypes, donorChartPart, outputChartPart);
  setFile(files, outputChartPart, donorChart);

  if (donorChartRels) {
    let dependency = 0;
    for (const relationship of readRelationships(outputChartRels)) {
      if (relationship.external) continue;
      const sourceDependency = resolveTarget(donorChartPart, relationship.target);
      const bytes = donor.get(sourceDependency);
      if (!bytes) continue;
      dependency += 1;
      const slash = sourceDependency.lastIndexOf("/");
      const extension = sourceDependency.includes(".") ? sourceDependency.slice(sourceDependency.lastIndexOf(".")) : "";
      const outputDependency = `${sourceDependency.slice(0, slash + 1)}${chartBase}-${dependency}${extension}`;
      const replacementTarget = relationship.target.replace(/[^/]+$/, outputDependency.slice(outputDependency.lastIndexOf("/") + 1));
      outputChartRels = outputChartRels.replace(
        new RegExp(`(\\bId="${escapeRegex(relationship.id)}"[^>]*\\bTarget=")${escapeRegex(relationship.target)}(")`),
        `$1${replacementTarget}$2`,
      );
      setFile(files, outputDependency, bytes);
      manifest = addContentType(manifest, donorTypes, sourceDependency, outputDependency);
    }
    setFile(files, outputChartRelsPart, encoder.encode(outputChartRels));
  }

  const outputSlideFile = files.find((file) => file.name === outputPart);
  if (!outputSlideFile) return { ok: false, reason: "Diagramma sahifasi paketda topilmadi." };
  let outputSlide = decoder.decode(outputSlideFile.bytes);
  const largestId = Math.max(9000, ...[...outputSlide.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)].map((match) => Number(match[1])));
  let nextId = largestId + 1;
  const outputRid = `rIdJxChart${suffix}`;
  payload = payload
    .replace(new RegExp(`r:id="${escapeRegex(donorChartRid)}"`, "g"), `r:id="${outputRid}"`)
    .replace(/(<p:cNvPr\b[^>]*\bid=")\d+("[^>]*>)/g, (_match, before, after) => `${before}${nextId++}${after}`);
  outputSlide = outputSlide.replace("</p:spTree>", `${payload}</p:spTree>`);
  setFile(files, outputPart, encoder.encode(outputSlide));

  const outputSlideRelsPart = relsFor(outputPart);
  const relation = `<Relationship Id="${outputRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/${chartBase}.xml"/>`;
  const currentRels = files.find((file) => file.name === outputSlideRelsPart);
  const relationshipMarkup = currentRels
    ? decoder.decode(currentRels.bytes).replace("</Relationships>", `${relation}</Relationships>`)
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relation}</Relationships>`;
  setFile(files, outputSlideRelsPart, encoder.encode(relationshipMarkup));
  setFile(files, "[Content_Types].xml", encoder.encode(manifest));
  report.parts = files.map((file) => file.name).sort();
  return { ok: true };
}

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
  /**
   * A picture per slide, already fetched, to put where the template had one.
   *
   * Optional and empty by default, so every existing export keeps producing the
   * file it produced before. Keyed by slide position, because that is what the
   * generator recorded and what the plan is ordered by.
   */
  pictures: ReadonlyMap<number, PictureFill> = new Map(),
  /** Production's PptxGenJS donor; optional so the pure OOXML module stays dependency-free. */
  chartDonor?: (element: ExportElement) => Promise<Uint8Array>,
): Promise<CloneExport> {
  const planned = planClone(slides, elements, profiles);
  if (!planned.ok) return { ok: false, reason: planned.reason };

  const entries = await unzip(packageBytes);
  const withPictures = pictures.size > 0
    ? placePictures(entries, planned.plan, pictures)
    : planned.plan;
  const { files, report } = clonePresentation(entries, withPictures);

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

  const charted = await injectVisualStatistic(files, report, slides, elements, chartDonor);
  if (!charted.ok) return { ok: false, reason: charted.reason, report };

  return { ok: true, bytes: await zip(files), report };
}

/**
 * Decide which picture on each page to replace, and with which bytes.
 *
 * The choice is made here rather than by the generator because only the export
 * is holding the package: how big each picture is, what shape it is, and how
 * many pages share it are all facts about the file, and guessing them from a
 * profile row written at import time is how a logo gets replaced with a
 * photograph of a bridge.
 *
 * A page with nothing suitable keeps the template's own picture. That is a
 * normal outcome, not a failure — a template's photography is often the reason
 * somebody chose it.
 */
export function placePictures(
  entries: ZipEntries,
  plan: readonly SlidePlan[],
  pictures: ReadonlyMap<number, PictureFill>,
): SlidePlan[] {
  const decoder = new TextDecoder();
  const read = (part: string): string | null => {
    const bytes = entries.get(part);
    return bytes ? decoder.decode(bytes) : null;
  };
  const relsFor = (part: string): string => {
    const cut = part.lastIndexOf("/");
    return `${part.slice(0, cut)}/_rels/${part.slice(cut + 1)}.rels`;
  };

  /**
   * How many *different* source pages draw each media part.
   *
   * Counted per distinct page rather than per plan entry, because a deck
   * routinely uses one source page twice and that is not sharing — it is the
   * same page appearing twice, and it already shows the same picture in both
   * places. Counting occurrences instead made every repeated page look
   * contested and blocked the replacement it was asking for.
   *
   * Two genuinely different pages sharing one part is still left alone: the
   * bytes are one file, and changing them for the page that asked would change
   * the page that did not.
   */
  const pagePictures = new Map<string, SlidePicture[]>();
  for (const entry of plan) {
    if (pagePictures.has(entry.sourcePart)) continue;
    const markup = read(entry.sourcePart);
    const rels = read(relsFor(entry.sourcePart));
    pagePictures.set(entry.sourcePart, markup && rels ? readSlidePictures(entry.sourcePart, markup, rels) : []);
  }

  const useCount = new Map<string, number>();
  for (const found of pagePictures.values()) {
    for (const part of new Set(found.map((picture) => picture.mediaPart))) {
      useCount.set(part, (useCount.get(part) ?? 0) + 1);
    }
  }

  const perPage: SlidePicture[][] = plan.map((entry) => pagePictures.get(entry.sourcePart) ?? []);

  return plan.map((entry, index) => {
    const fill = pictures.get(index);
    if (!fill) return entry;

    const { usable } = replaceablePictures(perPage[index] ?? [], useCount);
    if (usable.length === 0) return entry;

    /**
     * The hole the picture fits best, not simply the biggest one.
     *
     * A landscape photograph in a portrait frame is a face cropped to its ear.
     * When the aspects are equally wrong the sort has already put the largest
     * first, so the composition wins the tie.
     */
    const chosen = fill.aspect > 0
      ? usable.reduce((best, candidate) => (
        Math.abs((candidate.aspect || 1) - fill.aspect) < Math.abs((best.aspect || 1) - fill.aspect) ? candidate : best
      ), usable[0]!)
      : usable[0]!;

    const media: MediaEdit[] = [...(entry.media ?? []), { part: chosen.mediaPart, bytes: fill.bytes }];
    return { ...entry, media };
  });
}

/** What `unzip` returns, named so this file does not import it for a type. */
type ZipEntries = Map<string, Uint8Array>;

export { orientationOf };
