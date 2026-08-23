/**
 * Four academic documents that differ in structure and in almost nothing else.
 *
 * An article, an independent work, a referat and a course paper: the same
 * research, the same section-by-section writing, the same citation rules, four
 * skeletons. Keeping them as one thing with four skeletons is what stops the
 * referat quietly getting a fix the course paper needed too.
 *
 * Two rules run through everything here and neither is negotiable.
 *
 * **Nothing is invented.** Not a source, not an author, not a year, not a page
 * number, and above all not a finding. An article about a topic nobody here ran
 * an experiment on does not get a Results section — it gets the structure a
 * review article has — because a Results section has to be filled with
 * something, and the only thing available would be fiction.
 *
 * **A page number is a claim.** It is written only when the research actually
 * established it. A citation that looks precise and is guessed is worse than
 * one that does not, because it invites somebody to go and check.
 *
 * Pure: structures, prompts, readers and the document's blocks. No provider, no
 * database.
 */

import { paragraph, type Block } from "./docx.ts";

export type WorkKind = "article" | "independent" | "referat" | "coursework";

export const WORK_KINDS: { kind: WorkKind; label: string; sections: number; pages: string }[] = [
  { kind: "article", label: "Ilmiy maqola", sections: 8, pages: "8–12 bet" },
  { kind: "independent", label: "Mustaqil ish", sections: 7, pages: "12–20 bet" },
  { kind: "referat", label: "Referat", sections: 6, pages: "10–15 bet" },
  { kind: "coursework", label: "Kurs ishi", sections: 9, pages: "25–35 bet" },
];

export type Source = {
  title: string;
  author: string;
  publisher: string;
  year: string;
  url: string;
  /** Only when the research actually established it. Empty otherwise. */
  page: string;
};

export type PlannedSection = { key: string; heading: string; brief: string };

export type Plan = {
  empirical: boolean;
  sections: PlannedSection[];
  sources: Source[];
};

/* ------------------------------------------------------------- skeletons */

/**
 * IMRAD, but only when there is an I, an M, an R and a D to write.
 *
 * The empirical skeleton is what a paper reporting original work looks like.
 * The other one is what a review looks like, and choosing it is not a lesser
 * version of the first: a theoretical article with a Methods section describing
 * a study nobody ran is not a weaker article, it is a false one.
 */
const ARTICLE_EMPIRICAL: PlannedSection[] = [
  { key: "abstract", heading: "Annotatsiya", brief: "150–250 so‘z: muammo, usul, natija, xulosa" },
  { key: "keywords", heading: "Kalit so‘zlar", brief: "5–8 ta atama, vergul bilan" },
  { key: "introduction", heading: "Kirish", brief: "Muammo, dolzarblik, tadqiqot maqsadi" },
  { key: "methods", heading: "Materiallar va usullar", brief: "Faqat manbalarda tasvirlangan usullar" },
  { key: "results", heading: "Natijalar", brief: "Faqat manbalardagi haqiqiy natijalar" },
  { key: "discussion", heading: "Muhokama", brief: "Natijalarni izohlash va boshqa ishlar bilan qiyoslash" },
  { key: "conclusion", heading: "Xulosa", brief: "Asosiy xulosalar va keyingi yo‘nalishlar" },
];

const ARTICLE_REVIEW: PlannedSection[] = [
  { key: "abstract", heading: "Annotatsiya", brief: "150–250 so‘z: mavzu, ko‘rib chiqilgan yondashuvlar, xulosa" },
  { key: "keywords", heading: "Kalit so‘zlar", brief: "5–8 ta atama, vergul bilan" },
  { key: "introduction", heading: "Kirish", brief: "Muammo va uni ko‘rib chiqish zarurati" },
  { key: "review", heading: "Mavzuning o‘rganilganlik darajasi", brief: "Mavjud tadqiqotlar sharhi, manbalarga tayangan" },
  { key: "analysis", heading: "Tahlil", brief: "Yondashuvlarni qiyoslash, kuchli va zaif tomonlari" },
  { key: "discussion", heading: "Muhokama", brief: "Umumlashtirish va ochiq savollar" },
  { key: "conclusion", heading: "Xulosa", brief: "Asosiy xulosalar" },
];

const INDEPENDENT: PlannedSection[] = [
  { key: "plan", heading: "Reja", brief: "Ish tuzilmasi, sarlavhalar ro‘yxati" },
  { key: "introduction", heading: "Kirish", brief: "Mavzu, dolzarblik, maqsad va vazifalar" },
  { key: "chapter_1", heading: "I bob. Nazariy asoslar", brief: "Tushunchalar, ta’riflar, tarixi" },
  { key: "chapter_2", heading: "II bob. Tahlil", brief: "Mavzuning amaldagi holati, manbalarga tayangan" },
  { key: "chapter_3", heading: "III bob. Amaliy jihatlar", brief: "Qo‘llanilishi, misollar, tavsiyalar" },
  { key: "conclusion", heading: "Xulosa", brief: "Vazifalarga javob beruvchi xulosalar" },
];

