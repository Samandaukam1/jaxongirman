/**
 * What a model is asked to write for a Liquid Glass deck, and how its answer
 * is read.
 *
 * Two calls for a whole deck: an outline that names every page and the kind of
 * page it is, then the copy for those pages in batches. The model never says
 * where anything goes or what colour it is — `compose.ts` decides that — so
 * nothing it writes can produce an overlap, an overflow or a page that has to
 * be rebuilt.
 *
 * The reader is the other half of that promise. Whatever comes back — a
 * missing field, a kind that was not on the list, a chart whose numbers do not
 * add up, four hundred words where forty were asked for — it returns a usable
 * slide. A deck is never failed over one bad answer; the page is written from
 * what the outline already knew instead.
 */

import { ANSWER_IN, type DeckLanguage } from "./language.ts";
import { artDirectionSchema } from "./dna.ts";
import { cleanLine, clip } from "./text.ts";
import { ICON_NAMES, isIcon } from "./icons.ts";

export const SLIDE_KINDS = [
  "cards", "bullets", "stats", "timeline", "process", "comparison", "quote", "chart", "statement", "photo",
] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];

/** `icon` names one from the icon set; absent when the writer named none it knows. */
export type Point = { title: string; text: string; icon?: string };
export type Stat = { value: string; label: string };
export type Side = { heading: string; points: string[] };

export type SlideContent = {
  kind: SlideKind;
  title: string;
  eyebrow: string;
  lead: string;
  points: Point[];
  stats: Stat[];
  quote: { text: string; author: string } | null;
  /** `labels` are short enough to sit under a bar; `names` say the same in full, for text beside it. */
  chart: { labels: string[]; names?: string[]; values: number[]; unit: string; insight: string } | null;
  left: Side | null;
  right: Side | null;
  /** English, for the photo search. Never shown. */
  imageQuery: string | null;
  /** The page's subject as an icon, for the large mark behind it. */
  icon?: string;
};

export type OutlineEntry = { title: string; kind: SlideKind; focus: string; imageQuery: string | null };

export type DeckOutline = {
  /** The model's art direction, read by `readArtDirection`. Never trusted as-is. */
  art: unknown;
  /** A short label for the deck, for footers: two or three words. */
  shortTitle: string;
  subtitle: string;
  /** English, for the cover photograph. */
  coverQuery: string;
  slides: OutlineEntry[];
};

/* ---------------------------------------------------------------- schemas */

const nullableString = { type: ["string", "null"] };

export function outlineSchema(count: number): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      art: { ...artDirectionSchema(), description: "Mavzuga mos vizual yo‘nalish — dizayn shundan noldan yaratiladi" },
      shortTitle: { type: "string", description: "Taqdimotning 2–4 so‘zli qisqa nomi" },
      subtitle: { type: "string", description: "Muqova uchun bitta jumlali izoh, 90 belgidan oshmasin" },
      coverQuery: { type: "string", description: "Muqova fotosurati uchun inglizcha 2–5 so‘zli qidiruv: mavzuning o‘zi tasvirlangan aniq predmet (masalan «solar panels field»)" },
      slides: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Aniq sarlavha, 60 belgigacha" },
            kind: { type: "string", enum: [...SLIDE_KINDS] },
            focus: { type: "string", description: "Bu slayd nimani isbotlaydi — bir jumla" },
            imageQuery: { ...nullableString, description: "Faqat kind=photo bo‘lsa: inglizcha 2–5 so‘zli rasm qidiruvi — slayd mavzusining asosiy predmeti" },
          },
          required: ["title", "kind", "focus", "imageQuery"],
        },
      },
    },
    required: ["art", "shortTitle", "subtitle", "coverQuery", "slides"],
  };
}

/**
 * The copy for a batch of pages.
 *
 * No count anywhere in it. Gemini refuses a schema that asks one request for
 * an exact number of composite items — `contentSchema(1)` passed and six were
 * refused with INVALID_ARGUMENT naming nothing (tests/gemini-schema.test.mjs
 * measured it for the old engine). With `minItems = maxItems = 6` back in this
 * schema, every full batch of six failed twice and its pages were rebuilt from
 * the outline as plain statements, which is why decks came out as text. How
 * many slides and how many points is said in the prompt and enforced by
 * `readSlide`, which clips every list to what its layout can hold.
 */
