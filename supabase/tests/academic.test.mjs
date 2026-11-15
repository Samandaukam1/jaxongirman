import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const {
  LAYOUT_PRESETS, STRUCTURES, WORK_KINDS, abstractLanguages, bodyPieces, documentBlocks, numbered, pageOf,
  planPrompt, readLayout, readPlan, readSection, sectionPrompt, sectionWords, skeletonFor, structureOf, wordCount,
} = await import(`${edge}/academic.js`);
const { CITATION_STYLES, bibliography, citationRuns, formatReference, parseAuthors, readSource } = await import(`${edge}/citations.js`);
const { typeset } = await import(`${edge}/typeset.js`);
const { buildDocx } = await import(`${edge}/docx.js`);
const { unzip } = await import(`${edge}/unzip.js`);

/**
 * Two rules run through the academic engine and neither is negotiable.
 *
 * Nothing is invented — not a source, an author, a year, a page number, a
 * figure in a table, and above all not a finding. And a page number is a
 * claim: written only when the research actually established it.
 */

const sources = [
  readSource({ type: "book", authors: [{ family: "Aliyev", given: "Anvar" }], title: "Kitob", publisher: "Fan", place: "Toshkent", year: "2020" }),
  readSource({ type: "article", authors: [{ family: "Bekova", given: "B." }, { family: "Smith", given: "John" }], title: "Maqola",
    container: "Jurnal", year: "2023", volume: "4", issue: "2", pages: "45–52", doi: "10.1/x" }),
];
const text = (block) => block.runs.map((run) => run.text).join("");
const paragraphs = (blocks) => blocks.filter((block) => block.kind === "paragraph");
const article = (over = {}) => ({
  kind: "article", structure: "imrad", language: "uz", title: "Talabalar media savodxonligi", field: "Jurnalistika",
  authors: [{ name: "Karimov Anvar", affiliation: "Universitet", orcid: "0000-0002-1825-0097", email: "a@uni.uz" }],
  udc: "070.1", acknowledgements: "", funding: "",
  sections: [
    { key: "abstract", heading: "Annotatsiya", body: "Annotatsiya: Maqola haqida.\nАннотация: О статье.\nAbstract: This is about the article and the study." },
    { key: "keywords", heading: "Kalit so‘zlar", body: "Kalit so‘zlar: media, ta’lim\nКлючевые слова: медиа\nKeywords: media, education" },
    { key: "introduction", heading: "Kirish", body: "Birinchi fikr [2].\n\nIkkinchi fikr [1]." },
  ],
  sources, style: "gost", layout: LAYOUT_PRESETS.uz, ...over,
});

/* -------------------------------------------------------------- structures */

test("an article takes the six structures, each its own, all ending in a conclusion", () => {
  const shapes = STRUCTURES.map((structure) => skeletonFor("article", structure, "uz").map((section) => section.key));
  assert.equal(new Set(shapes.map((keys) => keys.join(","))).size, 6);
  for (const keys of shapes) {
    assert.deepEqual(keys.slice(0, 2), ["abstract", "keywords"], "har maqola annotatsiya va kalit so‘zlar bilan boshlansin");
    assert.ok(keys.includes("conclusion") || keys.includes("discussion_conclusion"));
    assert.equal(new Set(keys).size, keys.length);
  }
  assert.ok(skeletonFor("article", "ilmrad").some((section) => section.key === "literature"), "ILMRAD — adabiyotlar tahlili bilan");
  assert.ok(!skeletonFor("article", "review").some((section) => section.key === "results"), "sharhda natijalar bo‘limi yo‘q");
});

test("an older article without a chosen structure is IMRAD when empirical and a review when not", () => {
  assert.equal(structureOf("article", null, true), "imrad");
  assert.equal(structureOf("article", null, false), "review");
  assert.equal(structureOf("article", "case_study", false), "case_study");
  assert.equal(structureOf("referat", "imrad", true), null);
});