const REFERAT: PlannedSection[] = [
  { key: "plan", heading: "Reja", brief: "Ish tuzilmasi" },
  { key: "introduction", heading: "Kirish", brief: "Mavzu va uning ahamiyati" },
  { key: "chapter_1", heading: "Asosiy qism. Tushuncha va mohiyat", brief: "Ta’riflar va asosiy tushunchalar" },
  { key: "chapter_2", heading: "Asosiy qism. Tahlil va misollar", brief: "Aniq misollar, manbalarga tayangan" },
  { key: "conclusion", heading: "Xulosa", brief: "Qisqa, aniq xulosalar" },
];

const COURSEWORK: PlannedSection[] = [
  { key: "plan", heading: "Mundarija", brief: "Ish tuzilmasi" },
  { key: "introduction", heading: "Kirish", brief: "Dolzarblik, maqsad, vazifalar, obyekt va predmet" },
  { key: "chapter_1", heading: "I bob. Nazariy asoslar", brief: "Tushunchalar, tarixi, yondashuvlar" },
  { key: "chapter_1_2", heading: "1.2. Mavzuning o‘rganilganlik darajasi", brief: "Mavjud tadqiqotlar sharhi" },
  { key: "chapter_2", heading: "II bob. Tahlil", brief: "Amaldagi holat, manbalardagi ma’lumotlar" },
  { key: "chapter_2_2", heading: "2.2. Muammolar va sabablari", brief: "Aniqlangan muammolar" },
  { key: "chapter_3", heading: "III bob. Tavsiyalar", brief: "Amaliy takliflar, har biri asoslangan" },
  { key: "conclusion", heading: "Xulosa", brief: "Vazifalarga javob beruvchi xulosalar" },
];

/** The skeleton a work starts from, before the planner adapts it. */
export function skeletonFor(kind: WorkKind, empirical: boolean): PlannedSection[] {
  if (kind === "article") return empirical ? ARTICLE_EMPIRICAL : ARTICLE_REVIEW;
  if (kind === "independent") return INDEPENDENT;
  if (kind === "referat") return REFERAT;
  return COURSEWORK;
}

/** Every work ends with its bibliography, and it is assembled, never written. */
export const REFERENCES_KEY = "references";
export const REFERENCES_HEADING = "Foydalanilgan adabiyotlar";

/* ---------------------------------------------------------------- the plan */

export const PLAN_SCHEMA_NAME = "academic_plan";

export function planSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      empirical: { type: "boolean" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            heading: { type: "string" },
            brief: { type: "string" },
          },
          required: ["key", "heading", "brief"],
        },
      },
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            author: { type: "string" },
            publisher: { type: "string" },
            year: { type: "string" },
            url: { type: "string" },
            page: { type: "string" },
          },
          required: ["title", "author", "publisher", "year", "url", "page"],
        },
      },
    },
    required: ["empirical", "sections", "sources"],
  };
}

export const PLAN_SYSTEM =
  "You are an Uzbek academic supervisor planning a student's written work and finding the sources it will be built on. "
  + "Every source must be one you can actually name — a real journal, book, university or government publication — with its real author and year. "
  + "Never invent a source, an author, a year, a DOI or a page number. If you are not certain a page number is correct, leave it empty. "
  + "Return only the required schema.";