export function contentSchema(): Record<string, unknown> {
  // A plain string, not an enum: Gemini refuses a schema whose enum lists the
  // whole set ("INVALID_ARGUMENT"), which failed every batch. The list goes in
  // the description instead, and `isIcon` keeps whatever comes back honest.
  const icon = { type: "string", description: `Shu bandning ma’nosiga eng mos ikonka nomi, aynan shu ro‘yxatdan bittasi: ${ICON_NAMES.join(", ")}` };
  const point = {
    type: "object",
    properties: { title: { type: "string" }, text: { type: "string" }, icon },
    required: ["title", "text", "icon"],
  };
  const side = {
    type: ["object", "null"],
    properties: {
      heading: { type: "string" },
      points: { type: "array", items: { type: "string" } },
    },
    required: ["heading", "points"],
  };
  return {
    type: "object",
    properties: {
      slides: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            eyebrow: { type: "string", description: "1–3 so‘zli bo‘lim belgisi" },
            icon: { type: "string", description: "Slayd mavzusini bildiruvchi ikonka nomi, bandlardagi bilan bir xil ro‘yxatdan" },
            title: { type: "string" },
            lead: { type: "string", description: "1–2 jumla, 170 belgigacha" },
            points: { type: "array", items: point, description: "6 tadan oshmasin" },
            stats: {
              type: "array",
              description: "4 tadan oshmasin",
              items: {
                type: "object",
                properties: { value: { type: "string" }, label: { type: "string" } },
                required: ["value", "label"],
              },
            },
            quote: {
              type: ["object", "null"],
              properties: { text: { type: "string" }, author: { type: "string" } },
              required: ["text", "author"],
            },
            chart: {
              type: ["object", "null"],
              properties: {
                labels: { type: "array", items: { type: "string" }, description: "7 tadan oshmasin" },
                values: { type: "array", items: { type: "number" }, description: "labels bilan bir xil sonda" },
                unit: { type: "string" },
                insight: { type: "string" },
              },
              required: ["labels", "values", "unit", "insight"],
            },
            left: side,
            right: side,
          },
          required: ["index", "eyebrow", "icon", "title", "lead", "points", "stats", "quote", "chart", "left", "right"],
        },
      },
    },
    required: ["slides"],
  };
}

/* ---------------------------------------------------------------- prompts */

/** What each kind of page needs from the writer, said as an instruction. */
export const KIND_BRIEF: Record<SlideKind, string> = {
  cards: "points: aynan 3 yoki 4 ta; har birida title (2–4 so‘z) va text (1 jumla, 90 belgigacha).",
  bullets: "points: 4 yoki 5 ta; title — qisqa tezis (3–6 so‘z), text — izoh (1 jumla, 100 belgigacha).",
  stats: "stats: 3 ta aniq raqam (value: «78%», «2,4 mln», «1991»; label: nima ekanini 3–7 so‘zda). Raqamlar tadqiqotdan bo‘lsin, uydirmang. lead raqamlarni bog‘laydi.",
  timeline: "points: 4 yoki 5 ta xronologik bosqich; title — yil yoki davr (masalan «1441», «XV asr»), text — 1 jumla, 80 belgigacha.",
  process: "points: 3–5 ta ketma-ket qadam; title — fe’l bilan boshlanuvchi 2–4 so‘z, text — 1 jumla, 80 belgigacha.",
  comparison: "left va right: har biri heading (1–3 so‘z) va 3 ta qisqa punkt (60 belgigacha). lead — taqqoslash xulosasi.",
  quote: "quote: mavzuga oid haqiqiy, mashhur iqtibos va uning muallifi. Iqtibos 200 belgidan oshmasin. Ishonchingiz komil bo‘lmasa — mavzu haqidagi kuchli xulosa jumlasini yozing va author ga «Xulosa» deb yozing.",
  chart: "chart: 3–6 ta labels va shuncha values (faqat raqam), unit (masalan «%», «mln so‘m»), insight — diagrammadan chiqadigan 1 jumlali xulosa. Raqamlar tadqiqotdan bo‘lsin.",
  statement: "lead — slaydning asosiy fikri, kuchli 1–2 jumla (180 belgigacha). points: 2 ta qo‘llab-quvvatlovchi fakt.",
  photo: "points: 3 ta qisqa tezis (title 2–4 so‘z, text 1 jumla, 90 belgigacha). lead — 1 jumla.",
};

