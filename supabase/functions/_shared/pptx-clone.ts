/**
 * Building a deck out of the original slides rather than out of a description
 * of them.
 *
 * The rule for a PPTX template is that the uploaded package *is* the design, so
 * the finished file has to be made of its parts: the same slide XML, the same
 * layouts and masters behind it, the same theme, the same image bytes. Nothing
 * here decodes a picture, re-serialises a shape or recreates a background. It
 * chooses parts, follows what they reference, edits the words, and writes a ZIP.
 *
 * Three things make that work.
 *
 * **The closure.** A slide is not self-contained: it points at a layout, which
 * points at a master, which points at a theme, and any of them may point at
 * media, charts or diagrams. Taking a slide without what it references gives a
 * file PowerPoint opens as blank. So references are followed transitively and
 * everything reached is carried, byte for byte.
 *
 * **The manifest.** `[Content_Types].xml` and the relationship files decide what
 * a package *is*; a part present but unlisted does not exist as far as
 * PowerPoint is concerned. Both are edited rather than regenerated, for the
 * same reason the slides are.
 *
 * **Reuse.** One design page may serve two deck slides, so a part used twice is
 * copied under a second name with its own relationships — the alternative,
 * pointing two entries at one part, would make editing one edit both.
 *
 * Pure: entries in, files out, and a report of what was preserved.
 */

import { replaceText, readTextObjects, remainingTemplateText, type TextEdit, type TextObject } from "./pptx-text.ts";
import type { ZipEntries } from "./unzip.ts";
import type { ZipFile } from "./zip.ts";

export type SlidePlan = {
  /** `ppt/slides/slide4.xml` — the page the selector chose. */
  sourcePart: string;
  edits: readonly TextEdit[];
  /**
   * Pictures to swap, by the media part the slide points at.
   *
   * The slide's own markup is not touched. Replacing the bytes behind a
   * relationship keeps the crop, the frame, the shadow and every effect the
   * designer set; rewriting the XML to point somewhere else would mean
   * recreating all of that, and getting it slightly wrong on every template.
   */
  media?: readonly MediaEdit[];
};

export type MediaEdit = {
  /** `ppt/media/image7.jpeg`, as the slide's relationships resolve it. */
  part: string;
  bytes: Uint8Array;
};

export type CloneProblem = { code: string; message: string; part?: string };

export type CloneReport = {
  slides: {
    sourcePart: string;
    outputPart: string;
    textObjectsFound: number;
    textObjectsReplaced: number;
    nonTextObjectsPreserved: number;
    /**
     * Whether this page came through with everything it had.
     *
     * Drawn objects, relationships and the parts those point at, counted before
     * and after. Editing only what sits between `<a:t>` tags cannot change any
     * of them, which is the point: the check is cheap precisely because it
     * should never fail, and the day it does is the day something started
     * rewriting markup it was supposed to be copying.
     */
    structuralFidelityPassed: boolean;
  }[];
  /** True when every page came through whole. What §23 asks for, in one word. */
  structuralFidelityPassed: boolean;
  /** Every part carried over, so a structural check can count them. */
  parts: string[];
  mediaParts: string[];
  /** Media parts whose bytes were replaced, so the caller can report it. */
  pictureReplacements: string[];
  /** Template copy that survived the rewrite. Non-empty means do not ship. */
  leftoverText: string[];
  problems: CloneProblem[];
};

export type CloneResult = { files: ZipFile[]; report: CloneReport };

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Parts every package needs whether or not a slide references them. */
const ALWAYS = ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"];

function relsFor(part: string): string {
  const cut = part.lastIndexOf("/");
  return `${part.slice(0, cut)}/_rels/${part.slice(cut + 1)}.rels`;
}

/** `../media/image1.png` seen from `ppt/slides/` is `ppt/media/image1.png`. */
export function resolveTarget(owner: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const base = owner.slice(0, owner.lastIndexOf("/")).split("/");
  for (const piece of target.split("/")) {
    if (piece === "." || piece === "") continue;
    if (piece === "..") base.pop();
    else base.push(piece);
  }
  return base.join("/");
}

type Relationship = { id: string; target: string; external: boolean };

