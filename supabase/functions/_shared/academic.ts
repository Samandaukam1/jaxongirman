/**
 * Academic writing: a journal article in one of six structures, an
 * independent work, a referat and a course paper.
 *
 * The same research, the same section-by-section writing and the same
 * citation rules for all of them; what differs is the skeleton, and for an
 * article the person chooses it: IMRAD, ILMRAD, a review, a case study, a
 * short communication or a theoretical article. Everything a journal asks of
 * the paper around the prose is here too — the authors with their
 * organisations and ORCID iDs, the UDC code, the abstract and keywords in
 * three languages, acknowledgements and funding, a bibliography in the style
 * the journal names, tables numbered and captioned, and the font, spacing and
 * margins the journal sets.
 *
 * Two rules run through everything and neither is negotiable.
 *
 * **Nothing is invented.** Not a source, not an author, not a year, not a page
 * number, not a figure in a table, and above all not a finding. A structure
 * with a Results section is still allowed on a topic nobody here measured —
 * the person chose it — but its results are those the sources report, said to
 * be theirs. Acknowledgements and funding are the person's words or nothing:
 * a grant number the model made up would be a lie in the person's name.
 *
 * **A page number is a claim.** It is written only when the research actually
 * established it.
 *
 * Pure: structures, prompts, readers and the document's blocks.
 */

import { toNewAlphabet } from "./alphabet.ts";
import {
  bibliography, citationRuns, formatReference, hangs, readSource, referenceAnchor,
  type CitationStyle, type DocLanguage, type Source,
} from "./citations.ts";
import { paragraph, table, type Block, type Paragraph, type Run } from "./docx.ts";

export type { CitationStyle, DocLanguage, Source } from "./citations.ts";

export type WorkKind = "article" | "independent" | "referat" | "coursework";
export type Structure = "imrad" | "ilmrad" | "review" | "case_study" | "short" | "theoretical";
export const STRUCTURES: Structure[] = ["imrad", "ilmrad", "review", "case_study", "short", "theoretical"];
export const LANGUAGES: DocLanguage[] = ["uz", "ru", "en", "tr"];

export const WORK_KINDS: { kind: WorkKind; label: string; pages: string }[] = [
  { kind: "article", label: "Ilmiy maqola", pages: "8–12 bet" },
  { kind: "independent", label: "Mustaqil ish", pages: "12–20 bet" },
  { kind: "referat", label: "Referat", pages: "10–15 bet" },
  { kind: "coursework", label: "Kurs ishi", pages: "25–35 bet" },
];

export type Author = { name: string; affiliation: string; orcid: string; email: string };

export type PlannedSection = { key: string; heading: string; brief: string };

export type Plan = { empirical: boolean; udc: string; sections: PlannedSection[]; sources: Source[] };

/* ------------------------------------------------------------- the words */

