/**
 * The analysis somebody did somewhere else, brought back as a code.
 *
 * A template has to be described before it can be used: which subjects it
 * suits and how strongly, and what each of its pages is for. That judgement is
 * made by looking at the deck, and the person doing it does it wherever they
 * like — most usefully in a chat window with the file open beside the prompt.
 *
 * So this is a paste-in, not a call out. Two halves: the prompt they take away,
 * and the reader for what they bring back.
 *
 * The reader is deliberately forgiving about shape and unforgiving about
 * vocabulary. Chat windows wrap answers in fences, add a sentence of
 * introduction, use curly quotes and flatten indentation — none of which is the
 * analyst's mistake, so none of it is refused. What is refused is a subject or
 * a page role nobody recognises: those land in a Postgres enum and a foreign
 * key, and one invented spelling is a design that quietly never matches
 * anything.
 *
 * Nothing here talks to a model or a database. It takes text and a taxonomy and
 * returns what it understood, plus what it did not — because an analyst whose
 * two topics were dropped needs to be told, not left with a shorter list.
 */

/** Exactly the `slide_story_role` enum. A role outside it cannot be stored. */
export const STORY_ROLES = [
  "welcome", "introduction", "overview", "key_concepts", "importance",
  "types", "structure", "process", "methods", "analysis", "challenges",
  "solutions", "applications", "examples", "results", "recommendations",
  "conclusion", "thanks",
  "agenda", "timeline", "comparison", "big_number", "quote",
  "case_study", "data", "chart", "table", "image_story", "references",
] as const;

export type StoryRole = (typeof STORY_ROLES)[number];

export const MAX_KEYWORDS = 10;

export type Topic = { slug: string; label: string };

export type CodeKeyword = { keyword: string; score: number; label: string };
export type CodePage = { page: number; role: StoryRole; note: string };

export type CodeReading = {
  keywords: CodeKeyword[];
  pages: CodePage[];
  /** Named so the analyst can fix them, rather than silently losing them. */
  unknownTopics: string[];
  unknownRoles: string[];
  /** Why nothing was read at all, when nothing was. */
  problem: string | null;
};

/* ------------------------------------------------------------- the prompt */

/**
 * The prompt the analyst takes away.
 *
 * Written to be pasted into a chat with the `.pptx` attached, so it says what
 * the file is, what to look at and exactly what to return. The taxonomy is
 * spelled out in full rather than described, because a closed list that is only
 * described is an open list: the answer comes back as `Meditsina` where the
 * table says `tibbiyot`, and a selector comparing free text is comparing
 * spelling.
 *
 * The page count is included when it is known, because an analysis of eleven
 * pages for a family of nine is the mistake most worth preventing.
 */
export function buildPrompt(input: {
  designName: string;
  pageCount: number | null;
  topics: readonly Topic[];
}): string {
  const roles = STORY_ROLES.join(", ");
  const taxonomy = input.topics.map((topic) => `${topic.slug} — ${topic.label}`).join("\n");

  return [
    "Sen taqdimot dizayni bo'yicha tahlilchisan. Senga PowerPoint SHABLONI beriladi —",
    "undagi matnlar namuna, ular hech qayerda ishlatilmaydi. Sen faqat DIZAYNNI baholaysan:",
    "ranglar, shriftlar, kompozitsiya va har bir sahifaning tuzilishi.",
    "",
    `Dizayn nomi: ${input.designName || "(nomsiz)"}`,
    input.pageCount ? `Sahifalar soni: ${input.pageCount} ta. Aynan shuncha sahifa uchun javob qaytar.` : "",
    "",
    "1) MAVZULAR. Bu dizayn qaysi sohalardagi taqdimotlarga yarashadi?",
    `   Faqat quyidagi ro'yxatdan tanla, eng ko'pi ${MAX_KEYWORDS} ta.`,
    "   Har biriga 0-100 oralig'ida moslik foizi qo'y (100 = juda mos).",
    "",
    taxonomy,
    "",
    "2) SAHIFALAR. Har bir sahifa taqdimotning qaysi qismiga mo'ljallangan?",
    `   Faqat quyidagi rollardan birini tanla: ${roles}`,
    "",
    "JAVOBNI FAQAT QUYIDAGI JSON KO'RINISHIDA QAYTAR, boshqa hech nima yozma:",
    "",
    "{",
    '  "keywords": [',
    '    { "keyword": "jurnalistika", "score": 100 },',
    '    { "keyword": "marketing", "score": 60 }',
    "  ],",
    '  "pages": [',
    '    { "page": 1, "role": "welcome", "note": "muqova" },',
    '    { "page": 2, "role": "agenda", "note": "mundarija" }',
    "  ]",
    "}",
  ].filter((line) => line !== "").join("\n");
}