export function planPrompt(input: {
  kind: WorkKind;
  topic: string;
  field: string;
  requirements: string;
  skeleton: readonly PlannedSection[];
}): string {
  const label = WORK_KINDS.find((entry) => entry.kind === input.kind)?.label ?? "Ilmiy ish";
  return [
    `Ish turi: ${label}`,
    `Mavzu: ${input.topic}`,
    input.field ? `Yo‘nalish: ${input.field}` : null,
    input.requirements ? `Talablar: ${input.requirements}` : null,
    "",
    "Vazifa: shu ish uchun REJA tuzing va MANBALAR toping.",
    "",
    "QOIDALAR:",
    "1. Faqat o‘zbek lotin tilida.",
    "2. \"empirical\" — bu mavzu bo‘yicha haqiqiy tajriba, so‘rovnoma yoki o‘lchov o‘tkazilgan tadqiqotlar mavjudmi? Agar mavzu nazariy bo‘lsa yoki manbalarda empirik natija bo‘lmasa, false qiling.",
    "3. Manbalar HAQIQIY bo‘lsin: real jurnal, kitob, universitet yoki davlat nashri. Muallif va yil aniq bo‘lsin.",
    "4. Manba yo‘q bo‘lsa, uni O‘YLAB TOPMANG — ro‘yxatni qisqaroq qoldiring.",
    "5. \"page\" — faqat sahifa raqamini ishonch bilan bilsangiz yozing. Aks holda bo‘sh qoldiring.",
    "6. Tez eskiradigan mavzularda (texnologiya, iqtisodiyot, qonunchilik) yangi manbalarni afzal ko‘ring; tarixiy yoki barqaror mavzularda klassik manbalar ham mumkin.",
    "7. Bo‘limlar quyidagi tuzilmaga mos bo‘lsin, lekin sarlavhalarni mavzuga moslashtiring:",
    JSON.stringify(input.skeleton.map((section) => ({ key: section.key, heading: section.heading }))),
    "8. \"key\" qiymatlarini o‘zgartirmang — ular ish tuzilmasini bog‘laydi.",
    "9. \"brief\" — o‘sha bo‘limda nima yozilishi kerakligi, bir-ikki jumlada.",
  ].filter(Boolean).join("\n");
}

const text = (value: unknown, max: number): string =>
  String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The plan, made to fit the skeleton it was asked for.
 *
 * The model may rename a heading — which is wanted, a heading should suit the
 * topic — but the keys are the work's spine and are taken from the skeleton
 * regardless. A model that renamed `chapter_2` would otherwise orphan whatever
 * was already written into it.
 */
export function readPlan(answer: unknown, skeleton: readonly PlannedSection[]): Plan {
  const raw = (answer ?? {}) as Partial<Plan>;
  const given = new Map<string, PlannedSection>();
  for (const section of Array.isArray(raw.sections) ? raw.sections : []) {
    const key = text((section as PlannedSection)?.key, 40);
    if (key) given.set(key, section as PlannedSection);
  }

  const sources: Source[] = [];
  for (const entry of Array.isArray(raw.sources) ? raw.sources : []) {
    const source = entry as Partial<Source>;
    const title = text(source.title, 300);
    if (!title) continue;
    sources.push({
      title,
      author: text(source.author, 200),
      publisher: text(source.publisher, 200),
      year: text(source.year, 12),
      url: text(source.url, 500),
      page: text(source.page, 40),
    });
    if (sources.length >= 20) break;
  }

  return {
    empirical: Boolean(raw.empirical),
    sections: skeleton.map((section) => {
      const planned = given.get(section.key);
      return {
        key: section.key,
        heading: text(planned?.heading, 200) || section.heading,
        brief: text(planned?.brief, 400) || section.brief,
      };
    }),
    sources,
  };
}

/* ------------------------------------------------------------- a section */

export const SECTION_SCHEMA_NAME = "academic_section";

export function sectionSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      body: { type: "string" },
      citations: { type: "array", items: { type: "integer" } },
    },
    required: ["body", "citations"],
  };
}

export const SECTION_SYSTEM =
  "You are writing one section of a student's academic work in flawless Uzbek Latin. "
  + "Write original prose that synthesises the supplied sources — never copy them, never pad, never repeat the same idea in different words. "
  + "Never invent a statistic, a date, a study, a finding or a source. Everything factual must trace to a source you were given. "
  + "Return only the required schema.";

export function sectionPrompt(input: {
  kind: WorkKind;
  topic: string;
  field: string;
  heading: string;
  brief: string;
  /** What the previous sections concluded, so the argument continues. */
  earlier: { heading: string; summary: string }[];
  next: string | null;
  sources: readonly Source[];
  words: number;
}): string {
  return [
    `Mavzu: ${input.topic}`,
    input.field ? `Yo‘nalish: ${input.field}` : null,
    `Yoziladigan bo‘lim: ${input.heading}`,
    `Bu bo‘limda nima bo‘lishi kerak: ${input.brief}`,
    input.next ? `Keyingi bo‘lim: ${input.next}` : "Bu oxirgi mazmun bo‘limi.",
    "",
    input.earlier.length > 0
      ? `OLDINGI BO‘LIMLAR (takrorlamang, ularga tayanib davom eting):\n${
        input.earlier.map((entry) => `— ${entry.heading}: ${entry.summary}`).join("\n")}`
      : "Bu ishning birinchi mazmun bo‘limi.",
    "",
    `MANBALAR (raqami bilan murojaat qiling):\n${
      input.sources.map((source, index) =>
        `[${index + 1}] ${source.author ? `${source.author}. ` : ""}${source.title}. `
        + `${source.publisher}${source.year ? `, ${source.year}` : ""}.`).join("\n")}`,
    "",
    "QOIDALAR:",
    `1. Taxminan ${input.words} so‘z yozing.`,
    "2. Faqat mukammal o‘zbek lotin tilida, akademik uslubda.",
    "3. Manbadagi fikrga tayanganda matn ichida [1], [2] ko‘rinishida ko‘rsating va \"citations\" ga o‘sha raqamlarni yozing.",
    "4. Raqam, sana, foiz yoki tadqiqot natijasini O‘YLAB TOPMANG. Manbalarda yo‘q bo‘lsa, umumiy tarzda yozing.",
    "5. \"Bugungi kunda\", \"Ma’lumki\", \"Muhim ahamiyatga ega\" kabi quruq iboralarni ishlatmang.",
    "6. Abzaslarni \\n\\n bilan ajrating. Har abzas bitta fikrni oxirigacha aytsin.",
    "7. Sarlavhani qaytadan yozmang — faqat bo‘lim matni.",
  ].filter(Boolean).join("\n");
}