/** Every heading a skeleton uses, and every label the document prints, in four languages. */
const WORDS: Record<DocLanguage, Record<string, string>> = {
  uz: {
    abstract: "Annotatsiya", keywords: "Kalit so‘zlar", introduction: "Kirish", literature: "Adabiyotlar tahlili",
    methods: "Materiallar va usullar", results: "Natijalar", discussion: "Muhokama", conclusion: "Xulosa",
    review_1: "Mavzuning o‘rganilganlik darajasi", review_2: "Asosiy yondashuvlar", review_3: "Ochiq masalalar va yo‘nalishlar",
    background: "Holat tavsifi va kontekst", case: "Keys tahlili", lessons: "Muhokama va saboqlar",
    theory: "Nazariy asos", framework: "Taklif etilayotgan konsepsiya", arguments: "Asoslash va argumentlar",
    implications: "Nazariy va amaliy ahamiyati", discussion_conclusion: "Muhokama va xulosa",
    plan: "Reja", contents: "Mundarija",
    ch1_theory: "I bob. Nazariy asoslar", ch1_review: "1.2. Mavzuning o‘rganilganlik darajasi", ch2_analysis: "II bob. Tahlil",
    ch2_problems: "2.2. Muammolar va sabablari", ch3_practice: "III bob. Amaliy jihatlar", ch3_advice: "III bob. Tavsiyalar",
    main_concept: "Asosiy qism. Tushuncha va mohiyat", main_analysis: "Asosiy qism. Tahlil va misollar",
    references: "Foydalanilgan adabiyotlar", acknowledgements: "Minnatdorchilik", funding: "Moliyalashtirish", udc: "UDK",
    table: "jadval", figure: "rasm", language: "Uzbek in the Latin script", abstractLabel: "Annotatsiya:", keywordsLabel: "Kalit so‘zlar:",
  },
  ru: {
    abstract: "Аннотация", keywords: "Ключевые слова", introduction: "Введение", literature: "Обзор литературы",
    methods: "Материалы и методы", results: "Результаты", discussion: "Обсуждение", conclusion: "Заключение",
    review_1: "Степень изученности темы", review_2: "Основные подходы", review_3: "Нерешённые вопросы и направления",
    background: "Описание ситуации и контекст", case: "Анализ кейса", lessons: "Обсуждение и уроки",
    theory: "Теоретические основы", framework: "Предлагаемая концепция", arguments: "Обоснование и аргументы",
    implications: "Теоретическое и практическое значение", discussion_conclusion: "Обсуждение и заключение",
    plan: "План", contents: "Содержание",
    ch1_theory: "Глава I. Теоретические основы", ch1_review: "1.2. Степень изученности темы", ch2_analysis: "Глава II. Анализ",
    ch2_problems: "2.2. Проблемы и их причины", ch3_practice: "Глава III. Практические аспекты", ch3_advice: "Глава III. Рекомендации",
    main_concept: "Основная часть. Понятие и сущность", main_analysis: "Основная часть. Анализ и примеры",
    references: "Список литературы", acknowledgements: "Благодарности", funding: "Финансирование", udc: "УДК",
    table: "Таблица", figure: "Рисунок", language: "Russian", abstractLabel: "Аннотация:", keywordsLabel: "Ключевые слова:",
  },
  en: {
    abstract: "Abstract", keywords: "Keywords", introduction: "Introduction", literature: "Literature Review",
    methods: "Materials and Methods", results: "Results", discussion: "Discussion", conclusion: "Conclusion",
    review_1: "State of Research", review_2: "Main Approaches", review_3: "Open Questions and Directions",
    background: "Case Background and Context", case: "Case Analysis", lessons: "Discussion and Lessons",
    theory: "Theoretical Background", framework: "Proposed Framework", arguments: "Justification and Arguments",
    implications: "Theoretical and Practical Implications", discussion_conclusion: "Discussion and Conclusion",
    plan: "Outline", contents: "Contents",
    ch1_theory: "Chapter I. Theoretical Foundations", ch1_review: "1.2. State of Research", ch2_analysis: "Chapter II. Analysis",
    ch2_problems: "2.2. Problems and Their Causes", ch3_practice: "Chapter III. Practical Aspects", ch3_advice: "Chapter III. Recommendations",
    main_concept: "Main Part. Concept and Essence", main_analysis: "Main Part. Analysis and Examples",
    references: "References", acknowledgements: "Acknowledgements", funding: "Funding", udc: "UDC",
    table: "Table", figure: "Figure", language: "English", abstractLabel: "Abstract:", keywordsLabel: "Keywords:",
  },
  tr: {
    abstract: "Öz", keywords: "Anahtar kelimeler", introduction: "Giriş", literature: "Literatür Taraması",
    methods: "Materyal ve Yöntem", results: "Bulgular", discussion: "Tartışma", conclusion: "Sonuç",
    review_1: "Konunun Araştırılma Düzeyi", review_2: "Temel Yaklaşımlar", review_3: "Açık Sorular ve Yönelimler",
    background: "Durum Tanımı ve Bağlam", case: "Vaka Analizi", lessons: "Tartışma ve Çıkarımlar",
    theory: "Kuramsal Çerçeve", framework: "Önerilen Kavramsal Model", arguments: "Gerekçe ve Argümanlar",
    implications: "Kuramsal ve Uygulamaya Yönelik Önemi", discussion_conclusion: "Tartışma ve Sonuç",
    plan: "Plan", contents: "İçindekiler",
    ch1_theory: "I. Bölüm. Kuramsal Temeller", ch1_review: "1.2. Konunun Araştırılma Düzeyi", ch2_analysis: "II. Bölüm. Analiz",
    ch2_problems: "2.2. Sorunlar ve Nedenleri", ch3_practice: "III. Bölüm. Uygulamaya Yönelik Boyutlar", ch3_advice: "III. Bölüm. Öneriler",
    main_concept: "Ana Bölüm. Kavram ve Özü", main_analysis: "Ana Bölüm. Analiz ve Örnekler",
    references: "Kaynakça", acknowledgements: "Teşekkür", funding: "Finansman", udc: "UDK",
    table: "Tablo", figure: "Şekil", language: "Turkish", abstractLabel: "Öz:", keywordsLabel: "Anahtar kelimeler:",
  },
};

export const word = (language: DocLanguage, key: string): string => WORDS[language][key] ?? WORDS.en[key] ?? key;

/**
 * The abstract's languages: the paper's own first, then the other two of
 * Uzbek, Russian and English, because those are the three a journal here has
 * boxes for. A Turkish paper carries all three after its own.
 */
export function abstractLanguages(language: DocLanguage): DocLanguage[] {
  return [language, ...(["uz", "ru", "en"] as DocLanguage[]).filter((other) => other !== language)];
}

/* ------------------------------------------------------------- skeletons */

type Bone = { key: string; h: string; brief: string };
const bone = (key: string, brief: string, h = key): Bone => ({ key, h, brief });

const FRONT: Bone[] = [
  bone("abstract", "The abstract: aim, approach, main points and conclusion, 150–250 words in each language"),
  bone("keywords", "5–8 key terms in each language"),
];