test("the headings come in the work's language", () => {
  const heads = (language) => skeletonFor("article", "imrad", language).map((section) => section.heading);
  assert.ok(heads("uz").includes("Kirish"));
  assert.ok(heads("ru").includes("Введение"));
  assert.ok(heads("en").includes("Introduction"));
  assert.ok(heads("tr").includes("Giriş"));
  for (const kind of WORK_KINDS.map((entry) => entry.kind).filter((kind) => kind !== "article")) {
    assert.ok(skeletonFor(kind, null, "en").every((section) => !/[ʻ‘]/.test(section.heading)), `${kind}: inglizcha sarlavhada o‘zbekcha qolmasin`);
  }
});

test("the abstract is in the paper's language first, then the other two of Uzbek, Russian and English", () => {
  assert.deepEqual(abstractLanguages("uz"), ["uz", "ru", "en"]);
  assert.deepEqual(abstractLanguages("en"), ["en", "uz", "ru"]);
  assert.deepEqual(abstractLanguages("tr"), ["tr", "uz", "ru", "en"]);
  const prompt = sectionPrompt({ kind: "article", structure: "imrad", language: "ru", empirical: true, topic: "T", field: "",
    key: "abstract", heading: "Аннотация", brief: "", earlier: [], next: null, sources, words: 600 });
  assert.match(prompt, /EXACTLY 3 paragraphs/);
  assert.ok(prompt.indexOf("Аннотация:") < prompt.indexOf("Annotatsiya:"), "o‘z tili birinchi");
});

test("a short communication is short", () => {
  assert.ok(sectionWords("article", "short", "introduction", 3) < sectionWords("article", "imrad", "introduction", 3));
});

/* ---------------------------------------------------------- never invented */

test("the keys are the work's spine and the model cannot rename them", () => {
  const skeleton = skeletonFor("referat", null);
  const plan = readPlan({
    empirical: false, udc: "UDK 37.01",
    sections: [{ key: "totally_different", heading: "Boshqa", brief: "…" }, { key: "introduction", heading: "Kirish qismi", brief: "Moslashtirilgan" }],
    sources: [],
  }, skeleton);
  assert.deepEqual(plan.sections.map((section) => section.key), skeleton.map((section) => section.key));
  assert.equal(plan.sections.find((section) => section.key === "introduction").heading, "Kirish qismi");
  assert.equal(plan.udc, "37.01", "UDK so‘zi kodning o‘zidan ajratiladi");
});

test("a source with no title is not a source, and an older source keeps its fields", () => {
  const plan = readPlan({ empirical: false, udc: "", sections: [], sources: [{ title: "", authors: [] }, { title: "Bor", authors: [{ family: "Ali", given: "V." }] }] }, []);
  assert.equal(plan.sources.length, 1);
  const old = readSource({ title: "Eski", author: "Karimov A.A., Rasulova B.", publisher: "Fan", year: "2019", url: "", page: "12" });
  assert.deepEqual(old.authors.map((person) => person.family), ["Karimov", "Rasulova"]);
  assert.equal(old.pages, "12");
});

test("authors are read the ways people write them", () => {
  assert.deepEqual(parseAuthors("Smith J.; Doe J."), [{ family: "Smith", given: "J." }, { family: "Doe", given: "J." }]);
  assert.deepEqual(parseAuthors("John Smith and Jane Doe").map((person) => person.family), ["Smith", "Doe"]);
  assert.deepEqual(parseAuthors("Karimov, Alisher"), [{ family: "Karimov", given: "Alisher" }]);
  assert.equal(parseAuthors("O‘zbekiston Respublikasi Oliy ta’lim vazirligi")[0].given, "", "tashkilot nomi bo‘linmaydi");
});

test("a citation pointing past the list is dropped, which is how a made-up one arrives", () => {
  assert.deepEqual(readSection({ body: "Matn".repeat(20), citations: [1, 2, 9, 0] }, 2).citations, [1, 2]);
});

test("the plan prompt refuses invented sources out loud, field by field", () => {
  const prompt = planPrompt({ kind: "article", structure: "imrad", language: "en", topic: "T", field: "", requirements: "", skeleton: skeletonFor("article", "imrad", "en") });
  assert.match(prompt, /never invent/i);
  assert.match(prompt, /EMPTY/);
  assert.match(prompt, /udc/i);
});

