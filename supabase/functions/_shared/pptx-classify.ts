/**
 * What a template's page is for, and what subjects the family suits.
 *
 * A design family of twenty-five pages is not twenty-five interchangeable
 * slides. It is an opening, several ways of explaining a thing, a way of
 * comparing two things, a way of showing a number, a conclusion and a sign-off.
 * Taking the first ten pages of it produces a deck with five openings and no
 * ending, which is what selecting by position alone gets you. So each page is
 * asked what it is for, and the answer is stored beside it.
 *
 * Two rules run through this file.
 *
 * **The vocabulary is closed and closed here, not at the model.** Roles and
 * topics are database enums and foreign keys, so a value nobody recognised is
 * not a worse answer — it is a failed insert in the middle of an import. The
 * schema sent to Gemini therefore asks for a plain string, and the string is
 * checked against the list on the way back. A model that invents `intro_slide`
 * gets it dropped and replaced; it does not take the upload down with it, and
 * it never reaches a column that would refuse it.
 *
 * **Every answer has a deterministic fallback.** The layout already implies
 * most of the classification — a first page is an opening, a page of one huge
 * number is a statistic — and that guess is computed before the model is asked.
 * If the model is unavailable, disagrees with itself, or answers about a page
 * that does not exist, the import still finishes with a usable family. An admin
 * uploading a template at nine in the morning should not be blocked by somebody
 * else's outage.
 *
 * Free of Deno and of the network: this decides, `import-design-pptx` performs.
 */

import type { ArchetypePurpose } from "./jslayd/spec.ts";
import type { DesignPage } from "./pptx-design.ts";

/* ------------------------------------------------------------------- roles */

/**
 * Exactly the `slide_story_role` enum, in its order.
 *
 * The first eighteen say what a page contributes to an argument; the rest say
 * how a page is built. A page is often both — a `comparison` serving `types` —
 * which is what `alternativeRoles` is for.
 */
export const STORY_ROLES = [
  "welcome", "introduction", "overview", "key_concepts", "importance",
  "types", "structure", "process", "methods", "analysis", "challenges",
  "solutions", "applications", "examples", "results", "recommendations",
  "conclusion", "thanks",
  "agenda", "timeline", "comparison", "big_number", "quote",
  "case_study", "data", "chart", "table", "image_story", "references",
] as const;