export function readRelationships(markup: string): Relationship[] {
  const out: Relationship[] = [];
  for (const match of markup.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const tag = match[0];
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]*)"/.exec(tag)?.[1];
    if (!id || target === undefined) continue;
    out.push({ id, target, external: /TargetMode="External"/.test(tag) });
  }
  return out;
}

/**
 * Everything the chosen slides need, found by following what they point at.
 *
 * Breadth-first from the slides through their relationships, and through the
 * relationships of whatever those reach. A hyperlink is skipped: it points at
 * somebody else's server, not at a part of this file.
 */
export function closureOf(entries: ZipEntries, slideParts: readonly string[]): Set<string> {
  const kept = new Set<string>();
  const queue: string[] = [];
  const chosen = new Set(slideParts);

  const add = (part: string) => {
    if (!part || kept.has(part) || !entries.has(part)) return;
    /**
     * A slide nobody chose is not a dependency of one that was.
     *
     * `ppt/presentation.xml` names every slide in the deck, and its
     * relationships are followed like any other part's — so without this the
     * closure walks the whole original file and the "cloned" deck carries
     * every page's photographs. The presentation part is rewritten to name
     * only the chosen slides, so following the old list is reaching for
     * something the finished package will not contain.
     */
    if (/^ppt\/slides\/slide[^/]*\.xml$/.test(part) && !chosen.has(part)) return;
    kept.add(part);
    queue.push(part);
  };

  for (const part of ALWAYS) add(part);
  for (const part of slideParts) add(part);
  // Document properties are not referenced by a slide and PowerPoint expects
  // them; they are also where a file's title lives.
  for (const name of entries.keys()) if (name.startsWith("docProps/")) add(name);

  while (queue.length > 0) {
    const part = queue.shift()!;
    const rels = relsFor(part);
    const markup = entries.get(rels);
    if (!markup) continue;
    add(rels);
    for (const relationship of readRelationships(decoder.decode(markup))) {
      if (relationship.external) continue;
      add(resolveTarget(part, relationship.target));
    }
  }

  return kept;
}

/** How many drawn objects a slide holds that are not text boxes. */
export function countVisualObjects(markup: string): number {
  const shapes = [...markup.matchAll(/<p:(sp|pic|graphicFrame|cxnSp|grpSp)\b/g)].length;
  const withText = [...markup.matchAll(/<p:txBody\b/g)].length;
  return Math.max(0, shapes - withText);
}

/**
 * The presentation part, listing the slides this deck actually has.
 *
 * Only `<p:sldIdLst>` is rewritten. The slide size, the masters, the notes
 * settings and every namespace stay exactly as the template wrote them, which
 * is the difference between a deck that opens looking right and one that opens.
 */
function rewritePresentation(markup: string, slideRelIds: readonly string[]): string {
  const list = slideRelIds
    .map((relId, index) => `<p:sldId id="${256 + index}" r:id="${relId}"/>`)
    .join("");
  const replacement = `<p:sldIdLst>${list}</p:sldIdLst>`;

  if (/<p:sldIdLst\b[^>]*\/>/.test(markup)) {
    return markup.replace(/<p:sldIdLst\b[^>]*\/>/, replacement);
  }
  if (/<p:sldIdLst\b/.test(markup)) {
    return markup.replace(/<p:sldIdLst\b[\s\S]*?<\/p:sldIdLst>/, replacement);
  }
  // No list at all: put one where PowerPoint expects it, before the slide size.
  return markup.replace(/<p:sldSz\b/, `${replacement}<p:sldSz`);
}

/** The deck's relationships: everything that was not a slide, plus the new slides. */
function rewritePresentationRels(markup: string, slides: readonly { relId: string; part: string }[]): string {
  const kept = readRelationships(markup)
    .filter((relationship) => !/slides\/slide[^/]*\.xml$/.test(relationship.target))
    .map((relationship) => {
      const source = new RegExp(`<Relationship\\b[^>]*Id="${relationship.id}"[^>]*/?>`).exec(markup);
      return source?.[0] ?? "";
    })
    .filter(Boolean);

  const added = slides.map((slide) =>
    `<Relationship Id="${slide.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"`
    + ` Target="${slide.part.replace(/^ppt\//, "")}"/>`);

  const inner = [...kept, ...added].join("");
  return markup.replace(/(<Relationships\b[^>]*>)[\s\S]*(<\/Relationships>)/, `$1${inner}$2`);
}