/** The six structures an article may take; the first two keys and the last are shared. */
const ARTICLE: Record<Structure, Bone[]> = {
  imrad: [
    ...FRONT,
    bone("introduction", "The problem, why it matters now, what is known and the gap, the aim of the paper"),
    bone("methods", "The materials, data and methods — only those the sources describe or the person stated"),
    bone("results", "The results — only findings reported in the sources, attributed to them"),
    bone("discussion", "What the results mean, compared with other work; limitations"),
    bone("conclusion", "The main conclusions and where the work should go next"),
  ],
  ilmrad: [
    ...FRONT,
    bone("introduction", "The problem, its relevance and the aim of the paper"),
    bone("literature", "A critical review of the literature, organised by theme, ending in the gap this paper addresses"),
    bone("methods", "The approach and methods — only those the sources describe or the person stated"),
    bone("results", "The results — only findings reported in the sources, attributed to them"),
    bone("discussion", "Interpretation against the reviewed literature; limitations"),
    bone("conclusion", "The main conclusions"),
  ],
  review: [
    ...FRONT,
    bone("introduction", "The field, why a review is needed now, the scope and how the literature was chosen"),
    bone("review_1", "First theme of the review: what the studies show, compared"),
    bone("review_2", "Second theme: the main approaches and how they differ"),
    bone("review_3", "Third theme: open questions, contradictions and gaps"),
    bone("discussion", "A synthesis across the themes"),
    bone("conclusion", "What the field knows, what it does not, and what should be studied next"),
  ],
  case_study: [
    ...FRONT,
    bone("introduction", "The case, why it is worth studying, the questions the paper asks"),
    bone("background", "The setting: the organisation, place or situation and its history, from the sources"),
    bone("case", "An in-depth analysis of the case, organised by the questions asked"),
    bone("lessons", "What the case shows, compared with other cases and theory; limits of generalising"),
    bone("conclusion", "The conclusions and lessons for practice"),
  ],
  short: [
    bone("abstract", "A short abstract, 80–120 words in each language"),
    bone("keywords", "4–6 key terms in each language"),
    bone("introduction", "The problem and the aim, briefly"),
    bone("methods", "The approach, briefly — only what the sources describe or the person stated"),
    bone("results", "The preliminary results — only those reported in the sources, attributed to them"),
    bone("discussion_conclusion", "What the results suggest and what comes next"),
  ],
  theoretical: [
    ...FRONT,
    bone("introduction", "The problem, the theoretical gap, the aim and the argument of the paper in brief"),
    bone("theory", "The theoretical background the argument builds on"),
    bone("framework", "The proposed concept or model, defined precisely"),
    bone("arguments", "The arguments for it, and the strongest objections answered"),
    bone("implications", "What the concept changes in theory and in practice"),
    bone("conclusion", "The conclusions and how the concept could be tested"),
  ],
};

const OTHER: Record<Exclude<WorkKind, "article">, Bone[]> = {
  independent: [
    bone("plan", "The outline: the list of headings", "plan"),
    bone("introduction", "Topic, relevance, aim and tasks"),
    bone("chapter_1", "Concepts, definitions, history", "ch1_theory"),
    bone("chapter_2", "The current state of the subject, from the sources", "ch2_analysis"),
    bone("chapter_3", "Applications, examples, recommendations", "ch3_practice"),
    bone("conclusion", "Conclusions answering the tasks"),
  ],
  referat: [
    bone("plan", "The outline", "plan"),
    bone("introduction", "The topic and why it matters"),
    bone("chapter_1", "Definitions and the main concepts", "main_concept"),
    bone("chapter_2", "Concrete examples, from the sources", "main_analysis"),
    bone("conclusion", "Short, clear conclusions"),
  ],
  coursework: [
    bone("plan", "The table of contents", "contents"),
    bone("introduction", "Relevance, aim, tasks, object and subject"),
    bone("chapter_1", "Concepts, history, approaches", "ch1_theory"),
    bone("chapter_1_2", "A review of existing research", "ch1_review"),
    bone("chapter_2", "The current state, from the sources", "ch2_analysis"),
    bone("chapter_2_2", "The problems found and their causes", "ch2_problems"),
    bone("chapter_3", "Practical proposals, each justified", "ch3_advice"),
    bone("conclusion", "Conclusions answering the tasks"),
  ],
};

/** What an older article without a chosen structure was: IMRAD when it was empirical, a review when not. */
export function structureOf(kind: WorkKind, structure: string | null | undefined, empirical: boolean): Structure | null {
  if (kind !== "article") return null;
  if (structure && (STRUCTURES as string[]).includes(structure)) return structure as Structure;
  return empirical ? "imrad" : "review";
}

/** The skeleton a work starts from, in its language, before the planner adapts the headings. */
export function skeletonFor(kind: WorkKind, structure: Structure | null, language: DocLanguage = "uz"): PlannedSection[] {
  const bones = kind === "article" ? ARTICLE[structure ?? "review"] : OTHER[kind];
  return bones.map((entry) => ({ key: entry.key, heading: word(language, entry.h), brief: entry.brief }));
}

/** Sections that are lists or labelled blocks rather than prose. */
export const SHORT_KEYS: ReadonlySet<string> = new Set(["keywords", "plan"]);
/** Sections whose lines carry their own labels, one per language. */
export const LABELLED: ReadonlySet<string> = new Set(["abstract", "keywords"]);

/** The sections a structure reports results in — the ones that must not invent any. */
const FINDINGS: ReadonlySet<string> = new Set(["results", "case", "background"]);