export function outlinePrompt(input: {
  language?: DeckLanguage;
  topic: string;
  count: number;
  research: string;
  requirements: string;
  attachments: boolean;
}): string {
  return [
    `Mavzu: ${input.topic}`,
    `Mazmun slaydlari soni: ${input.count} ta (muqova, reja, adabiyotlar va yakuniy slaydni server o‘zi qo‘shadi — ularni rejalashtirmang).`,
    input.requirements ? `Foydalanuvchi talablari (albatta bajaring):\n${input.requirements}` : "",
    "",
    "Har bir slayd uchun kind tanlang:",
    "cards — 3–4 ta tushuncha yonma-yon; bullets — 4–5 ta tezis; stats — 3 ta muhim raqam;",
    "timeline — xronologiya; process — bosqichlar; comparison — ikki tomonni taqqoslash;",
    "quote — iqtibos; chart — raqamli taqqoslash diagrammasi; statement — bitta kuchli fikr;",
    "photo — rasm bilan tushuntiriladigan mavzu.",
    "",
    "art: mavzu ruhiga mos vizual yo‘nalish bering — mode (dark/light), hue (asosiy rang, 0–360), mood, typography, energy.",
    "Masalan: kosmos → dark, 260, cosmic; tibbiyot → light, 170, fresh; tarix/adabiyot → light, 35, classic; IT → dark, 200, tech.",
    "",
    "Qoidalar:",
    "- Ketma-ket ikkita slayd bir xil kind bo‘lmasin; turli kindlardan foydalaning.",
    `- ${input.count >= 5 ? "Kamida bitta stats yoki chart, bitta photo va bitta cards bo‘lsin." : "Turli kindlar tanlang."}`,
    "- stats va chart faqat tadqiqotda haqiqiy raqamlar bo‘lsa. Raqam yo‘q bo‘lsa — boshqa kind.",
    "- Mantiqiy ketma-ketlik: tushuncha → tahlil → dalillar → amaliyot → xulosa.",
    "- Sarlavhalar aniq va mazmunli bo‘lsin («Kirish» emas, mavzu haqida nima aytilishini ayting).",
    "- coverQuery va imageQuery: suratga olsa bo‘ladigan aniq predmet, mavzuning asosiy otini albatta qo‘shing (masalan quyosh energetikasi → «solar panels field», «solar power plant workers»). Mavhum so‘zlar («potential», «landscape», «future», «concept») ishlatmang.",
    `- ${ANSWER_IN[input.language ?? "uz"]}`,
    input.attachments ? "- Biriktirilgan fayllar asosiy manba hisoblanadi." : "",
    input.research ? `\nTEKSHIRILGAN MA’LUMOTLAR:\n${input.research}` : "",
  ].filter((line) => line !== "").join("\n");
}

export function contentPrompt(input: {
  language?: DeckLanguage;
  topic: string;
  slides: { index: number; entry: OutlineEntry }[];
  research: string;
  requirements: string;
}): string {
  const pages = input.slides.map(({ index, entry }) =>
    `#${index} [${entry.kind}] ${entry.title}\n   Maqsad: ${entry.focus}\n   Talab: ${KIND_BRIEF[entry.kind]}`).join("\n");
  return [
    `Mavzu: ${input.topic}`,
    input.requirements ? `Foydalanuvchi talablari (albatta bajaring):\n${input.requirements}` : "",
    "",
    "Quyidagi slaydlarning matnini yozing. Har bir slayd uchun index ni aynan shunday qaytaring.",
    "Kerak bo‘lmagan maydonlar: points=[] , stats=[] , quote=null , chart=null , left=null , right=null.",
    "Matn qisqa, aniq va akademik bo‘lsin; har bir jumla fakt yoki fikr bersin. Markdown, yulduzcha, emoji ishlatmang.",
    ANSWER_IN[input.language ?? "uz"],
    "",
    pages,
    input.research ? `\nTEKSHIRILGAN MA’LUMOTLAR (faqat shulardan foydalaning):\n${input.research}` : "",
  ].filter((line) => line !== "").join("\n");
}

/* ---------------------------------------------------------------- readers */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const kindOf = (value: unknown, fallback: SlideKind): SlideKind =>
  typeof value === "string" && (SLIDE_KINDS as readonly string[]).includes(value) ? value as SlideKind : fallback;