export type StoryRole = (typeof STORY_ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set(STORY_ROLES);

/** Pages that only ever close a deck. Nothing may schedule one in the middle. */
const TERMINAL: ReadonlySet<StoryRole> = new Set(["thanks", "references"]);

export const SCALES = ["low", "medium", "high"] as const;
export type Scale = (typeof SCALES)[number];

export type SlideProfile = {
  archetypeId: string;
  sourceIndex: number;
  role: StoryRole;
  /** 1–18 by convention, 999 for a page that closes. A suggestion, never a rule. */
  recommendedStoryPosition: number;
  alternativeRoles: StoryRole[];
  density: Scale;
  textCapacity: Scale;
  visualWeight: Scale;
  layoutSignature: string;
  supportsImage: boolean;
  supportsChart: boolean;
  supportsTable: boolean;
  supportsQuote: boolean;
  supportsStats: boolean;
  isTerminal: boolean;
};

/**
 * What the layout already says, before anybody is asked.
 *
 * Deliberately conservative: it answers with the role a page's construction
 * makes obvious and leaves the finer distinctions — is this `challenges` or
 * `analysis`? — to the model, which can read the words.
 */
export function roleFromPurpose(
  purpose: ArchetypePurpose,
  position: number,
  total: number,
): StoryRole {
  switch (purpose) {
    case "cover": return "welcome";
    case "agenda": return "agenda";
    case "section": return "overview";
    case "quote": return "quote";
    case "statistics": return "big_number";
    case "chart": return "chart";
    case "table": return "table";
    case "timeline": return "timeline";
    case "comparison": return "comparison";
    case "process": return "process";
    case "full_image": return "image_story";
    case "references": return "references";
    case "thank_you": return "thanks";
    case "conclusion": return "conclusion";
    default: break;
  }
  // An unremarkable page early in a family opens; late in one, it concludes.
  if (position === 0) return "welcome";
  if (position >= total - 1) return "conclusion";
  return position <= 2 ? "introduction" : "key_concepts";
}

/** Where a role naturally sits, 1 first and 999 last. */
export function positionFor(role: StoryRole): number {
  const ORDER: Partial<Record<StoryRole, number>> = {
    welcome: 1, agenda: 2, introduction: 3, overview: 4, importance: 5,
    key_concepts: 6, types: 7, structure: 8, process: 9, methods: 10,
    timeline: 10, comparison: 11, analysis: 11, data: 12, chart: 12, table: 12,
    big_number: 12, challenges: 13, case_study: 13, examples: 14, quote: 14,
    image_story: 14, solutions: 15, applications: 16, results: 17,
    recommendations: 17, conclusion: 18, references: 999, thanks: 999,
  };
  return ORDER[role] ?? 50;
}

/* ------------------------------------------------------------------- facts */

/** What a page is, said in numbers, plus the little of it worth reading. */
export type PageFacts = {
  archetypeId: string;
  index: number;
  total: number;
  purpose: ArchetypePurpose;
  /** The page's own heading in the file. A classification signal, never stored. */
  heading: string;
  /** A short sample of the page's words, for the same reason and no other. */
  sample: string;
  textSlots: number;
  imageSlots: number;
  largestFontSize: number;
  smallestFontSize: number;
  shapes: number;
  layoutSignature: string;
};

/** Longer than this tells the classifier nothing it did not already know. */
const SAMPLE_LIMIT = 220;

/**
 * A name for how a page is built.
 *
 * Two pages sharing a signature are the same composition, which is what a
 * selector needs to know to avoid using both and producing a deck that looks
 * like it repeated itself.
 */
export function layoutSignatureOf(page: DesignPage): string {
  const parts: string[] = [page.purpose];
  const texts = page.archetype.elements.filter((element) => element.type === "text");
  const images = page.archetype.elements.filter((element) => element.type === "image");
  parts.push(`t${texts.length}`, `i${images.length}`);
  for (const image of images) {
    const centre = image.geometry.x + image.geometry.width / 2;
    parts.push(centre < 400 ? "img-left" : centre > 600 ? "img-right" : "img-centre");
  }
  return parts.join("-");
}

/**
 * A page reduced to what a classifier can act on.
 *
 * The words are taken from the slide as it arrived rather than from the
 * document, because the document deliberately has none: bindings are all that
 * survived the adapter. They are read here, used for one judgement, and never
 * stored — which is the only reason a template's copy is allowed this far in.
 */
export function factsFor(
  pages: readonly DesignPage[],
  slides: readonly { title: string | null; elements: readonly { type: string; content: Record<string, unknown>; typography?: { fontSize: number } }[] }[],
): PageFacts[] {
  return pages.map((page, index) => {
    const slide = slides[page.sourceIndexInFile ?? index];
    const texts = (slide?.elements ?? []).filter((element) => element.type === "text");
    const sizes = texts.map((element) => element.typography?.fontSize ?? 0).filter((size) => size > 0);
    const sample = texts
      .map((element) => (typeof element.content.text === "string" ? element.content.text : ""))
      .join(" · ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, SAMPLE_LIMIT);

    return {
      archetypeId: page.archetype.id,
      index,
      total: pages.length,
      purpose: page.purpose,
      heading: page.sourceTitle ?? "",
      sample,
      textSlots: page.textSlots,
      imageSlots: page.imageSlots,
      largestFontSize: sizes.length ? Math.max(...sizes) : 0,
      smallestFontSize: sizes.length ? Math.min(...sizes) : 0,
      shapes: page.archetype.elements.filter((element) => element.type === "decorative").length,
      layoutSignature: layoutSignatureOf(page),
    };
  });
}

/* ------------------------------------------------------------------ prompts */

export const SLIDE_CLASSIFIER_NAME = "JSLAYD_PPTX_SLIDE_CLASSIFIER_V1";

const SLIDE_SYSTEM = [
  "Sen taqdimot dizayni bo'yicha mutaxassissan.",
  "Senga bitta dizayn oilasining sahifalari beriladi. Har bir sahifa uchun uning",
  "hikoyadagi vazifasini aniqlaysan — bu sahifa taqdimotning qaysi qismiga mos keladi.",
  "Sahifadagi matn shablonning namunaviy matni; uni faqat vazifani aniqlash uchun o'qi.",
  "Javobda faqat berilgan ro'yxatdagi rollarni ishlat.",
].join(" ");

/**
 * The pages, described.
 *
 * Sent as one request for the whole family rather than one per page: a page's
 * role is partly relative — which page is the opening depends on the others —
 * and twenty-five separate calls would each be missing that.
 */
export function slideClassifierPrompt(facts: readonly PageFacts[]): string {
  const lines = facts.map((page) => [
    `#${page.index + 1}/${page.total}`,
    `tuzilma=${page.purpose}`,
    `matn_bloklari=${page.textSlots}`,
    `rasm_bloklari=${page.imageSlots}`,
    `eng_katta_shrift=${Math.round(page.largestFontSize)}`,
    `bezaklar=${page.shapes}`,
    page.heading ? `sarlavha="${page.heading.slice(0, 90)}"` : "sarlavha=yo'q",
    page.sample ? `namuna="${page.sample.slice(0, SAMPLE_LIMIT)}"` : "",
  ].filter(Boolean).join(" "));

  return [
    `Dizayn oilasida ${facts.length} ta sahifa bor. Har biri uchun rolini aniqla.`,
    "",
    `Mumkin bo'lgan rollar: ${STORY_ROLES.join(", ")}.`,
    "",
    "Qoidalar:",
    "- `role` — sahifaning asosiy vazifasi.",
    "- `alternativeRoles` — sahifa yana qaysi vazifalarni bajara oladi (0-3 ta).",
    "- `recommendedStoryPosition` — 1 dan 18 gacha, yopuvchi sahifa uchun 999.",
    "- `density`, `textCapacity`, `visualWeight` — low, medium yoki high.",
    "- Har bir sahifa uchun aynan bitta javob qaytar, tartibini o'zgartirma.",
    "",
    "Sahifalar:",
    ...lines,
  ].join("\n");
}

/**
 * The shape asked for.
 *
 * `role` is a string rather than an enum on purpose. The list has twenty-nine
 * members and the column is a Postgres enum, so the value has to be checked on
 * arrival whatever the schema said — and a schema that merely asks costs
 * nothing to send and cannot itself be the reason a request is refused.
 */
export const SLIDE_CLASSIFIER_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      description: "Har bir sahifa uchun bitta javob, kelgan tartibda.",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Sahifa raqami, 1 dan boshlanadi." },
          role: { type: "string", description: "Ro'yxatdagi rollardan biri." },
          alternativeRoles: { type: "array", items: { type: "string" }, maxItems: 3 },
          recommendedStoryPosition: { type: "integer" },
          density: { type: "string" },
          textCapacity: { type: "string" },
          visualWeight: { type: "string" },
        },
        required: ["index", "role", "recommendedStoryPosition", "density", "textCapacity", "visualWeight"],
      },
    },
  },
  required: ["pages"],
};