/** Words per prose section, by kind; a short communication is short. */
export function sectionWords(kind: WorkKind, structure: Structure | null, key: string, languages: number): number {
  if (key === "keywords" || key === "plan") return 160;
  if (key === "abstract") return (structure === "short" ? 120 : 200) * languages;
  if (structure === "short") return 450;
  return { article: 840, independent: 1240, referat: 1040, coursework: 1500 }[kind];
}

/* ---------------------------------------------------------------- the plan */

export const PLAN_SCHEMA_NAME = "academic_plan";

export function planSchema(): Record<string, unknown> {
  const text = { type: "string" };
  return {
    type: "object",
    properties: {
      empirical: { type: "boolean" },
      udc: text,
      sections: {
        type: "array",
        items: { type: "object", properties: { key: text, heading: text, brief: text }, required: ["key", "heading", "brief"] },
      },
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["article", "book", "chapter", "web", "report", "thesis"] },
            authors: { type: "array", items: { type: "object", properties: { family: text, given: text }, required: ["family", "given"] } },
            title: text, container: text, publisher: text, place: text, year: text,
            volume: text, issue: text, pages: text, doi: text, url: text,
          },
          required: ["type", "authors", "title", "container", "publisher", "place", "year", "volume", "issue", "pages", "doi", "url"],
        },
      },
    },
    required: ["empirical", "udc", "sections", "sources"],
  };
}

export const PLAN_SYSTEM =
  "You are an academic supervisor planning a written work and finding the sources it will be built on. "
  + "Every source must be one you can actually name — a real journal article, book, university or government publication — with its real authors and year. "
  + "Never invent a source, an author, a year, a volume, an issue, a DOI or a page number. If you are not certain of a field, leave it empty. "
  + "Return only the required schema.";

const KIND_NAMES: Record<WorkKind, string> = {
  article: "a journal article", independent: "an independent work (mustaqil ish)", referat: "a referat", coursework: "a course paper",
};
const STRUCTURE_NAMES: Record<Structure, string> = {
  imrad: "IMRAD (Introduction, Methods, Results, Discussion)",
  ilmrad: "ILMRAD (IMRAD with a Literature Review)",
  review: "a review article organised by theme",
  case_study: "a case study",
  short: "a short communication (a shortened IMRAD)",
  theoretical: "a theoretical article proposing a concept or model",
};

export function planPrompt(input: {
  kind: WorkKind;
  structure: Structure | null;
  language: DocLanguage;
  topic: string;
  field: string;
  requirements: string;
  skeleton: readonly PlannedSection[];
}): string {
  return [
    `Work: ${KIND_NAMES[input.kind]}${input.structure ? `, structured as ${STRUCTURE_NAMES[input.structure]}` : ""}.`,
    `Topic: ${input.topic}`,
    input.field ? `Field: ${input.field}` : null,
    input.requirements ? `The author's requirements: ${input.requirements}` : null,
    `Language of the work: ${word(input.language, "language")}.`,
    "",
    "Task: plan the sections and find the sources.",
    "",
    "RULES:",
    `1. Headings and briefs in ${word(input.language, "language")}.`,
    "2. \"empirical\": true only if real experiments, surveys or measurements on exactly this topic exist in the sources. Otherwise false.",
    "3. Sources must be REAL: a real journal, book, university or government publication, with the real authors and year.",
    "4. AT LEAST 9, ideally up to 12 sources. But never invent one to reach the number — a made-up source ruins the list.",
    "5. For each source give its type, each author as family and given name (or initials), the title, the container (the journal for an article, the book for a chapter, the site for a web page), publisher, place, year, volume, issue, pages, DOI and URL. Leave any field you are not certain of EMPTY — especially pages, volume, issue and DOI.",
    "6. Prefer recent sources on fast-moving topics (technology, economics, law); classics are fine on stable or historical ones. Sources in Uzbek, Russian and English are all welcome.",
    "7. \"udc\": the Universal Decimal Classification code that fits the topic (for example 070.1 or 37.015.3). Only the code.",
    "8. The sections must follow this structure; adapt the headings to the topic but keep their order:",
    JSON.stringify(input.skeleton.map((section) => ({ key: section.key, heading: section.heading }))),
    "9. Do not change the \"key\" values — they hold the work together.",
    "10. \"brief\": one or two sentences on what that section must say.",
  ].filter((line) => line !== null).join("\n");
}

const clip = (value: unknown, max: number): string => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The plan, made to fit the skeleton it was asked for. Headings may be
 * renamed to suit the topic; the keys are the work's spine and come from the
 * skeleton regardless. The labelled sections keep their own headings — the
 * renderer prints their labels, not a heading.
 */