const query = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  return text.length >= 3 ? text.slice(0, 80) : null;
};

/**
 * The outline, with every page given a kind and no two neighbours alike.
 *
 * The model is asked not to repeat a kind back to back; this makes sure it did
 * not, by swapping a repeat for the nearest kind the page could also be.
 */
export function readOutline(value: unknown, input: { topic: string; count: number }): DeckOutline {
  const raw = isRecord(value) ? value : {};
  const listed = Array.isArray(raw.slides) ? raw.slides : [];
  const slides: OutlineEntry[] = [];
  for (let index = 0; index < input.count; index += 1) {
    const entry = isRecord(listed[index]) ? listed[index] as Record<string, unknown> : {};
    const title = cleanLine(entry.title, 90) || `${input.topic} — ${index + 1}-qism`;
    slides.push({
      title,
      kind: kindOf(entry.kind, FALLBACK_ORDER[index % FALLBACK_ORDER.length]!),
      focus: cleanLine(entry.focus, 240) || title,
      imageQuery: query(entry.imageQuery),
    });
  }
  return {
    art: raw.art ?? null,
    shortTitle: clip(cleanLine(raw.shortTitle, 60) || input.topic, 40),
    subtitle: cleanLine(raw.subtitle, 140),
    coverQuery: query(raw.coverQuery) ?? input.topic.slice(0, 60),
    slides: varyKinds(slides),
  };
}

/** The order an outline falls back to when the model named nothing usable. */
export const FALLBACK_ORDER: readonly SlideKind[] = [
  "statement", "cards", "stats", "process", "photo", "comparison", "bullets", "timeline", "quote", "chart",
];

/** What a page of each kind could be instead, nearest first. */
const ALTERNATIVES: Record<SlideKind, SlideKind[]> = {
  cards: ["bullets", "process", "photo"],
  bullets: ["cards", "photo", "process"],
  stats: ["chart", "statement", "cards"],
  timeline: ["process", "bullets", "cards"],
  process: ["timeline", "cards", "bullets"],
  comparison: ["cards", "bullets", "statement"],
  quote: ["statement", "photo", "cards"],
  chart: ["stats", "cards", "statement"],
  statement: ["quote", "photo", "cards"],
  photo: ["bullets", "cards", "statement"],
};

/** At most this share of a deck may be one kind of page. */
const MAX_SHARE = 0.25;

/**
 * Kinds a page can be turned into without needing anything the model may not
 * have — no numbers, no quotation. A page swapped to one of these is always
 * fillable from what the writer knows.
 */
const SAFE: readonly SlideKind[] = ["statement", "cards", "process", "photo", "bullets", "comparison", "timeline"];

export function varyKinds(slides: OutlineEntry[]): OutlineEntry[] {
  const out = slides.map((slide) => ({ ...slide }));
  const cap = Math.max(1, Math.ceil(out.length * MAX_SHARE));
  const used = new Map<SlideKind, number>();
  out.forEach((slide, index) => {
    const previous = out[index - 1]?.kind;
    const crowded = (kind: SlideKind) => (used.get(kind) ?? 0) >= cap || kind === previous;
    if (crowded(slide.kind)) {
      // The least-used of the kinds this page could also be, nearest first.
      const options = [...ALTERNATIVES[slide.kind], ...SAFE].filter((kind, at, list) => list.indexOf(kind) === at && !crowded(kind));
      const least = Math.min(...options.map((kind) => used.get(kind) ?? 0));
      slide.kind = options.find((kind) => (used.get(kind) ?? 0) === least) ?? slide.kind;
    }
    used.set(slide.kind, (used.get(slide.kind) ?? 0) + 1);
  });
  return out;
}

function points(value: unknown, max: number): Point[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return { title: "", text: cleanLine(entry, 200) };
      if (!isRecord(entry)) return null;
      return { title: cleanLine(entry.title, 70), text: cleanLine(entry.text, 220), ...(isIcon(entry.icon) ? { icon: entry.icon } : {}) };
    })
    .filter((entry): entry is Point => Boolean(entry && (entry.title || entry.text)))
    .slice(0, max);
}