/* ------------------------------------------------------------------ reading */

function scaleOr(value: unknown, fallback: Scale): Scale {
  return (SCALES as readonly string[]).includes(String(value)) ? String(value) as Scale : fallback;
}

function roleOr(value: unknown, fallback: StoryRole): StoryRole {
  const name = String(value ?? "").trim().toLowerCase();
  return ROLE_SET.has(name) ? name as StoryRole : fallback;
}

/** What the page's own numbers say about how much it holds. */
function densityOf(page: DesignPage): { density: Scale; textCapacity: Scale; visualWeight: Scale } {
  const texts = page.archetype.elements.filter((element) => element.type === "text").length;
  const decoration = page.archetype.elements.length - texts - page.imageSlots;
  return {
    density: page.archetype.elements.length >= 8 ? "high" : page.archetype.elements.length >= 4 ? "medium" : "low",
    textCapacity: page.archetype.selection.maxText >= 700 ? "high" : page.archetype.selection.maxText >= 300 ? "medium" : "low",
    visualWeight: page.imageSlots > 0 || decoration >= 4 ? "high" : decoration >= 1 ? "medium" : "low",
  };
}

/**
 * The classifier's answer, made safe to insert.
 *
 * Every field is either a value from the closed list or the deterministic guess
 * this module computed before asking. There is no path from the model's output
 * to a column that could refuse it, which is why an import cannot fail halfway
 * through on somebody's twentieth page.
 */