export function readPlan(answer: unknown, skeleton: readonly PlannedSection[]): Plan {
  const raw = (answer ?? {}) as Record<string, unknown>;
  const given = new Map<string, PlannedSection>();
  for (const section of Array.isArray(raw.sections) ? raw.sections : []) {
    const key = clip((section as PlannedSection)?.key, 40);
    if (key) given.set(key, section as PlannedSection);
  }
  const sources: Source[] = [];
  for (const entry of Array.isArray(raw.sources) ? raw.sources : []) {
    const source = readSource(entry);
    if (source) sources.push(source);
    if (sources.length >= 20) break;
  }
  return {
    empirical: Boolean(raw.empirical),
    udc: clip(raw.udc, 60).replace(/^(UDK|UDC|УДК)\s*/i, ""),
    sections: skeleton.map((section) => {
      const planned = given.get(section.key);
      return {
        key: section.key,
        heading: LABELLED.has(section.key) ? section.heading : clip(planned?.heading, 200) || section.heading,
        brief: clip(planned?.brief, 400) || section.brief,
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
    properties: { body: { type: "string" }, citations: { type: "array", items: { type: "integer" } } },
    required: ["body", "citations"],
  };
}

export const SECTION_SYSTEM =
  "You are writing one section of an academic work. "
  + "Write original prose that synthesises the supplied sources — never copy them, never pad, never repeat an idea in other words. "
  + "Never invent a statistic, a date, a study, a finding or a source. Everything factual must trace to a source you were given. "
  + "Return only the required schema.";

const cliches: Record<DocLanguage, string> = {
  uz: "\"Bugungi kunda\", \"Ma’lumki\", \"Muhim ahamiyatga ega\"",
  ru: "\"В настоящее время\", \"Как известно\", \"Имеет большое значение\"",
  en: "\"In today's world\", \"It is well known that\", \"plays an important role\"",
  tr: "\"Günümüzde\", \"Bilindiği gibi\", \"Büyük önem taşımaktadır\"",
};

/** A source as the writer sees it: numbered, short. */
export function sourceLine(source: Source, index: number): string {
  const who = source.authors.map((person) => person.family).slice(0, 3).join(", ") + (source.authors.length > 3 ? " et al." : "");
  return `[${index + 1}] ${who ? `${who}. ` : ""}${source.title}. ${source.container || source.publisher}${source.year ? `, ${source.year}` : ""}.`;
}

export function sectionPrompt(input: {
  kind: WorkKind;
  structure: Structure | null;
  language: DocLanguage;
  empirical: boolean;
  topic: string;
  field: string;
  key: string;
  heading: string;
  brief: string;
  earlier: { heading: string; summary: string }[];
  next: string | null;
  sources: readonly Source[];
  words: number;
}): string {
  const language = word(input.language, "language");
  const prose = !LABELLED.has(input.key) && !SHORT_KEYS.has(input.key);
  const lines: (string | null)[] = [
    `Topic: ${input.topic}`,
    input.field ? `Field: ${input.field}` : null,
    `Section to write: ${input.heading}`,
    `What it must say: ${input.brief}`,
    input.next ? `Next section: ${input.next}` : "This is the last section of the text.",
    "",
    input.earlier.length > 0
      ? `EARLIER SECTIONS (do not repeat them; continue from them):\n${input.earlier.map((entry) => `— ${entry.heading}: ${entry.summary}`).join("\n")}`
      : "This is the first section of the text.",
    "",
    `SOURCES (cite them by number):\n${input.sources.map(sourceLine).join("\n")}`,
    "",
    "RULES:",
    `1. About ${input.words} words.`,
    `2. Only ${language}, in a flawless academic register.`,
    "3. When you rely on a source, cite it in the text as [1] or [2, 5] and list those numbers in \"citations\".",
    "4. NEVER invent a number, a date, a percentage or a research finding. If the sources do not give it, write in general terms.",
    `5. No empty phrases such as ${cliches[input.language]}.`,
    "6. Separate paragraphs with a blank line. Each paragraph carries one idea through to its end.",
    "7. Do not repeat the heading — only the section's text.",
  ];
  if (FINDINGS.has(input.key) && !input.empirical) {
    lines.push("8. This work ran no study of its own. Report only results the sources published, and say whose they are (\"[3] found …\").");
  }
  if (prose && input.key !== "conclusion") {
    lines.push(
      "9. A TABLE only if a comparison or the sources' data is genuinely clearer as one — at most one per section. "
      + "Write it as a line \"[T1] Caption\" followed by a Markdown table (a header row, a separator row, then the rows). "
      + "Refer to it in the text as [T1]. Never put a figure in a table that is not in the sources.",
    );
  }
  if (input.key === "abstract") {
    const labels = abstractLanguages(input.language).map((each) => `"${word(each, "abstractLabel")}"`);
    lines.push(`8. Write EXACTLY ${labels.length} paragraphs, each opening with its label, in this order: ${labels.join(", ")}. Each says the same thing in its own language.`);
  }
  if (input.key === "keywords") {
    const labels = abstractLanguages(input.language).map((each) => `"${word(each, "keywordsLabel")}"`);
    lines.push(`8. Write EXACTLY ${labels.length} lines, each opening with its label, in this order: ${labels.join(", ")}. Each line holds the same terms in its own language, separated by commas.`);
  }
  return lines.filter((line) => line !== null).join("\n");
}

export type WrittenSection = { body: string; citations: number[] };

export function readSection(answer: unknown, sourceCount: number): WrittenSection {
  const raw = (answer ?? {}) as { body?: unknown; citations?: unknown };
  const body = String(raw.body ?? "").replace(/\r/g, "").trim().slice(0, 24_000);
  const citations = (Array.isArray(raw.citations) ? raw.citations : [])
    .map((entry) => Number(entry))
    // A citation pointing past the list is a citation to nothing, which is the shape a fabricated one arrives in.
    .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= sourceCount);
  return { body, citations: [...new Set(citations)].sort((a, b) => a - b) };
}

export const wordCount = (body: string): number => (body.trim() ? body.trim().split(/\s+/).length : 0);

/* ------------------------------------------------------- the updated alphabet */

/**
 * Uzbek in the updated alphabet (O‘ → Ö, G‘ → Ğ, Sh → Ş, Ch → Ç), line by line.
 * Russian passes through untouched; English would not — "each", "research"
 * and "change" all hold a "ch" — so a line that opens with its English label,
 * or reads as English, keeps its own spelling.
 */
const ENGLISH_LABEL = /^\W*(abstract|keywords?|key words)\b/i;
const ENGLISH_WORDS = /\b(the|and|of|is|are|was|were|this|that|these|with|for|from|by|which|their|has|have)\b/gi;

export function looksEnglish(line: string): boolean {
  return ENGLISH_LABEL.test(line) || (line.match(ENGLISH_WORDS)?.length ?? 0) >= 3;
}

export function spellUzbek(text: string): string {
  return text.split("\n").map((line) => (looksEnglish(line) ? line : toNewAlphabet(line))).join("\n");
}

/* --------------------------------------------------------------- layout */

export type Layout = {
  preset: "uz" | "journal" | "apa";
  fontSize: number;
  lineSpacing: number;
  /** Centimetres. */
  margins: { top: number; right: number; bottom: number; left: number };
  /** First-line indent, centimetres. */
  indent: number;
  pageNumbers: boolean;
};

/**
 * Three ways a paper is required to look. The Uzbek standard — Times New
 * Roman 14, one and a half, 3 cm on the left for binding — is what a thesis
 * and most journals here ask for; many international journals want 12 point
 * and single spacing with even margins; APA wants double spacing and an inch
 * all round.
 */
export const LAYOUT_PRESETS: Record<Layout["preset"], Layout> = {
  uz: { preset: "uz", fontSize: 14, lineSpacing: 1.5, margins: { top: 2, right: 1.5, bottom: 2, left: 3 }, indent: 1.25, pageNumbers: true },
  journal: { preset: "journal", fontSize: 12, lineSpacing: 1.15, margins: { top: 2, right: 2, bottom: 2, left: 2 }, indent: 1, pageNumbers: true },
  apa: { preset: "apa", fontSize: 12, lineSpacing: 2, margins: { top: 2.54, right: 2.54, bottom: 2.54, left: 2.54 }, indent: 1.27, pageNumbers: true },
};

const within = (value: unknown, low: number, high: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= low && number <= high ? number : fallback;
};

export function readLayout(raw: unknown): Layout {
  const value = (raw ?? {}) as Record<string, unknown>;
  const preset = LAYOUT_PRESETS[(value.preset as Layout["preset"]) in LAYOUT_PRESETS ? value.preset as Layout["preset"] : "uz"];
  const margins = (value.margins ?? {}) as Record<string, unknown>;
  return {
    preset: preset.preset,
    fontSize: within(value.fontSize, 10, 16, preset.fontSize),
    lineSpacing: within(value.lineSpacing, 1, 2.5, preset.lineSpacing),
    margins: {
      top: within(margins.top, 1, 5, preset.margins.top),
      right: within(margins.right, 1, 5, preset.margins.right),
      bottom: within(margins.bottom, 1, 5, preset.margins.bottom),
      left: within(margins.left, 1, 5, preset.margins.left),
    },
    indent: within(value.indent, 0, 3, preset.indent),
    pageNumbers: value.pageNumbers === undefined ? preset.pageNumbers : Boolean(value.pageNumbers),
  };
}

export const pageOf = (layout: Layout) => ({ widthCm: 21, heightCm: 29.7, marginCm: layout.margins });

/* ----------------------------------------------------------- the document */

export type FigureInput = { index: number; caption: string; widthCm: number; heightCm: number };

export type DocumentInput = {
  kind: WorkKind;
  structure: Structure | null;
  language: DocLanguage;
  title: string;
  field: string;
  authors: readonly Author[];
  udc: string;
  acknowledgements: string;
  funding: string;
  sections: readonly { key: string; heading: string; body: string; figures?: readonly FigureInput[] }[];
  sources: readonly Source[];
  style: CitationStyle;
  layout: Layout;
};

const TABLE_REF = /\[([TF])(\d{1,2})\]/g;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** "1-jadval" in Uzbek, "Таблица 1" in Russian, "Table 1" in English, "Tablo 1" in Turkish. */
export function numbered(language: DocLanguage, what: "table" | "figure", number: number): string {
  return language === "uz" ? `${number}-${word("uz", what)}` : `${word(language, what)} ${number}`;
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

/**
 * A section's body as pieces: paragraphs, and tables with their section-local
 * label ("T1") and caption. A table without a caption line is still a table.
 */
export function bodyPieces(body: string): ({ kind: "text"; text: string } | { kind: "table"; label: string | null; caption: string; rows: string[][] })[] {
  const out: ({ kind: "text"; text: string } | { kind: "table"; label: string | null; caption: string; rows: string[][] })[] = [];
  for (const chunk of body.split(/\n{2,}/)) {
    const lines = chunk.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim());
    if (lines.length === 0) continue;
    const at = lines.findIndex((line) => TABLE_ROW.test(line));
    if (at < 0) { out.push({ kind: "text", text: lines.join("\n").trim() }); continue; }
    // Text before the table: a caption line ("[T1] …") and anything else, kept as prose.
    const before = lines.slice(0, at);
    let label: string | null = null;
    let caption = "";
    const last = before[before.length - 1];
    const captionMatch = last?.match(/^\s*\[(T\d{1,2})\]\s*[.:—-]?\s*(.*)$/);
    if (captionMatch) { label = captionMatch[1]!; caption = captionMatch[2]!.trim(); before.pop(); }
    // A caption alone in the chunk before this one.
    const previous = out[out.length - 1];
    if (!label && previous?.kind === "text") {
      const alone = previous.text.match(/^\s*\[(T\d{1,2})\]\s*[.:—-]?\s*(.*)$/);
      if (alone && !previous.text.includes("\n")) { label = alone[1]!; caption = alone[2]!.trim(); out.pop(); }
    }
    if (before.length > 0) out.push({ kind: "text", text: before.join("\n") });
    const rows = lines.slice(at).filter((line) => TABLE_ROW.test(line) && !SEPARATOR.test(line)).map(cells);
    const width = Math.max(...rows.map((row) => row.length));
    out.push({ kind: "table", label, caption, rows: rows.map((row) => [...row, ...Array(width - row.length).fill("")]) });
  }
  return out;
}

/**
 * The finished work as blocks, in the language it was written in, set to the
 * journal's layout, with its bibliography in the chosen style and every
 * citation linked to its entry.
 */
export function documentBlocks(input: DocumentInput): Block[] {
  const { language, layout } = input;
  const spell = language === "uz" ? spellUzbek : (text: string) => text;
  const spellRuns = (runs: Run[]): Run[] => runs.map((run) => (run.link ? run : { ...run, text: spell(run.text) }));
  const BODY = { align: "both" as const, lineSpacing: layout.lineSpacing, indent: layout.indent, spaceAfter: 0 };
  const CENTRED = { align: "center" as const, lineSpacing: layout.lineSpacing, spaceAfter: 0 };
  const HEADING: Omit<Paragraph, "runs"> = { style: "Heading1", align: "center", lineSpacing: layout.lineSpacing, spaceAfter: 6, keepNext: true };
  const blocks: Block[] = [];
  const push = (runs: Run[], options: Omit<Paragraph, "runs">) => blocks.push(paragraph(spellRuns(runs), options));

  const sources = [...input.sources];
  const texts = input.sections.map((section) => section.body);
  const list = bibliography(sources, input.style, texts);
  const authors = input.authors.filter((author) => author.name.trim());

  /* ------------------------------------------------------- front matter */
  if (input.kind === "article") {
    if (input.udc.trim()) push([{ text: `${word(language, "udc")} ${input.udc.trim()}`, bold: true }], { align: "left", lineSpacing: layout.lineSpacing, spaceAfter: 6 });
    push([{ text: input.title.toLocaleUpperCase(language === "tr" ? "tr" : language), bold: true, size: layout.fontSize + 2 }], { ...CENTRED, spaceAfter: 6 });

    // Several organisations: each author carries the number of theirs, and the organisations are listed once.
    const places = [...new Set(authors.map((author) => author.affiliation.trim()).filter(Boolean))];
    const marked = places.length > 1;
    const names: Run[] = [];
    authors.forEach((author, at) => {
      if (at > 0) names.push({ text: ", ", bold: true });
      names.push({ text: author.name.trim(), bold: true });
      const place = places.indexOf(author.affiliation.trim());
      if (marked && place >= 0) names.push({ text: String(place + 1), bold: true, superscript: true });
    });
    if (names.length > 0) push(names, CENTRED);
    places.forEach((place, at) => {
      push([...(marked ? [{ text: String(at + 1), superscript: true }] : []), { text: place, italic: true }], CENTRED);
    });
    for (const author of authors) {
      const ids = [author.orcid.trim() ? `ORCID: ${author.orcid.trim()}` : "", author.email.trim()].filter(Boolean);
      if (ids.length === 0) continue;
      const prefix = authors.length > 1 ? `${author.name.trim()} — ` : "";
      blocks.push(paragraph([{ text: `${spell(prefix)}${ids.join(", ")}`, size: layout.fontSize - 2 }], CENTRED));
    }
    blocks.push(paragraph("", { spaceAfter: 6 }));
  } else {
    push([{ text: input.title.toLocaleUpperCase(language === "tr" ? "tr" : language), bold: true, size: layout.fontSize + 2 }], CENTRED);
    blocks.push(paragraph("", { spaceAfter: 6 }));
    const first = authors[0];
    for (const line of [first?.affiliation, input.field, ...authors.map((author) => author.name)]) {
      if (line?.trim()) push([{ text: line.trim(), bold: true }], CENTRED);
    }
    if (first?.email.trim()) blocks.push(paragraph(first.email.trim(), CENTRED));
    blocks.push(paragraph("", { spaceAfter: 6 }));
  }

  /* ------------------------------------------- abstract and keywords */
  // One language at a time: its abstract, then its keywords, as a journal page sets them.
  const abstractLines = (input.sections.find((section) => section.key === "abstract")?.body ?? "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const keywordLines = (input.sections.find((section) => section.key === "keywords")?.body ?? "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const labelled = (line: string): Run[] => {
    const at = line.indexOf(":");
    return at > 0 && at <= 24
      ? [{ text: `${line.slice(0, at + 1)} `, bold: true }, { text: line.slice(at + 1).trim() }]
      : [{ text: line }];
  };
  for (let at = 0; at < Math.max(abstractLines.length, keywordLines.length); at += 1) {
    const abstract = abstractLines[at];
    const keywords = keywordLines[at];
    // Spelled as whole lines, so an English line is recognised by all of its words, not just its label.
    if (abstract) blocks.push(paragraph(labelled(spell(abstract)), { align: "both", lineSpacing: layout.lineSpacing, spaceAfter: keywords ? 2 : 8 }));
    if (keywords) blocks.push(paragraph(labelled(spell(keywords)), { align: "both", lineSpacing: layout.lineSpacing, spaceAfter: 8 }));
  }

  /* -------------------------------------------------------- the text */
  const tables = { count: 0 };
  const figures = { count: 0 };
  const sectionNumbers = new Map<string, number>();
  for (const section of input.sections) {
    if (LABELLED.has(section.key)) continue;
    push([{ text: section.heading }], HEADING);

    // Section-local table and figure labels mapped to the document's numbers.
    const pieces = bodyPieces(section.body);
    for (const piece of pieces) {
      if (piece.kind === "table" && piece.label && !sectionNumbers.has(`${section.key}:${piece.label}`)) {
        tables.count += 1;
        sectionNumbers.set(`${section.key}:${piece.label}`, tables.count);
      }
    }
    const sectionFigures = (section.figures ?? []).map((figure, at) => {
      figures.count += 1;
      sectionNumbers.set(`${section.key}:F${at + 1}`, figures.count);
      return { ...figure, number: figures.count };
    });
    const referenced = (text: string) => text.replace(TABLE_REF, (whole, kind: string, n: string) => {
      const number = sectionNumbers.get(`${section.key}:${kind}${n}`);
      return number ? numbered(language, kind === "T" ? "table" : "figure", number) : "";
    }).replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ")
      // Uzbek joins a case ending to the number: "1-jadvalda", not "1-jadval da".
      .replace(/(\d+-(?:jadval|rasm))\s+(da|dagi|dan|ga|ni|ning|dek)\b/g, language === "uz" ? "$1$2" : "$1 $2");

    for (const piece of pieces) {
      if (piece.kind === "text") {
        for (const line of piece.text.split("\n")) {
          if (!line.trim()) continue;
          blocks.push(paragraph(spellRuns(citationRuns(referenced(line.trim()), sources, input.style, list, language)), BODY));
        }
        continue;
      }
      // A table: its number and caption above it, its header row bold and repeated across pages.
      const number = piece.label ? sectionNumbers.get(`${section.key}:${piece.label}`)! : ++tables.count;
      push([{ text: `${numbered(language, "table", number)}. `, bold: true }, { text: piece.caption }],
        { align: "left", lineSpacing: 1, spaceBefore: 6, spaceAfter: 4, keepNext: true });
      blocks.push(table({
        borders: true,
        rows: piece.rows.map((row, at) => ({
          header: at === 0,
          cells: row.map((cell) => ({ blocks: [paragraph(spellRuns(citationRuns(cell, sources, input.style, list, language)), { lineSpacing: 1, spaceAfter: 0, align: at === 0 ? "center" : "left" })] })),
        })),
      }));
      blocks.push(paragraph("", { spaceAfter: 6 }));
    }

    // The person's own figures, numbered across the document, captioned beneath.
    for (const figure of sectionFigures) {
      blocks.push({ kind: "image", index: figure.index, widthCm: figure.widthCm, heightCm: figure.heightCm, align: "center" });
      push([{ text: `${numbered(language, "figure", figure.number)}. `, bold: true }, { text: figure.caption }],
        { align: "center", lineSpacing: 1, spaceBefore: 4, spaceAfter: 8 });
    }
  }

  /* --------------------------------------- the person's own words */
  for (const [key, text] of [["acknowledgements", input.acknowledgements], ["funding", input.funding]] as const) {
    if (!text.trim()) continue;
    push([{ text: word(language, key) }], HEADING);
    for (const line of text.split(/\n+/)) if (line.trim()) push([{ text: line.trim() }], BODY);
  }

  /* --------------------------------------------------- the bibliography */
  if (sources.length > 0) {
    // An article's bibliography follows on; a bound work's starts a page.
    push([{ text: word(language, "references") }], { ...HEADING, pageBreakBefore: input.kind !== "article" });
    list.order.forEach((original, at) => {
      blocks.push(paragraph(formatReference(sources[original]!, input.style, at + 1, language), {
        align: "both",
        lineSpacing: layout.lineSpacing,
        spaceAfter: 0,
        bookmark: referenceAnchor(at + 1),
        ...(hangs(input.style) ? { hanging: 1.27 } : {}),
      }));
    });
  }

  return blocks;
}