function side(value: unknown): Side | null {
  if (!isRecord(value)) return null;
  const heading = cleanLine(value.heading, 50);
  const list = Array.isArray(value.points) ? value.points.map((one) => cleanLine(one, 140)).filter(Boolean).slice(0, 4) : [];
  return heading || list.length ? { heading: heading || "—", points: list } : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/\s/g, "").replace(",", ".").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * One page's copy, made to satisfy its kind or demoted to a kind it does.
 *
 * A "stats" page with no numbers becomes a statement, a chart whose values do
 * not line up with its labels becomes cards, and so on. The page is always
 * drawn as what it actually has, never as an empty frame of what it was meant
 * to be.
 */
/**
 * A figure as a slide can carry it: "209,2 milliard so‘m" → "209,2 mlrd so‘m".
 *
 * The standard Uzbek abbreviations first, a decimal comma for a point, and
 * only then a cut — a number never loses its unit to a "…" when the unit
 * could have been shortened instead.
 */
export function compactValue(value: string, max = 16): string {
  const short = value
    .replace(/\btrillion\b/gi, "trln")
    .replace(/\bmilliard\b/gi, "mlrd")
    .replace(/\bmillion\b/gi, "mln")
    .replace(/\bmegavatt\b/gi, "MVt")
    .replace(/\bgigavatt\b/gi, "GVt")
    .replace(/\bkilovatt\b/gi, "kVt")
    .replace(/\bfoiz\b/gi, "%")
    .replace(/(\d)\.(\d)/g, "$1,$2")
    .replace(/\s+%/g, "%")
    .trim();
  return clip(short, max);
}

export function readSlide(value: unknown, outline: OutlineEntry): SlideContent {
  const raw = isRecord(value) ? value : {};
  const slide: SlideContent = {
    kind: outline.kind,
    title: cleanLine(raw.title, 90) || outline.title,
    eyebrow: clip(cleanLine(raw.eyebrow, 40), 28),
    lead: cleanLine(raw.lead, 260),
    points: points(raw.points, 6),
    stats: Array.isArray(raw.stats)
      ? raw.stats.filter(isRecord).map((stat) => ({
        // "2.55%" → "2,55%": Uzbek writes a decimal comma.
        value: compactValue(cleanLine(stat.value, 40)),
        label: cleanLine(stat.label, 90),
      })).filter((stat) => stat.value && /\d/.test(stat.value)).slice(0, 4)
      : [],
    quote: isRecord(raw.quote) && cleanLine(raw.quote.text, 280)
      ? { text: cleanLine(raw.quote.text, 280).replace(/^[«"“]+|[»"”]+$/g, ""), author: cleanLine(raw.quote.author, 60) }
      : null,
    chart: null,
    left: side(raw.left),
    right: side(raw.right),
    imageQuery: outline.imageQuery,
    ...(isIcon(raw.icon) ? { icon: raw.icon } : {}),
  };

  if (isRecord(raw.chart)) {
    const names = Array.isArray(raw.chart.labels) ? raw.chart.labels.map((one) => clip(cleanLine(one, 80), 60)) : [];
    const values = Array.isArray(raw.chart.values) ? raw.chart.values.map(numeric) : [];
    const pairs = names.map((name, index) => ({ name, value: values[index] })).filter((pair) =>
      pair.name && typeof pair.value === "number" && pair.value >= 0) as { name: string; value: number }[];
    // Two bars are a comparison, not a chart; it reads better as two numbers.
    if (pairs.length >= 3) {
      slide.chart = {
        labels: pairs.slice(0, 6).map((pair) => clip(pair.name, 22)),
        names: pairs.slice(0, 6).map((pair) => pair.name),
        values: pairs.slice(0, 6).map((pair) => Math.round(pair.value * 100) / 100),
        unit: clip(compactValue(cleanLine(raw.chart.unit, 40), 28), 24),
        insight: cleanLine(raw.chart.insight, 200),
      };
    }
  }

  return settle(slide);
}

