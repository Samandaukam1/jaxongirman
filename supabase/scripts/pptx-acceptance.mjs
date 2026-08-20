/**
 * The acceptance run for PPTX template mode, against a real template.
 *
 * Unit tests prove that each piece does what it says on markup somebody wrote
 * to exercise it. This proves the thing that actually matters: that a template
 * a designer really made — with its newspaper texture, its photographs, its
 * icons, its grouped shapes and its display word spelled one letter to a text
 * box — goes in one end and comes out the other as a PowerPoint file that
 * differs from the original in nothing but its words.
 *
 * No model is called and no database is touched. Copy is generated here,
 * deterministically, at the lengths the slots ask for: what is under test is
 * the plumbing between the file and the file, and a writing model in the middle
 * would only make the result depend on the weather.
 *
 * Usage:
 *   node supabase/scripts/pptx-acceptance.mjs <template.pptx> [--out result.pptx]
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildEdgeModules } from "./build-edge.mjs";

const edge = buildEdgeModules();
const { unzip } = await import(`${edge}/unzip.js`);
const { readPptx } = await import(`${edge}/pptx.js`);
const { toJslaydDocument } = await import(`${edge}/pptx-design.js`);
const { readTextObjects } = await import(`${edge}/pptx-text.js`);
const { exportByCloning } = await import(`${edge}/pptx-clone-export.js`);
const { asksFor, fillFromSlide, readTemplateAnswer } = await import(`${edge}/pptx-writer.js`);

const source = process.argv[2];
if (!source) {
  console.error("Usage: node supabase/scripts/pptx-acceptance.mjs <template.pptx> [--out result.pptx]");
  process.exit(2);
}
const outAt = process.argv.indexOf("--out");
const outPath = outAt > 0 ? process.argv[outAt + 1] : null;

const decoder = new TextDecoder();
const checks = [];
const check = (name, passed, detail = "") => {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------------ import */

const bytes = new Uint8Array(readFileSync(source));
const entries = await unzip(bytes);
const deck = readPptx(entries);
const draft = toJslaydDocument(deck, {
  name: path.basename(source).replace(/\.pptx$/i, ""),
  slug: "qabul-sinovi",
  tier: "great",
  premium: false,
});

console.log(`\n${path.basename(source)} — ${deck.slides.length} slayd, ${draft.pages.length} sahifa\n`);

/* ------------------------------- every editable box of every page is a slot */

let boxesInFile = 0;
let boxesMapped = 0;
for (const page of draft.pages) {
  const inFile = readTextObjects(decoder.decode(entries.get(page.sourcePart))).filter((o) => o.shapeId);
  const mapped = new Set(page.textMap.map((slot) => slot.shapeId));
  boxesInFile += inFile.length;
  boxesMapped += inFile.filter((object) => mapped.has(object.shapeId)).length;
}
check(
  "har bir tahrirlanadigan matn qutisi xaritada bor",
  boxesInFile > 0 && boxesMapped === boxesInFile,
  `${boxesMapped}/${boxesInFile}`,
);

/* --------------------------- copy, written to the boxes rather than the design */

/** Uzbek filler at the length a slot asks for, so the fit rules are exercised. */
const WORDS = [
  "talabalar", "jurnalistika", "matbuot", "tahrir", "muharrir", "maqola",
  "axborot", "manba", "tahlil", "nashr", "jamoa", "mahorat", "yangilik",
];
function fillerOf(characters, seed) {
  const out = [];
  let length = -1;
  for (let index = 0; length < characters; index += 1) {
    const word = WORDS[(seed + index) % WORDS.length];
    if (length + 1 + word.length > characters && out.length > 0) break;
    out.push(word);
    length += word.length + 1;
  }
  const text = out.join(" ") || WORDS[seed % WORDS.length].slice(0, Math.max(1, characters));
  return text.charAt(0).toLocaleUpperCase("uz") + text.slice(1);
}

const slides = [];
const elements = [];
const profiles = [];