export type WrittenSection = { body: string; citations: number[] };

export function readSection(answer: unknown, sourceCount: number): WrittenSection {
  const raw = (answer ?? {}) as { body?: unknown; citations?: unknown };
  const body = String(raw.body ?? "").replace(/\r/g, "").trim().slice(0, 24_000);
  const citations = (Array.isArray(raw.citations) ? raw.citations : [])
    .map((entry) => Number(entry))
    // A citation pointing past the list is a citation to nothing, which is the
    // shape a fabricated one arrives in.
    .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= sourceCount);
  return { body, citations: [...new Set(citations)].sort((a, b) => a - b) };
}

export const wordCount = (body: string): number =>
  body.trim() ? body.trim().split(/\s+/).length : 0;

/* ----------------------------------------------------------- the document */

/** One entry of the bibliography, in the order the sources were found. */
export function referenceLine(source: Source, index: number): string {
  const parts = [
    `${index + 1}.`,
    source.author ? `${source.author}.` : "",
    `${source.title}.`,
    source.publisher ? `${source.publisher},` : "",
    source.year || "",
    source.page ? `— B. ${source.page}.` : "",
    source.url || "",
  ];
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * The finished work, as blocks both renderers understand.
 *
 * Times New Roman 14 at one-and-a-half spacing, justified, first line indented
 * — which is not a preference, it is what the document is required to be, and a
 * paper handed in at single spacing comes back.
 */
export function documentBlocks(input: {
  kind: WorkKind;
  topic: string;
  field: string;
  authorName: string | null;
  organization: string | null;
  sections: readonly { heading: string; body: string }[];
  sources: readonly Source[];
}): Block[] {
  const label = WORK_KINDS.find((entry) => entry.kind === input.kind)?.label ?? "Ilmiy ish";
  const blocks: Block[] = [];

  // The title page, which every one of these is handed in with.
  blocks.push(paragraph(input.organization ?? "", { align: "center", spaceAfter: 24 }));
  blocks.push(paragraph([{ text: label.toLocaleUpperCase("uz"), bold: true }], { align: "center", spaceAfter: 12 }));
  blocks.push(paragraph([{ text: input.topic, bold: true, size: 16 }], { align: "center", spaceAfter: 24 }));
  if (input.field) blocks.push(paragraph(`Yo‘nalish: ${input.field}`, { align: "center", spaceAfter: 6 }));
  if (input.authorName) blocks.push(paragraph(`Bajardi: ${input.authorName}`, { align: "center", spaceAfter: 6 }));
  blocks.push(paragraph(String(new Date().getFullYear()), { align: "center" }));

  input.sections.forEach((section, index) => {
    blocks.push(paragraph([{ text: section.heading, bold: true }], {
      style: "Heading1",
      align: "center",
      pageBreakBefore: index === 0,
      spaceAfter: 8,
    }));
    for (const block of section.body.split(/\n{2,}/)) {
      if (!block.trim()) continue;
      blocks.push(paragraph(block.trim(), { align: "both", lineSpacing: 1.5, indent: 1.25, spaceAfter: 0 }));
    }
  });

  if (input.sources.length > 0) {
    blocks.push(paragraph([{ text: REFERENCES_HEADING, bold: true }], {
      style: "Heading1", align: "center", pageBreakBefore: true, spaceAfter: 8,
    }));
    input.sources.forEach((source, index) => {
      blocks.push(paragraph(referenceLine(source, index), { lineSpacing: 1.5, spaceAfter: 0 }));
    });
  }

  return blocks;
}