export function readSlideProfiles(raw: unknown, pages: readonly DesignPage[]): SlideProfile[] {
  const answers = new Map<number, Record<string, unknown>>();
  const list = (raw as { pages?: unknown })?.pages;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const index = Number(row.index);
      // One-based in the prompt, so it reads the way an admin counts slides.
      if (Number.isInteger(index) && index >= 1 && index <= pages.length) answers.set(index - 1, row);
    }
  }

  return pages.map((page, index) => {
    const fallback = roleFromPurpose(page.purpose, index, pages.length);
    const answer = answers.get(index);
    const role = roleOr(answer?.role, fallback);
    const scales = densityOf(page);

    const alternatives: StoryRole[] = [];
    const offered = answer?.alternativeRoles;
    if (Array.isArray(offered)) {
      for (const candidate of offered.slice(0, 3)) {
        const name = String(candidate ?? "").trim().toLowerCase();
        if (ROLE_SET.has(name) && name !== role && !alternatives.includes(name as StoryRole)) {
          alternatives.push(name as StoryRole);
        }
      }
    }

    const offeredPosition = Number(answer?.recommendedStoryPosition);
    const terminal = TERMINAL.has(role);
    const position = terminal
      ? 999
      : Number.isInteger(offeredPosition) && offeredPosition >= 1 && offeredPosition <= 18
        ? offeredPosition
        : positionFor(role);

    return {
      archetypeId: page.archetype.id,
      sourceIndex: index,
      role,
      recommendedStoryPosition: position,
      alternativeRoles: alternatives,
      density: scaleOr(answer?.density, scales.density),
      textCapacity: scaleOr(answer?.textCapacity, scales.textCapacity),
      visualWeight: scaleOr(answer?.visualWeight, scales.visualWeight),
      layoutSignature: layoutSignatureOf(page),
      supportsImage: page.imageSlots > 0,
      supportsChart: page.archetype.selection.supportsChart,
      supportsTable: page.archetype.selection.supportsTable,
      supportsQuote: page.archetype.selection.supportsQuote,
      supportsStats: page.archetype.selection.supportsStats,
      isTerminal: terminal,
    };
  });
}

/* ---------------------------------------------------------------- keywords */

export const DESIGN_CLASSIFIER_NAME = "JSLAYD_PPTX_DESIGN_CLASSIFIER_V1";

export type DesignKeyword = { slug: string; score: number };

/** Ten is what the column's own constraint allows, and more than a selector uses. */
export const MAX_KEYWORDS = 10;

export const DESIGN_CLASSIFIER_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      description: "Eng mos mavzular, kuchlisidan boshlab.",
      items: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Ro'yxatdagi mavzu slug'i." },
          score: { type: "integer", description: "0 dan 100 gacha moslik." },
        },
        required: ["slug", "score"],
      },
      maxItems: MAX_KEYWORDS,
    },
    mood: { type: "string", description: "Dizaynning kayfiyati, bir-ikki so'z." },
  },
  required: ["topics"],
};

/**
 * The design, described by how it looks rather than by what it says.
 *
 * A template carries no subject of its own — its words are placeholders — so
 * the only honest signals are its palette, its typography and its composition.
 * A dark deck of large serif headings and full-bleed photography suits history
 * and architecture; a bright one of small type and many panels suits a
 * quarterly review. That is the judgement being asked for.
 */
export function designClassifierPrompt(input: {
  name: string;
  pages: readonly PageFacts[];
  palette: readonly string[];
  fonts: readonly string[];
  topics: readonly { slug: string; label: string }[];
}): string {
  return [
    `Dizayn oilasi nomi: "${input.name}".`,
    `Ranglar: ${input.palette.join(", ")}.`,
    `Shriftlar: ${input.fonts.join(", ") || "noma'lum"}.`,
    `Sahifalar soni: ${input.pages.length}.`,
    `Sahifa turlari: ${[...new Set(input.pages.map((page) => page.purpose))].join(", ")}.`,
    "",
    "Bu shablonning o'z matni yo'q — undagi so'zlar namuna. Shuning uchun mavzuni",
    "ranglar, shriftlar va kompozitsiyaga qarab bahola: bu dizayn qaysi mavzudagi",
    "taqdimotga yarashadi?",
    "",
    `Faqat quyidagi ro'yxatdan tanla (eng ko'pi ${MAX_KEYWORDS} ta):`,
    input.topics.map((topic) => `${topic.slug} — ${topic.label}`).join("\n"),
    "",
    "Har biriga 0-100 oralig'ida moslik bahosi qo'y. Ro'yxatda yo'q mavzuni yozma.",
  ].join("\n");
}

/**
 * The topics that survived being checked against the taxonomy.
 *
 * A slug nobody recognises is dropped rather than stored: the column is a list
 * a selector matches against, and one invented spelling in it is a design that
 * quietly never matches anything.
 */
export function readDesignKeywords(raw: unknown, allowed: ReadonlySet<string>): DesignKeyword[] {
  const list = (raw as { topics?: unknown })?.topics;
  if (!Array.isArray(list)) return [];

  const kept: DesignKeyword[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const slug = String(row.slug ?? "").trim().toLowerCase();
    if (!allowed.has(slug) || seen.has(slug)) continue;
    const score = Number(row.score);
    seen.add(slug);
    kept.push({ slug, score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 50 });
    if (kept.length >= MAX_KEYWORDS) break;
  }
  return kept.sort((first, second) => second.score - first.score);
}