draft.pages.forEach((page, index) => {
  profiles.push({
    archetype_id: page.archetype.id,
    source_slide_part: page.sourcePart,
    text_map: page.textMap,
  });

  // Exactly what a model would return: one answer per ask, at the aim length.
  const answer = {
    boxes: asksFor(page.textMap).map((ask, position) => ({
      id: ask.id,
      text: ask.role === "letter"
        ? WORDS[(index + position) % WORDS.length].toLocaleUpperCase("uz")
        : ask.role === "number"
          ? String(index + 1)
          : fillerOf(ask.aim, index + position),
    })),
  };
  /**
   * The first and last pages go through the path the four assembled slides
   * take: no writer output at all, boxes filled from what the slide says.
   * Those slides used to fail the export for the whole deck, because a box
   * with no copy keeps the template's own words.
   */
  const assembled = index === 0 || index === draft.pages.length - 1;
  const fill = assembled
    ? {
      texts: fillFromSlide(page.textMap, {
        title: "Talabalar jurnalistikasi",
        subtitle: "Maktab nashri va uning o‘quvchilarga ta’siri",
        bullets: ["Tahririyat tarkibi", "Nashr jadvali", "Manbalar ro‘yxati"],
      }),
      filled: [], trimmed: [],
    }
    : readTemplateAnswer(answer, page.textMap, { title: "Talabalar jurnalistikasi" });

  const slideId = `slide-${index}`;
  slides.push({
    id: slideId,
    position: index,
    quality_report: {
      engine: "pptx_clone",
      archetype: page.archetype.id,
      source_slide_index: page.sourceIndexInFile,
      text_objects_found: page.textMap.length,
      slots: Object.fromEntries(fill.texts),
    },
  });

  // The boxes the preview draws also exist as editable elements; the exporter
  // must prefer those, so one is deliberately edited below.
  for (const slot of page.textMap) {
    if (!slot.elementId) continue;
    elements.push({
      slide_id: slideId,
      type: "text",
      content: { elementId: slot.elementId, text: fill.texts.get(slot.shapeId) ?? "" },
    });
  }
});

const edited = elements.find((element) => String(element.content.text ?? "").length > 12);
if (edited) edited.content.text = "Foydalanuvchi tahrirlagan matn";

/* ------------------------------------------------------------------ export */

const result = await exportByCloning(bytes, slides, elements, profiles);
check("eksport bajarildi", result.ok, result.ok ? "" : result.reason);
if (!result.ok) {
  console.error("\nQabul sinovi o‘tmadi.");
  process.exit(1);
}

const { report } = result;
check("shablon matni qolmadi", report.leftoverText.length === 0, `${report.leftoverText.length} ta`);
check("tuzilish saqlandi", report.structuralFidelityPassed);
check("hech qanday muammo yo‘q", report.problems.length === 0,
  report.problems.map((problem) => problem.code).join(", "));
check("har bir sahifa klonlandi", report.slides.length === draft.pages.length,
  `${report.slides.length}/${draft.pages.length}`);

const replaced = report.slides.reduce((sum, slide) => sum + slide.textObjectsReplaced, 0);
const found = report.slides.reduce((sum, slide) => sum + slide.textObjectsFound, 0);
check("har bir matn obyekti almashtirildi", replaced === found, `${replaced}/${found}`);

/* ---------------------------------------------- what came out, byte for byte */

const produced = await unzip(result.bytes);

const sourceMedia = [...entries.keys()].filter((name) => name.startsWith("ppt/media/"));
const keptMedia = [...produced.keys()].filter((name) => name.startsWith("ppt/media/"));
const identical = keptMedia.every((name) => {
  const before = entries.get(name);
  const after = produced.get(name);
  return before && after && before.length === after.length
    && before.every((byte, index) => byte === after[index]);
});
// A deck with no pictures passes by having none to lose.
check("rasm baytlari o‘zgarmadi", identical,
  sourceMedia.length === 0 ? "shablonda rasm yo‘q" : `${keptMedia.length}/${sourceMedia.length} media qismi`);

