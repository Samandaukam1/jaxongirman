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
};

export type CloneProblem = { code: string; message: string; part?: string };

export type CloneReport = {
  slides: {
    sourcePart: string;
    outputPart: string;
    textObjectsReplaced: number;
    nonTextObjectsPreserved: number;
  }[];
  /** Every part carried over, so a structural check can count them. */
  parts: string[];
  mediaParts: string[];
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
    slides: [], parts: [], mediaParts: [], leftoverText: [], problems,
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
      textObjectsReplaced: entry.edits.length,
      nonTextObjectsPreserved: countVisualObjects(source),
    });
  }

  /* --------------------------------------------------- everything they need */

  for (const part of kept) {
    if (written.has(part)) continue;
    const bytes = entries.get(part);
    if (!bytes) continue;
    push(part, bytes);
    if (/^ppt\/media\//.test(part)) report.mediaParts.push(part);
  }

  report.parts = files.map((file) => file.name).sort();
  report.mediaParts.sort();
  report.leftoverText = remainingTemplateText(before, after);
  if (report.leftoverText.length > 0) {
    problems.push({
      code: "template_text_remains",
      message: `${report.leftoverText.length} ta matn shablondagidek qoldi.`,
    });
  }

  return { files, report };
}