test("a structure with results, on a topic nobody measured, reports only the sources' results", () => {
  const prompt = sectionPrompt({ kind: "article", structure: "imrad", language: "uz", empirical: false, topic: "T", field: "",
    key: "results", heading: "Natijalar", brief: "", earlier: [], next: null, sources, words: 800 });
  assert.match(prompt, /ran no study of its own/);
});

/* ---------------------------------------------------------------- styles */

test("each style prints the same source its own way", () => {
  const entries = Object.fromEntries(CITATION_STYLES.map((style) => [style, formatReference(sources[1], style, 1, "uz").map((run) => run.text).join("")]));
  assert.match(entries.apa, /^Bekova, B\., & Smith, J\. \(2023\)\. Maqola\. Jurnal, 4\(2\), 45–52\. https:\/\/doi\.org\/10\.1\/x$/);
  assert.match(entries.gost, /^1\. Bekova B\. Maqola \/ B\. Bekova, J\. Smith \/\/ Jurnal\. — 2023\./);
  assert.match(entries.ieee, /^\[1\] B\. Bekova and J\. Smith, “Maqola,”/);
  assert.match(entries.vancouver, /^1\. Bekova B, Smith J\. Maqola\. Jurnal\. 2023;4\(2\):45–52\./);
  assert.match(entries.mla, /^Bekova, B\., and John Smith\. “Maqola\.” Jurnal, vol\. 4, no\. 2, 2023, pp\. 45–52\./);
  assert.match(entries.chicago, /^Bekova, B\., and John Smith\. 2023\. “Maqola\.” Jurnal 4 \(2\): 45–52\./);
  // Journal and book titles are italic where the style says so.
  assert.ok(formatReference(sources[1], "apa", 1, "uz").some((run) => run.italic && run.text === "Jurnal"));
});

test("a missing field leaves nothing behind, and a missing year is the style's own 'no date'", () => {
  const bare = readSource({ type: "web", authors: [], title: "Sahifa", container: "gov.uz", url: "https://gov.uz" });
  for (const style of CITATION_STYLES) {
    const line = formatReference(bare, style, 1, "en").map((run) => run.text).join("");
    assert.doesNotMatch(line, /\.\.|,\.|;\s*\.|\(\)|undefined/, `${style}: ${line}`);
  }
  assert.match(formatReference(bare, "apa", 1, "en").map((run) => run.text).join(""), /\(n\.d\.\)/);
});

test("numeric styles number by first citation; author-date styles sort by author", () => {
  const texts = ["Avval [2], keyin [1]."];
  assert.deepEqual(bibliography(sources, "gost", texts).order, [1, 0]);
  assert.deepEqual(bibliography(sources, "apa", texts).order, [0, 1], "Aliyev, keyin Bekova");
});

test("a marker becomes the style's citation and links to its entry; one to nothing is dropped", () => {
  const list = bibliography(sources, "gost", ["[2] [1]"]);
  const gost = citationRuns("Fikr [2] va [1, 2] hamda [7].", sources, "gost", list, "uz");
  assert.equal(gost.map((run) => run.text).join(""), "Fikr [1] va [1, 2] hamda.");
  assert.equal(gost.find((run) => run.text === "[1]").link, "ref_1");
  const apa = citationRuns("Fikr [2].", sources, "apa", bibliography(sources, "apa", []), "uz");
  assert.equal(apa.map((run) => run.text).join(""), "Fikr (Bekova & Smith, 2023).");
});

/* -------------------------------------------------------------- document */

test("the front of an article: UDC, the title, the authors with ORCID, then each language's abstract with its keywords", () => {
  const lines = paragraphs(documentBlocks(article())).map(text);
  assert.equal(lines[0], "UDK 070.1");
  assert.equal(lines[1], "TALABALAR MEDIA SAVODXONLIGI");
  assert.ok(lines.some((line) => line.includes("ORCID: 0000-0002-1825-0097")));
  const at = (label) => lines.findIndex((line) => line.startsWith(label));
  assert.ok(at("Annotatsiya:") < at("Kalit sözlar:") && at("Kalit sözlar:") < at("Аннотация:") && at("Аннотация:") < at("Ключевые"),
    "har til: annotatsiya, keyin kalit so‘zlar");
  assert.ok(lines.some((line) => line === "Abstract: This is about the article and the study."), "inglizcha qator o‘z imlosida");
});