const sizeBefore = /<p:sldSz[^>]*>/.exec(decoder.decode(entries.get("ppt/presentation.xml")))?.[0];
const sizeAfter = /<p:sldSz[^>]*>/.exec(decoder.decode(produced.get("ppt/presentation.xml")))?.[0];
check("slayd o‘lchami o‘zgarmadi", Boolean(sizeBefore) && sizeBefore === sizeAfter, sizeAfter ?? "");

const layoutsBefore = [...entries.keys()].filter((name) => name.startsWith("ppt/slideLayouts/") && name.endsWith(".xml")).length;
const layoutsAfter = [...produced.keys()].filter((name) => name.startsWith("ppt/slideLayouts/") && name.endsWith(".xml")).length;
check("maketlar va shablon ustasi olib kelindi", layoutsAfter > 0,
  `${layoutsAfter}/${layoutsBefore} maket`);

const fontsBefore = [...entries.keys()].filter((name) => name.startsWith("ppt/fonts/")).length;
const fontsAfter = [...produced.keys()].filter((name) => name.startsWith("ppt/fonts/")).length;
check("o‘rnatilgan shriftlar saqlandi", fontsAfter === fontsBefore,
  fontsBefore === 0 ? "shablonda o‘rnatilgan shrift yo‘q" : `${fontsAfter}/${fontsBefore}`);

/* ------------------------- shapes, per page, source against what was written */

let shapesKept = true;
for (const slide of report.slides) {
  const before = decoder.decode(entries.get(slide.sourcePart));
  const after = decoder.decode(produced.get(slide.outputPart));
  const count = (markup, tag) => [...markup.matchAll(new RegExp(`<p:${tag}\\b`, "g"))].length;
  for (const tag of ["sp", "pic", "grpSp", "graphicFrame", "cxnSp"]) {
    if (count(before, tag) !== count(after, tag)) {
      shapesKept = false;
      console.log(`        ${slide.sourcePart}: ${tag} ${count(before, tag)} → ${count(after, tag)}`);
    }
  }
  // Everything that is not the words: the markup with `<a:t>` spans removed.
  const strip = (markup) => markup.replace(/<a:t\b[^>]*>[\s\S]*?<\/a:t>/g, "<a:t/>");
  if (strip(before) !== strip(after)) {
    shapesKept = false;
    console.log(`        ${slide.sourcePart}: matndan tashqari markup o‘zgardi`);
  }
}
check("matndan boshqa hech narsa o‘zgarmadi", shapesKept);

/* ----------------------------------------------------- the words themselves */

/**
 * Every box says something different from what it said.
 *
 * Stronger than looking for English: it pairs each output box with the source
 * box of the same shape id and demands the two differ. A box that came through
 * untouched is a box no edit reached, which is exactly the failure that used to
 * ship — and it catches it whatever language the template was written in.
 */
const unchanged = [];
for (const slide of report.slides) {
  const before = new Map(readTextObjects(decoder.decode(entries.get(slide.sourcePart)))
    .map((object) => [object.shapeId, object.text.trim()]));
  for (const object of readTextObjects(decoder.decode(produced.get(slide.outputPart)))) {
    const original = before.get(object.shapeId);
    // A box that was empty to begin with has nothing to leak, and a short one
    // is as often a page number or a mark as a sentence — a replacement may
    // legitimately land on the same digit. Same threshold the exporter uses.
    if (!original || original.length < 8) continue;
    if (object.text.trim() === original) unchanged.push(`${slide.outputPart} #${object.shapeId}: ${original.slice(0, 40)}`);
  }
}
check("hech bir quti shablondagidek qolmadi", unchanged.length === 0, unchanged.slice(0, 3).join(" | "));

if (outPath) {
  writeFileSync(outPath, result.bytes);
  console.log(`\nNatija: ${outPath} (${(result.bytes.byteLength / 1048576).toFixed(1)} MB)`);
}

const failed = checks.filter((entry) => !entry.passed);
console.log(`\n${checks.length - failed.length}/${checks.length} tekshiruv o‘tdi.`);
process.exit(failed.length === 0 ? 0 : 1);