/* -------------------------------------------------------------- the reader */

/**
 * The JSON inside whatever the chat window put around it.
 *
 * A fenced block wins when there is one, because a model that explains itself
 * first and then answers puts braces in the explanation too. Otherwise the
 * outermost brace pair is taken.
 */
function extractJson(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

/** Curly quotes are what a chat window does to a code block it reformatted. */
function repair(json: string): string {
  return json
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    // A trailing comma is the single most common hand-edit breakage.
    .replace(/,\s*([}\]])/g, "$1");
}

/**
 * The two vocabularies spell themselves differently, so they normalise
 * differently.
 *
 * A topic slug is hyphenated (`ijtimoiy-fanlar`) and a story role is
 * underscored (`key_concepts`), which is not a style choice — it is what the
 * `design_topics` table and the `slide_story_role` enum actually contain.
 * Folding both onto one separator matched neither, and `key_concepts` came back
 * as an unrecognised role every time.
 */
function topicSlug(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function roleName(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * What the analyst brought back, checked against what can be stored.
 *
 * Unknown values are collected rather than dropped in silence: two topics
 * quietly removed leaves somebody looking at a list they did not write,
 * wondering whether the file or the reader was wrong.
 */
export function readDesignCode(
  text: string,
  context: { topics: readonly Topic[]; pageCount: number },
): CodeReading {
  const empty: CodeReading = { keywords: [], pages: [], unknownTopics: [], unknownRoles: [], problem: null };
  if (!text.trim()) return { ...empty, problem: "Kod kiritilmadi." };

  const json = extractJson(text);
  if (!json) return { ...empty, problem: "Kod ichidan JSON topilmadi. Butun javobni nusxalab qo'ying." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(repair(json));
  } catch {
    return { ...empty, problem: "JSON o'qilmadi — qavslar yoki vergullar buzilgan bo'lishi mumkin." };
  }

  const body = (parsed ?? {}) as Record<string, unknown>;
  const allowed = new Map(context.topics.map((topic) => [topic.slug, topic.label]));
  const roles = new Set<string>(STORY_ROLES);

  const keywords: CodeKeyword[] = [];
  const unknownTopics: string[] = [];
  const seenTopics = new Set<string>();

  for (const entry of Array.isArray(body.keywords) ? body.keywords : []) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    // `keyword`, `topic` and `slug` all name the same field in practice; which
    // one comes back depends on the day and the model.
    const slug = topicSlug(row.keyword ?? row.topic ?? row.slug);
    if (!slug || seenTopics.has(slug)) continue;
    seenTopics.add(slug);

    const label = allowed.get(slug);
    if (!label) { unknownTopics.push(slug); continue; }

    const raw = Number(row.score ?? row.percent ?? row.foiz);
    const score = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 50;
    if (keywords.length < MAX_KEYWORDS) keywords.push({ keyword: slug, score, label });
  }

  const pages: CodePage[] = [];
  const unknownRoles: string[] = [];
  const seenPages = new Set<number>();

  for (const entry of Array.isArray(body.pages) ? body.pages : []) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const page = Number(row.page ?? row.slide ?? row.index);
    // One-based, because that is how an analyst counts slides and how the file
    // presented them.
    if (!Number.isInteger(page) || page < 1 || page > context.pageCount) continue;
    if (seenPages.has(page)) continue;

    const role = roleName(row.role ?? row.type);
    if (!roles.has(role)) { unknownRoles.push(role || "(bo'sh)"); continue; }

    seenPages.add(page);
    pages.push({ page, role: role as StoryRole, note: String(row.note ?? row.izoh ?? "").slice(0, 80) });
  }

  keywords.sort((first, second) => second.score - first.score);
  pages.sort((first, second) => first.page - second.page);

  const problem = keywords.length === 0 && pages.length === 0
    ? "Kodda tanilgan mavzu ham, sahifa ham topilmadi."
    : null;

  return { keywords, pages, unknownTopics, unknownRoles, problem };
}