test("several organisations: each author carries the number of theirs", () => {
  const blocks = documentBlocks(article({ authors: [
    { name: "A Bir", affiliation: "Birinchi", orcid: "", email: "" },
    { name: "B Ikki", affiliation: "Ikkinchi", orcid: "", email: "" },
  ] }));
  const names = paragraphs(blocks).find((block) => text(block).startsWith("A Bir"));
  assert.ok(names.runs.some((run) => run.superscript && run.text === "2"));
});

test("acknowledgements and funding are the author's words or nothing", () => {
  const without = paragraphs(documentBlocks(article())).map(text);
  assert.ok(!without.some((line) => /Moliyala|Minnatdor/.test(line)), "berilmagan bo‘lsa — umuman yo‘q");
  const withFunding = paragraphs(documentBlocks(article({ funding: "F-2021 granti" }))).map(text);
  assert.ok(withFunding.includes("Moliyalaştiriş") && withFunding.includes("F-2021 granti"));
});

test("tables are numbered across the document, captioned above, and referred to by number", () => {
  const body = "[T1] Yondashuvlar\n| Yondashuv | Manba |\n|---|---|\n| Tanqidiy | [1] |\n\nBu [T1] da ko‘rinadi.";
  assert.equal(bodyPieces(body).filter((piece) => piece.kind === "table").length, 1);
  const blocks = documentBlocks(article({ sections: [
    { key: "introduction", heading: "Kirish", body },
    { key: "methods", heading: "Usullar", body },
  ] }));
  const lines = paragraphs(blocks).map(text);
  assert.ok(lines.includes("1-jadval. Yondaşuvlar") && lines.includes("2-jadval. Yondaşuvlar"));
  assert.ok(lines.includes("Bu 2-jadvalda körinadi."), "ikkinchi bo‘limdagi [T1] — hujjatdagi 2-jadval, qo‘shimchasi bilan qo‘shib");
  const tables = blocks.filter((block) => block.kind === "table");
  assert.equal(tables.length, 2);
  assert.ok(tables[0].rows[0].header, "sarlavha qatori");
  assert.equal(numbered("ru", "table", 3), "Таблица 3");
  assert.equal(numbered("en", "figure", 2), "Figure 2");
});

test("the person's figures are numbered and captioned beneath", () => {
  const blocks = documentBlocks(article({ sections: [{ key: "introduction", heading: "Kirish", body: "Matn.",
    figures: [{ index: 0, caption: "Sxema", widthCm: 10, heightCm: 6 }] }] }));
  const at = blocks.findIndex((block) => block.kind === "image");
  assert.ok(at > 0);
  assert.equal(text(blocks[at + 1]), "1-rasm. Sxema");
});

test("the bibliography: numbered and bookmarked in a numeric style, hanging in an author-date one", () => {
  const gost = paragraphs(documentBlocks(article()));
  const first = gost.find((block) => block.bookmark === "ref_1");
  assert.ok(text(first).startsWith("1. Bekova"), "birinchi tilga olingan — 1-raqam");
  const apa = paragraphs(documentBlocks(article({ style: "apa" })));
  assert.ok(apa.find((block) => block.bookmark === "ref_1").hanging > 0);
});

test("the layout is the journal's: the preset and the person's adjustments, within bounds", () => {
  assert.equal(readLayout({}).fontSize, 14);
  assert.equal(readLayout({ preset: "apa" }).lineSpacing, 2);
  assert.equal(readLayout({ preset: "journal", fontSize: 13 }).fontSize, 13);
  assert.equal(readLayout({ fontSize: 40 }).fontSize, 14, "chegaradan tashqari — shablonniki");
  const body = paragraphs(documentBlocks(article({ layout: LAYOUT_PRESETS.journal }))).find((block) => text(block).startsWith("Birinçi"));
  assert.equal(body.lineSpacing, 1.15);
  assert.equal(body.align, "both");
  assert.equal(body.indent, 1);
});

/* --------------------------------------------------------------- typeset */

const measure = (value, size) => value.length * size * 0.5;