/** Demote a page to the kind its content can actually fill. */
export function settle(slide: SlideContent): SlideContent {
  const enough = (count: number) => slide.points.length >= count;
  switch (slide.kind) {
    case "stats":
      if (slide.stats.length >= 2) return slide;
      if (slide.chart) return { ...slide, kind: "chart" };
      return settle({ ...slide, kind: enough(3) ? "cards" : "statement" });
    case "chart":
      if (slide.chart) return slide;
      if (slide.stats.length >= 2) return { ...slide, kind: "stats" };
      return settle({ ...slide, kind: enough(3) ? "cards" : "statement" });
    case "comparison":
      if (slide.left && slide.right && slide.left.points.length && slide.right.points.length) return slide;
      return settle({ ...slide, kind: enough(3) ? "cards" : "statement" });
    case "quote":
      if (slide.quote) return slide;
      return settle({ ...slide, kind: "statement" });
    case "cards":
    case "process":
    case "timeline":
      if (enough(3)) return { ...slide, points: slide.points.slice(0, slide.kind === "cards" ? 4 : 5) };
      return settle({ ...slide, kind: enough(2) ? "bullets" : "statement" });
    case "bullets":
    case "photo":
      if (enough(2)) return { ...slide, points: slide.points.slice(0, slide.kind === "photo" ? 3 : 5) };
      return settle({ ...slide, kind: "statement" });
    case "statement":
    default:
      if (!slide.lead) {
        const first = slide.points[0];
        return { ...slide, kind: "statement", lead: first ? [first.title, first.text].filter(Boolean).join(" — ") : slide.title };
      }
      return { ...slide, kind: "statement" };
  }
}

/** The page written from the outline alone, when the copy call failed. */
export function slideFromOutline(entry: OutlineEntry): SlideContent {
  return settle({
    kind: "statement",
    title: entry.title,
    eyebrow: "",
    lead: entry.focus,
    points: [],
    stats: [],
    quote: null,
    chart: null,
    left: null,
    right: null,
    imageQuery: entry.imageQuery,
  });
}

/* --------------------------------------------------------------- sources */

const NOTE_HEADINGS = /^(faktlar|raqamlar|diagramma uchun|ta['‘’ʼ]?riflar|manbalar|sources|adabiyotlar)\b/i;

/** "UNESCO hisobot sahifasi — unesco.org" out of a line that may carry markdown or a bare link. */
function sourceLine(raw: string): string {
  let line = raw.replace(/^\s*([-•–*]|\d+[.)])\s*/, "").replace(/[*_`#]/g, "").trim();
  // A bare link is the whole citation: keep where it points, not only whose it is.
  const bare = line.match(/^<?(https?:\/\/\S+?)>?$/);
  if (bare) return clip(cleanLine(bare[1]!.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), 260), 200);
  line = line.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, title: string, url: string) => {
    let host = "";
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { host = ""; }
    return host && !title.includes(host) ? `${title} — ${host}` : title;
  });
  line = line.replace(/https?:\/\/(www\.)?([^\s/)]+)[^\s)]*/g, (_, _www: string, host: string) => host);
  return clip(cleanLine(line.replace(/\s+[—–-]\s*$/, ""), 260), 200);
}

/**
 * The bibliography the research notes already name.
 *
 * The research prompt asks for a MANBALAR list, and the notes carry it whether
 * or not the model chose to search the live web — grounding links come back
 * only when it did. Without this, a deck researched from the model's own
 * knowledge closed on a bibliography of one generic sentence. The list is
 * read first; failing that, the "(manba)" each fact was asked to end with.
 */
export function sourcesFromNotes(notes: string): string[] {
  const lines = notes.split(/\r?\n/);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const line = sourceLine(value);
    const key = line.toLowerCase();
    if (line.length < 4 || seen.has(key)) return;
    seen.add(key);
    out.push(line);
  };

  const heading = (line: string) => line.replace(/^\s*([-•–*]|\d+[.)])?\s*/, "").replace(/[*_`#]/g, "").trim();
  const start = lines.findIndex((line) => /^(manbalar|sources|adabiyotlar)\b/i.test(heading(line)));
  if (start >= 0) {
    // Items may follow the heading on its own line, after its colon.
    const inline = heading(lines[start]!).replace(/^[^:]*:?/, "").trim();
    if (inline) inline.split(/;\s*/).forEach(add);
    for (const line of lines.slice(start + 1)) {
      if (!line.trim()) continue;
      if (NOTE_HEADINGS.test(heading(line)) && /:/.test(line)) break;
      add(line);
    }
  }
  if (out.length === 0) {
    for (const match of notes.matchAll(/\(([^()]{3,120})\)/g)) {
      const inside = match[1]!.trim();
      // A source names somebody: letters, not a bare number or percentage.
      if (/[A-Za-zА-Яа-яʻ‘’]{3,}/.test(inside) && !/^\d/.test(inside)) add(inside);
    }
  }
  return out.slice(0, 8);
}