/**
 * The manifest, narrowed to the parts this package has.
 *
 * An override naming a part that is not here makes the file invalid; a part
 * here with no override is invisible. Defaults are left alone — they describe
 * extensions rather than parts, and a media type nothing uses costs nothing.
 */
function rewriteContentTypes(markup: string, parts: ReadonlySet<string>, copies: readonly { from: string; to: string }[]): string {
  const overrides = [...markup.matchAll(/<Override\b[^>]*\/>/g)].map((match) => match[0]);
  const kept = overrides.filter((tag) => {
    const name = /\bPartName="\/([^"]+)"/.exec(tag)?.[1];
    return name !== undefined && parts.has(name);
  });

  // A slide copied under a second name needs its own entry, with the type its
  // original had.
  for (const copy of copies) {
    const original = overrides.find((tag) => new RegExp(`PartName="/${copy.from}"`).test(tag));
    if (original) kept.push(original.replace(copy.from, copy.to));
  }

  return markup.replace(/<Override\b[^>]*\/>/g, "").replace(/(<\/Types>)/, `${kept.join("")}$1`);
}

/**
 * A deck built from the template's own slides.
 *
 * Never throws for a template it merely dislikes: a missing part becomes a
 * problem in the report so the caller can refuse the export and say why, which
 * is what "do not silently fall back" means in practice.
 */