test("justified lines reach the right margin; the last line does not", () => {
  const words = Array.from({ length: 120 }, (_, at) => `soz${at}`).join(" ");
  const set = typeset([{ kind: "paragraph", runs: [{ text: words }], align: "both", indent: 1.25, lineSpacing: 1.5 }], measure,
    { page: pageOf(LAYOUT_PRESETS.uz), fontSize: 14 });
  const items = set.pages[0].items;
  const lines = [...new Set(items.map((item) => item.y))];
  const right = (y) => Math.max(...items.filter((item) => item.y === y).map((item) => item.x + measure(item.text, item.size)));
  const edge = set.width - 1.5 * 72 / 2.54;
  assert.ok(Math.abs(right(lines[0]) - edge) < 0.5, "birinchi qator o‘ng chetga yetadi");
  assert.ok(right(lines[lines.length - 1]) < edge - 5, "oxirgi qator cho‘zilmaydi");
  assert.ok(items[0].x > 3 * 72 / 2.54 + 30, "birinchi qator chekinish bilan");
});

test("a long text flows onto further pages, each numbered at its foot", () => {
  const blocks = Array.from({ length: 30 }, () => ({ kind: "paragraph", runs: [{ text: "so‘z ".repeat(120) }], lineSpacing: 1.5 }));
  const set = typeset(blocks, measure, { page: pageOf(LAYOUT_PRESETS.uz), fontSize: 14, pageNumbers: true });
  assert.ok(set.pages.length > 3);
  const bottom = set.height - 2 * 72 / 2.54;
  for (const [at, page] of set.pages.entries()) {
    const texts = page.items.filter((item) => item.kind === "text");
    assert.ok(texts.filter((item) => item.text !== String(at + 1)).every((item) => item.y <= bottom + 0.5), "hoshiyadan pastga tushmaydi");
    assert.ok(texts.some((item) => item.text === String(at + 1) && item.y > bottom), `${at + 1}-sahifa raqami`);
  }
});

test("a heading never ends a page", () => {
  const filler = Array.from({ length: 24 }, () => ({ kind: "paragraph", runs: [{ text: "x" }], lineSpacing: 1.5 }));
  const blocks = [...filler, { kind: "paragraph", runs: [{ text: "Sarlavha" }], style: "Heading1", keepNext: true }, { kind: "paragraph", runs: [{ text: "matn" }] }];
  const set = typeset(blocks, measure, { page: pageOf(LAYOUT_PRESETS.uz), fontSize: 14 });
  const page = set.pages.findIndex((sheet) => sheet.items.some((item) => item.text === "Sarlavha"));
  assert.ok(set.pages[page].items.some((item) => item.text === "matn"), "sarlavha o‘z matni bilan bir sahifada");
});

test("a table that breaks repeats its header row", () => {
  const row = (cells, header = false) => ({ header, cells: cells.map((cell) => ({ blocks: [{ kind: "paragraph", runs: [{ text: cell }] }] })) });
  const rows = [row(["Ustun", "Qiymat"], true), ...Array.from({ length: 60 }, (_, at) => row([`q${at}`, "v"]))];
  const set = typeset([{ kind: "table", borders: true, rows }], measure, { page: pageOf(LAYOUT_PRESETS.uz), fontSize: 14 });
  assert.ok(set.pages.length >= 2);
  assert.ok(set.pages[1].items.some((item) => item.text === "Ustun" && item.bold));
});

/* ------------------------------------------------------------------ docx */

test("the Word file links each citation to its entry and numbers its pages", async () => {
  const blocks = documentBlocks(article());
  const bytes = await buildDocx({ blocks, fontSize: 14, page: pageOf(LAYOUT_PRESETS.uz), pageNumbers: true });
  const files = await unzip(bytes);
  const read = (name) => new TextDecoder().decode(files.get(name));
  const xml = read("word/document.xml");
  assert.match(xml, /<w:hyperlink w:anchor="ref_1"/);
  assert.match(xml, /<w:bookmarkStart w:id="\d+" w:name="ref_1"\/>/);
  assert.match(xml, /<w:footerReference w:type="default" r:id="rIdFooter"\/>/);
  assert.match(read("word/footer1.xml"), /PAGE/);
});

test("words are counted, so a short section can be told from a long one", () => {
  assert.equal(wordCount("bir ikki  uch\n\nto‘rt"), 4);
  assert.equal(wordCount("   "), 0);
});
