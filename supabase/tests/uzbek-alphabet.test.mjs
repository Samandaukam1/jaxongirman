import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

/**
 * What the server writes in Uzbek, in the updated alphabet (O‘ → Ö, G‘ → Ğ,
 * Sh → Ş, Ch → Ç): decks, defence scripts, academic works and the obyektivka.
 * The models still write the current alphabet; these are the places it is
 * respelled, and the things each of them must leave alone.
 */

const edge = buildEdgeModules();
const { spellSlide, spellOutline, spellText } = await import(`${edge}/glass/spelling.js`);
const { CHROME, facesFor } = await import(`${edge}/glass/language.js`);
const { textWidth } = await import(`${edge}/glass/text.js`);
const { spellDefense } = await import(`${edge}/defense.js`);
const { LAYOUT_PRESETS, documentBlocks, looksEnglish, spellUzbek } = await import(`${edge}/academic.js`);
const { objectiveBlocks, missingFields } = await import(`${edge}/objective.js`);

const OLD_SPELLING = /[oOgG][‘ʻ'’]|sh|ch/i;

function runsOf(blocks, into = []) {
  for (const block of blocks) {
    if (block.kind === "paragraph") into.push(...block.runs.map((run) => run.text));
    if (block.kind === "table") for (const row of block.rows) for (const cell of row.cells) runsOf(cell.blocks, into);
  }
  return into;
}

const slide = {
  kind: "comparison",
  title: "O‘zbekiston shaharlari",
  eyebrow: "TOSHKENT",
  lead: "Ikki shahar taqqoslanadi.",
  points: [{ title: "Bog‘lar", text: "Chorbog‘ an’anasi.", icon: "tree" }],
  stats: [{ value: "2,4 mln", label: "aholi soni (Toshkent)" }],
  quote: { text: "Shahar — xalqning ko‘zgusi.", author: "Cho‘lpon" },
  chart: { labels: ["Qo‘qon", "Shahrisabz"], names: ["Qo‘qon shahri", "Shahrisabz shahri"], values: [1, 2], unit: "ming kishi", insight: "O‘sish bor." },
  left: { heading: "Shimol", points: ["Choʻl"] },
  right: { heading: "Janub", points: ["Tog‘"] },
  imageQuery: "children in Tashkent school",
  icon: "chart",
  sources: [1],
};

test("an Uzbek page's words are respelled; its kind, icons, sources and photo search are not", () => {
  const spelled = spellSlide(slide, "uz");
  assert.equal(spelled.title, "Özbekiston şaharlari");
  assert.equal(spelled.eyebrow, "TOŞKENT");
  assert.equal(spelled.points[0].title, "Boğlar");
  assert.equal(spelled.points[0].icon, "tree");
  assert.equal(spelled.quote.author, "Çölpon");
  assert.deepEqual(spelled.chart.labels, ["Qöqon", "Şahrisabz"]);
  assert.deepEqual(spelled.chart.values, [1, 2]);
  assert.deepEqual(spelled.left.points, ["Çöl"]);
  assert.equal(spelled.kind, "comparison");
  assert.equal(spelled.imageQuery, "children in Tashkent school");
  assert.equal(spelled.icon, "chart");
  assert.deepEqual(spelled.sources, [1]);
});

test("English and Russian pages are left exactly as written", () => {
  assert.equal(spellSlide(slide, "en"), slide);
  assert.equal(spellSlide(slide, "ru"), slide);
  assert.equal(spellText("Shohjahon", "en"), "Shohjahon");
  assert.equal(spellText("Shohjahon", "uz"), "Şohjahon");
  assert.equal(spellText(null, "uz"), null);
});

test("the outline's titles are respelled and the cover search is not", () => {
  const outline = {
    art: null, shortTitle: "Toshkent tarixi", subtitle: "Ko‘hna shahar", coverQuery: "Tashkent old city",
    slides: [{ title: "Chorsu bozori", kind: "photo", focus: "Savdo yo‘llari", imageQuery: "Chorsu bazaar" }],
  };
  const spelled = spellOutline(outline, "uz");
  assert.equal(spelled.shortTitle, "Toşkent tarixi");
  assert.equal(spelled.subtitle, "Köhna şahar");
  assert.equal(spelled.slides[0].title, "Çorsu bozori");
  assert.equal(spelled.slides[0].imageQuery, "Chorsu bazaar");
  assert.equal(spelled.coverQuery, "Tashkent old city");
});

test("the words around an Uzbek deck are in the updated alphabet", () => {
  const uz = CHROME.uz;
  for (const [key, value] of Object.entries(uz)) {
    const said = typeof value === "function" ? value(5) : value;
    assert.doesNotMatch(said, OLD_SPELLING, key);
  }
  assert.equal(uz.teacher, "Öqituvçi");
});

test("an Uzbek deck never picks a face without Ğ and Ş", () => {
  const all = () => true;
  assert.equal(facesFor("uz", all)("Prata", 400), false);
  assert.equal(facesFor("uz", all)("Manrope", 400), true);
  assert.equal(facesFor("en", all)("Prata", 400), true);
});

test("Ö Ğ Ş Ç are measured as wide as O G S C", () => {
  for (const family of ["Manrope", "Poppins", "Lato"]) {
    const font = { family, weight: 400, em: 0.5 };
    assert.equal(textWidth("ÖĞŞÇöğşç", 20, font), textWidth("OGSCogsc", 20, font), family);
  }
});

test("a defence script in Uzbek is respelled, and only in Uzbek", () => {
  const script = {
    introduction: "Assalomu alaykum, hurmatli o‘qituvchi!",
    conclusion: "E’tiboringiz uchun rahmat.",
    sections: [{ slide_number: 1, slide_title: "Toshkent", speaker_text: "Shahar o‘sdi.", key_point: "Chorsu", transition_to_next: "Endi bog‘larga o‘tamiz." }],
  };
  const spelled = spellDefense(script, "uz");
  assert.equal(spelled.introduction, "Assalomu alaykum, hurmatli öqituvçi!");
  assert.equal(spelled.sections[0].transition_to_next, "Endi boğlarga ötamiz.");
  assert.equal(spelled.sections[0].slide_number, 1);
  assert.equal(spellDefense(script, "en"), script);
});

test("an academic work keeps its English abstract and its sources as written", () => {
  const abstract = [
    "Annotatsiya: Maqolada o‘quv jarayoni tahlil qilinadi.",
    "Аннотация: В статье анализируется учебный процесс.",
    "Abstract: The article examines how each school changes its approach to research.",
  ].join("\n");
  const [uz, ru, en] = spellUzbek(abstract).split("\n");
  assert.equal(uz, "Annotatsiya: Maqolada öquv jarayoni tahlil qilinadi.");
  assert.equal(ru, "Аннотация: В статье анализируется учебный процесс.");
  assert.equal(en, "Abstract: The article examines how each school changes its approach to research.");
  assert.equal(looksEnglish("Keywords: change, research, teaching"), true);
  assert.equal(looksEnglish("Kalit so‘zlar: ta’lim, o‘qituvchi"), false);

  const blocks = documentBlocks({
    kind: "article", structure: "review", language: "uz", title: "O‘quv jarayonida raqamli vositalar", field: "Pedagogika",
    authors: [{ name: "Shohjahon Karimov", affiliation: "Toshkent davlat universiteti", orcid: "", email: "" }],
    udc: "", acknowledgements: "", funding: "", style: "apa", layout: LAYOUT_PRESETS.uz,
    sections: [{ key: "introduction", heading: "Kirish", body: "Ushbu ishda o‘quvchilar o‘rganildi." }],
    sources: [{ type: "book", authors: [{ family: "Smith", given: "J." }], title: "Teaching with technology", container: "", publisher: "Chicago Press",
      place: "", year: "2020", volume: "", issue: "", pages: "", doi: "", url: "https://example.com/teach" }],
  });
  const text = runsOf(blocks);
  assert.ok(text.includes("ÖQUV JARAYONIDA RAQAMLI VOSITALAR"), text[0]);
  assert.ok(text.includes("Şohjahon Karimov"));
  assert.ok(text.includes("Kiriş"));
  assert.ok(text.includes("Uşbu işda öquvçilar örganildi."));
  // The title is its own (italic) run in APA; both it and the publisher keep the spelling they were published under.
  assert.ok(text.includes("Teaching with technology") && text.some((line) => line.includes("Chicago Press")), "the source keeps its spelling");
});

test("the obyektivka is set in the updated alphabet, labels and answers alike", () => {
  const blocks = objectiveBlocks({
    fullName: "Qurbonnazarov Jaxongir",
    fields: { birth_date: "24.01.2001", birth_place: "Toshkent shahri", education: "Oliy", languages: "Ingliz tili" },
    work: [{ period: "2024 – h.v.", detail: "O‘zbekiston jurnalistika universiteti talabasi" }],
    relatives: [{ relation: "Otasi", name: "Qurbonnazarov Shuhrat", born: "1970, Toshkent", work: "O‘qituvchi", address: "Chilonzor tumani" }],
  }, { textWidthCm: 17 });
  const text = runsOf(blocks).join("\n");
  assert.doesNotMatch(text, /[oOgG][‘ʻ'’]|sh|ch/i);
  assert.match(text, /Tuğilgan yili/);
  assert.match(text, /Toşkent şahri/);
  assert.match(text, /Çilonzor/);
  assert.ok(missingFields({ fullName: "", fields: {}, work: [], relatives: [] }).includes("F.I.Ş."));
});