export function clonePresentation(entries: ZipEntries, plan: readonly SlidePlan[]): CloneResult {
  const problems: CloneProblem[] = [];
  const report: CloneReport = {
    slides: [], parts: [], mediaParts: [], pictureReplacements: [], leftoverText: [], problems,
    structuralFidelityPassed: true,
  };
  if (plan.length === 0) {
    problems.push({ code: "no_slides", message: "Klonlash uchun sahifa tanlanmadi." });
    return { files: [], report };
  }

  // A page used twice becomes two parts: pointing two entries at one would make
  // editing one edit both.
  const used = new Map<string, number>();
  const copies: { from: string; to: string }[] = [];
  const outputs: { source: string; output: string; relId: string; edits: readonly TextEdit[] }[] = [];

  /**
   * Every replacement asked for, by part.
   *
   * Collected across the whole plan before anything is written, because a media
   * part is one file however many slides point at it: two pages asking for
   * different pictures in the same part is a contradiction, and the honest
   * answer is to keep the template's own picture rather than let the last
   * writer win.
   */
  const replacements = new Map<string, Uint8Array>();
  const contested = new Set<string>();
  for (const entry of plan) {
    for (const edit of entry.media ?? []) {
      const seen = replacements.get(edit.part);
      if (seen && seen !== edit.bytes) contested.add(edit.part);
      else replacements.set(edit.part, edit.bytes);
    }
  }
  for (const part of contested) {
    replacements.delete(part);
    problems.push({
      code: "picture_contested",
      message: "Bu rasm bir nechta sahifada ishlatilgan, shuning uchun almashtirilmadi.",
      part,
    });
  }

  plan.forEach((entry, index) => {
    if (!entries.has(entry.sourcePart)) {
      problems.push({ code: "missing_slide", message: "Manba sahifa paketda topilmadi.", part: entry.sourcePart });
      return;
    }
    const seen = (used.get(entry.sourcePart) ?? 0) + 1;
    used.set(entry.sourcePart, seen);
    const output = seen === 1
      ? entry.sourcePart
      : entry.sourcePart.replace(/\.xml$/, `_c${seen}.xml`);
    if (seen > 1) copies.push({ from: entry.sourcePart, to: output });
    outputs.push({ source: entry.sourcePart, output, relId: `rIdJx${index + 1}`, edits: entry.edits });
  });

  if (outputs.length === 0) return { files: [], report };

  const kept = closureOf(entries, outputs.map((entry) => entry.source));
  const files: ZipFile[] = [];
  const written = new Set<string>();

  const push = (name: string, bytes: Uint8Array) => {
    if (written.has(name)) return;
    written.add(name);
    files.push({ name, bytes });
  };

  // The manifest first: some readers are happier for it and it costs nothing.
  const contentTypes = entries.get("[Content_Types].xml");
  if (!contentTypes) {
    problems.push({ code: "no_manifest", message: "Paketda [Content_Types].xml yo‘q." });
    return { files: [], report };
  }
  const partsAfter = new Set([...kept, ...copies.map((copy) => copy.to)]);
  push("[Content_Types].xml", encoder.encode(
    rewriteContentTypes(decoder.decode(contentTypes), partsAfter, copies)));

  const presentation = entries.get("ppt/presentation.xml");
  const presentationRels = entries.get("ppt/_rels/presentation.xml.rels");
  if (!presentation || !presentationRels) {
    problems.push({ code: "no_presentation", message: "Paketda presentation.xml yo‘q." });
    return { files: [], report };
  }
  push("ppt/presentation.xml", encoder.encode(
    rewritePresentation(decoder.decode(presentation), outputs.map((entry) => entry.relId))));
  push("ppt/_rels/presentation.xml.rels", encoder.encode(
    rewritePresentationRels(decoder.decode(presentationRels),
      outputs.map((entry) => ({ relId: entry.relId, part: entry.output })))));

  /* ------------------------------------------------------------ the slides */

  const before: TextObject[] = [];
  const after: TextObject[] = [];

  for (const entry of outputs) {
    const source = decoder.decode(entries.get(entry.source)!);
    const original = readTextObjects(source);
    const rewritten = replaceText(source, entry.edits);
    before.push(...original);
    after.push(...readTextObjects(rewritten));

    push(entry.output, encoder.encode(rewritten));

    // A copied slide needs its own relationships, pointing at the same targets.
    const rels = entries.get(relsFor(entry.source));
    if (rels) push(relsFor(entry.output), rels);

    report.slides.push({
      sourcePart: entry.source,
      outputPart: entry.output,
      textObjectsFound: original.length,
      textObjectsReplaced: entry.edits.length,
      // Counted on the rewritten markup rather than the source: what shipped is
      // what matters, and the two agreeing is the check, not the assumption.
      nonTextObjectsPreserved: countVisualObjects(rewritten),
      structuralFidelityPassed: countVisualObjects(source) === countVisualObjects(rewritten)
        && original.length === readTextObjects(rewritten).length,
      // Filled once every part is written — a slide's pictures are checked
      // against the finished package, not against the intention.
      relationshipsResolved: rels ? readRelationships(decoder.decode(rels)) : [],
    } as never);
  }

  /* --------------------------------------------------- everything they need */

  for (const part of kept) {
    if (written.has(part)) continue;
    const bytes = entries.get(part);
    if (!bytes) continue;
    // The replacement, where one was asked for and the part is really in the
    // package. A part that is not kept is one no chosen slide points at, so a
    // replacement for it would ship bytes nothing draws.
    const swapped = replacements.get(part);
    push(part, swapped ?? bytes);
    if (swapped) report.pictureReplacements.push(part);
    if (/^ppt\/media\//.test(part)) report.mediaParts.push(part);
  }

  report.parts = files.map((file) => file.name).sort();
  report.mediaParts.sort();
  report.pictureReplacements.sort();

  /**
   * Every picture, layout and theme a chosen slide points at, present in what
   * shipped.
   *
   * §23's check, done the only way that means anything: not by counting what
   * was intended but by resolving each slide's own relationships against the
   * finished file. A slide whose photograph did not come along opens as a grey
   * rectangle, and the deck is refused instead.
   */
  for (const slide of report.slides) {
    const carried = slide as unknown as { relationshipsResolved?: Relationship[]; structuralFidelityPassed: boolean };
    const targets = carried.relationshipsResolved ?? [];
    delete carried.relationshipsResolved;
    for (const relationship of targets) {
      if (relationship.external) continue;
      const resolved = resolveTarget(slide.sourcePart, relationship.target);
      if (written.has(resolved) || !entries.has(resolved)) continue;
      carried.structuralFidelityPassed = false;
      problems.push({
        code: "resource_lost",
        message: "Sahifaning rasmi yoki bog‘lanishi nusxaga o‘tmadi.",
        part: resolved,
      });
    }
  }

  report.structuralFidelityPassed = report.slides.every((slide) => slide.structuralFidelityPassed);
  report.leftoverText = remainingTemplateText(before, after);
  if (report.leftoverText.length > 0) {
    problems.push({
      code: "template_text_remains",
      message: `${report.leftoverText.length} ta matn shablondagidek qoldi.`,
    });
  }

  return { files, report };
}
