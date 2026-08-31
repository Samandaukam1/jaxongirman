/**
 * What the model is asked, and what it is allowed to answer.
 *
 * The engine's creative half. It decides composition — which elements a page
 * needs, where they sit, which treatment they take, what they say — and it
 * decides nothing that can be computed. No hex values: colours are named by
 * role and resolved from the deck's palette. No font names: faces are named by
 * role and resolved from the library. No pixels: placement is grid cells,
 * compiled once.
 *
 * That is not a stylistic preference. A model asked for six colours returns six
 * plausible ones and plausible colours fail contrast; asked for coordinates it
 * returns plausible ones and plausible coordinates overlap. Asked only for
 * things that cannot be checked by arithmetic, it does the part it is good at.
 *
 * The schema here and the vocabulary in `scene-spec` must not drift apart —
 * a schema admitting a role the reader rejects produces slides that vanish at
 * validation, which is the worst of both. The tests hold them together.
 */

import {
  CARD_TREATMENTS, CHART_TYPES, COLOR_ROLES, FONT_ROLES, GRID, IMAGE_TREATMENTS,
  SHAPE_KINDS, TEXT_ROLES, TYPE_SCALE,
  type Scene,
} from "./scene-spec.ts";
import { MOODS, GROUNDS } from "./scene-dna.ts";
import type { QualityReport } from "./scene-quality.ts";

/* ------------------------------------------------------------------- brief */

/**
 * What a slide is for, decided before anything is drawn.
 *
 * The old pipeline chose a composition from the layout and then wrote copy into
 * it. This is the other order: the meaning is settled first, and the
 * composition is built for it. `visualPriority` is the single number that
 * decides whether a page leads with a picture or with an argument.
 */
export type SemanticBrief = {
  slideGoal: string;
  mainMessage: string;
  supportingMessage: string | null;
  /** 0–1. How much of this page is words rather than air and image. */
  informationDensity: number;
  /** 0–1. How much of the page's job the picture does. */
  visualPriority: number;
  needs: {
    image: boolean;
    chart: boolean;
    statistic: boolean;
    quote: boolean;
    comparison: boolean;
    timeline: boolean;
    example: boolean;
  };
};

export function briefSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      slideGoal: { type: "string" },
      mainMessage: { type: "string" },
      supportingMessage: { type: ["string", "null"] },
      informationDensity: { type: "number" },
      visualPriority: { type: "number" },
      needs: {
        type: "object",
        additionalProperties: false,
        properties: {
          image: { type: "boolean" },
          chart: { type: "boolean" },
          statistic: { type: "boolean" },
          quote: { type: "boolean" },
          comparison: { type: "boolean" },
          timeline: { type: "boolean" },
          example: { type: "boolean" },
        },
        required: ["image", "chart", "statistic", "quote", "comparison", "timeline", "example"],
      },
    },
    required: ["slideGoal", "mainMessage", "supportingMessage", "informationDensity", "visualPriority", "needs"],
  };
}

/* ------------------------------------------------------------- direction */

/** The deck's visual language, in the only terms a model may set it in. */
export function directionSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      mood: { type: "string", enum: [...MOODS] },
      ground: { type: "string", enum: [...GROUNDS] },
      // One colour, and the palette is derived from it. Six would be six
      // chances to fail contrast.
      brand: { type: "string" },
      cornerLanguage: { type: "string", enum: ["sharp", "soft", "pill"] },
      gradients: { type: "boolean" },
      reason: { type: "string" },
    },
    required: ["mood", "ground", "brand", "cornerLanguage", "gradients", "reason"],
  };
}

/* ---------------------------------------------------------------- scene */

const placement = {
  type: "object",
  additionalProperties: false,
  properties: {
    column: { type: "integer" },
    span: { type: "integer" },
    row: { type: "integer" },
    rows: { type: "integer" },
    bleed: { type: "boolean" },
  },
  required: ["column", "span", "row", "rows"],
};

/**
 * Typography sits on the element rather than in an object of its own.
 *
 * Gemini refused the nested schema — an element inside a card with a
 * typography object inside it is a depth the provider rejects without naming
 * what it objected to. Flat is also less for a model to track, and the reader
 * takes either shape.
 */
const TYPOGRAPHY_FIELDS = {
  font: { type: "string", enum: [...FONT_ROLES] },
  step: { type: "string", enum: Object.keys(TYPE_SCALE) },
  color: { type: "string", enum: [...COLOR_ROLES] },
  align: { type: "string", enum: ["start", "center", "end"] },
};

const intent = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: { type: "string" },
    orientation: { type: "string", enum: ["landscape", "portrait", "square"] },
  },
  required: ["query", "orientation"],
};

/** What a card holds: type, stacked in order, with no grid of its own. */
const cardChild = {
  type: "object",
  additionalProperties: false,
  properties: {
    role: { type: "string", enum: [...TEXT_ROLES] },
    text: { type: "string" },
    ...TYPOGRAPHY_FIELDS,
  },
  required: ["role", "text", "font", "step", "color"],
};

/**
 * One level of nesting, and no more.
 *
 * A card inside a card is a composition nobody wanted and a recursive schema
 * models refuse in different ways. Cards hold type; that is what they are for.
 */
export function sceneSchema(): Record<string, unknown> {
  /**
   * Small on purpose.
   *
   * Gemini refused this schema at 3.9KB with `INVALID_ARGUMENT` and named
   * nothing; the deck writer's own schema, which it accepts, is 1.5KB. So
   * every field the renderer can decide for itself was taken out — corner
   * radius comes from the deck's DNA, alignment from the role, decoration is
   * not offered at all in this version. What is left is what only the designer
   * can know: which elements, where, in what treatment, saying what.
   */
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      background: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["solid", "gradient", "image"] },
          color: { type: "string", enum: [...COLOR_ROLES] },
          from: { type: "string", enum: [...COLOR_ROLES] },
          to: { type: "string", enum: [...COLOR_ROLES] },
          intent,
          overlay: { type: "string", enum: ["none", "scrim_bottom", "veil"] },
        },
        required: ["kind"],
      },
      elements: {
        type: "array",
        /**
         * No `minItems`/`maxItems` anywhere in here.
         *
         * Gemini refuses this schema outright when they are present and names
         * nothing — a probe against five variants showed the limits alone are
         * what it objects to. The bounds are real and still enforced, in the
         * reader, which is where validation belongs: a schema is a shape, and
         * how many elements make a slide is a judgement about slides.
         */
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["text", "image", "card", "chart"] },
            place: placement,
            role: { type: "string", enum: [...TEXT_ROLES] },
            text: { type: "string" },
            font: { type: "string", enum: [...FONT_ROLES] },
            step: { type: "string", enum: Object.keys(TYPE_SCALE) },
            color: { type: "string", enum: [...COLOR_ROLES] },
            treatment: { type: "string", enum: [...IMAGE_TREATMENTS, ...CARD_TREATMENTS] },
            intent,
            overlay: { type: "string", enum: ["none", "scrim_bottom", "veil"] },
            children: { type: "array", items: cardChild },
            chart: {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", enum: [...CHART_TYPES] },
                labels: { type: "array", items: { type: "string" } },
                values: { type: "array", items: { type: "number" } },
              },
              required: ["kind", "labels", "values"],
            },
          },
          required: ["type", "place"],
        },
      },
    },
    required: ["background", "elements"],
  };
}

/* --------------------------------------------------------------- prompts */

const GRID_RULES = [
  `Sahifa ${GRID.columns} ustun × ${GRID.rows} qatorli setkaga joylashadi.`,
  `"place": {"column": 0…${GRID.columns - 1}, "span": 1…${GRID.columns}, "row": 0…${GRID.rows - 1}, "rows": 1…${GRID.rows}}.`,
  `column+span ${GRID.columns} dan, row+rows ${GRID.rows} dan oshmasin.`,
  `Elementlar bir xil kataklarni EGALLAMASIN — ustma-ust tushgan slayd rad etiladi.`,
  `"bleed": true faqat butun sahifani egallaydigan fon rasmi uchun.`,
  `Sahifada 2 tadan 10 tagacha element bo'lsin; kartada 4 tadan ko'p bo'lmasin.`,
  `Chartda 2 tadan 6 tagacha qiymat bo'lsin.`,
].join("\n");

const VOCABULARY = [
  `Rang o'rniga ROL yoz: ${COLOR_ROLES.join(", ")}. HEX YOZMA.`,
  `Font o'rniga ROL yoz: ${FONT_ROLES.join(", ")}. Font nomini YOZMA.`,
  `O'lcham o'rniga POG'ONA yoz: ${Object.keys(TYPE_SCALE).join(", ")}. Piksel YOZMA.`,
].join("\n");

export function directionPrompt(topic: string, language = "uz"): string {
  return [
    "Siz taqdimot uchun vizual til tanlaysiz. Bu shablon emas — faqat kayfiyat, fon va bitta brend rang.",
    `Mavzu: ${topic}`,
    `Til: ${language}`,
    "",
    "Mavzuga mos tanlang:",
    "- texnologiya → geometric yoki cinematic",
    "- tarix/madaniyat → editorial yoki warm",
    "- tibbiyot/fan → clinical",
    "- biznes → civic yoki geometric",
    "",
    "brand: bitta #RRGGBB rang. Qolgan barcha ranglar shundan hisoblanadi — palitra yozmang.",
    "reason: bir jumlada nega shu til tanlanganini yozing.",
  ].join("\n");
}

/**
 * What this page is for, in the deck's arc rather than on its own.
 *
 * Every brief was written independently, so a ten-page deck came out as ten
 * explanations: each one sound, the sequence flat. A reader needs the register
 * to change — context, then evidence, then a case, then what it means, then
 * what follows — and the model cannot see that from one slide's title.
 *
 * Assigned by position rather than asked for, because it is a property of the
 * deck and the model is only ever shown one page of it.
 */
const REGISTERS = [
  "KONTEKST — nima va nega muhim",
  "DALIL — raqam, ulush yoki manba",
  "MISOL — aniq holat yoki amaliyot",
  "TAHLIL — sabab va natija",
  "ISTIQBOL — kelajak, tavsiya yoki xulosa",
] as const;

export function registerFor(position: number, total: number): string | null {
  // The fixed pages have their own jobs; only the body carries the arc.
  if (position === 0 || position === 1 || position >= total - 2) return null;
  return REGISTERS[(position - 2) % REGISTERS.length]!;
}

export function briefPrompt(input: {
  topic: string;
  title: string;
  position: number;
  total: number;
  research: string | null;
}): string {
  return [
    "Siz slaydning MA'NOSINI aniqlaysiz. Hali dizayn yo'q.",
    `Taqdimot mavzusi: ${input.topic}`,
    `Slayd ${input.position + 1}/${input.total}: ${input.title}`,
    (() => {
      const register = registerFor(input.position, input.total);
      return register
        ? `Bu sahifaning registri: ${register}. Oldingi sahifadan boshqacha ohangda yozing.`
        : null;
    })(),
    input.research ? `Manba:\n${input.research}` : null,
    "",
    "slideGoal: bu sahifa nima uchun kerak.",
    "mainMessage: o'quvchi ketayotganda esida qoladigan bitta fikr.",
    "supportingMessage: uni quvvatlaydigan ikkinchi fikr, bo'lmasa null.",
    "informationDensity: 0–1. Qancha so'z kerak.",
    "visualPriority: 0–1. Rasm sahifaning qancha vazifasini bajaradi.",
    "needs: faqat HAQIQATAN kerak bo'lganini true qiling.",
    "Statistika yoki iqtibosni O'YLAB TOPMANG — manbada bo'lmasa false.",
  ].filter(Boolean).join("\n");
}

/**
 * Two worked pages, because rules did not produce them.
 *
 * Told in prose to use the page, the model returned single-element slides that
 * satisfied every rule and looked like nothing: half a real deck came back as
 * the engine's own plain fallback. An example is the one instruction a model
 * follows exactly — these show the density, the layering and the mix of
 * elements a page is supposed to have, in the same schema it must answer in.
 *
 * Two, not six: they cost tokens on every slide of every deck, and a third
 * would teach little the first two do not.
 */
const EXAMPLES = JSON.stringify([
  {
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "text", role: "eyebrow", place: { column: 0, span: 4, row: 0, rows: 1 }, text: "01 — KONTEKST", font: "body", step: "micro", color: "inkMuted" },
      { type: "text", role: "title", place: { column: 0, span: 7, row: 1, rows: 2 }, text: "Suv taqchilligi qanday paydo bo'ldi", font: "display", step: "title", color: "ink" },
      { type: "text", role: "body", place: { column: 0, span: 6, row: 3, rows: 4 }, text: "To'rt-besh jumlalik izoh: sabab, mexanizm, natija va aniq misol.", font: "body", step: "body", color: "ink" },
      { type: "image", place: { column: 7, span: 5, row: 1, rows: 6 }, treatment: "rounded", intent: { query: "Orol dengizi qurigan tubi", orientation: "portrait" } },
    ],
  },
  {
    background: { kind: "solid", color: "background" },
    elements: [
      { type: "text", role: "title", place: { column: 0, span: 12, row: 0, rows: 2 }, text: "Raqamlarda", font: "display", step: "heading", color: "ink" },
      { type: "card", treatment: "glass", place: { column: 0, span: 4, row: 2, rows: 3 }, children: [
        { role: "statistic", text: "73%", font: "data", step: "statistic", color: "primary" },
        { role: "statistic_label", text: "suv qishloq xo'jaligiga ketadi", font: "body", step: "caption", color: "inkMuted" },
      ] },
      { type: "chart", place: { column: 4, span: 8, row: 2, rows: 3 }, chart: { kind: "bar", labels: ["1990", "2005", "2020"], values: [64, 41, 23] } },
      { type: "text", role: "body", place: { column: 0, span: 12, row: 5, rows: 2 }, text: "Diagramma yonidagi izoh: raqam nimani anglatadi va nega muhim.", font: "body", step: "body", color: "ink" },
    ],
  },
]);

/**
 * What a cover has to do, which is not what a content page has to do.
 *
 * It is the page an author looks at first and the one they show a room, and it
 * is the only page whose subject is the whole deck. Left to the same rules as
 * everything else it came back as a heading on a plain ground — correct by
 * every measure and not a cover.
 *
 * The metadata lines are given as text rather than described, because "add the
 * student's name" produces a label reading "Talaba" and nothing after it.
 */
function coverRules(input: { topic: string; author: string | null; teacher: string | null }): string[] {
  const lines = [
    "BU — MUQOVA. Boshqa sahifalardan farq qiladi:",
    `- Butun sahifani egallovchi fon rasmi: {"type":"image","place":{"column":0,"span":12,"row":0,"rows":8,"bleed":true},"treatment":"full_bleed","overlay":"scrim_bottom","intent":{"query":"<${input.topic} bilan bevosita bog'liq aniq sahna>","orientation":"landscape"}}`,
    "- Sarlavha pastki qismda, step=\"display\", color=\"onImage\" — mavzu nomi sahifada eng katta narsa bo'lsin.",
    "- Rasm so'rovi mavzuga aniq bog'liq bo'lsin: umumiy \"fon\" yoki \"abstrakt\" emas.",
    "- Muqovada card, chart va uzun paragraf BO'LMASIN.",
  ];
  // Only what exists: a blank line is a line the author fills in by hand, and
  // an empty label is worse than no label.
  const meta: string[] = [];
  if (input.author) meta.push(`Tayyorladi: ${input.author}`);
  if (input.teacher) meta.push(`O'qituvchi: ${input.teacher}`);
  if (meta.length > 0) {
    lines.push(`- Pastki qismda kichik matn (step=\"caption\", color=\"onImage\"): "${meta.join(" · ")}"`);
  }
  return lines;
}

export function scenePrompt(input: {
  brief: SemanticBrief;
  topic: string;
  fonts: Record<string, string>;
  mood: string;
  /** Compositions already used in this deck, so the next one differs. */
  used: readonly string[];
  language?: string;
  /** Covers and closing pages are not content pages and are told so. */
  kind?: "cover" | "content" | "closing";
  author?: string | null;
  teacher?: string | null;
}): string {
  return [
    "Siz shu slayd uchun kompozitsiyani NOLDAN quruvchi dizaynersiz. Shablon tanlamaysiz.",
    "",
    `Mavzu: ${input.topic}`,
    `Vizual til: ${input.mood}`,
    `Fontlar: ${Object.entries(input.fonts).map(([role, name]) => `${role}=${name}`).join(", ")}`,
    "",
    "SLAYDNING MA'NOSI:",
    JSON.stringify(input.brief),
    "",
    "NAMUNALAR — shu zichlik va shu aralashmada quring (matnni ko'chirmang):",
    EXAMPLES,
    "",
    "SETKA:",
    GRID_RULES,
    "",
    "LUG'AT:",
    VOCABULARY,
    "",
    ...(input.kind === "cover"
      ? [...coverRules({ topic: input.topic, author: input.author ?? null, teacher: input.teacher ?? null }), ""]
      : []),
    ...(input.kind === "closing"
      ? [
        "BU — YAKUNIY SAHIFA. Bullet ro'yxati emas:",
        "- Kuchli yakuniy fikr (step=\"heading\" yoki \"title\").",
        "- Ostida 2–3 ta asosiy xulosa yoki bitta qisqa paragraf.",
        "",
      ]
      : []),
    "QOIDALAR:",
    /**
     * First, because it is the rule the model actually broke.
     *
     * The first real run produced title + image + caption on three pages out
     * of four: every one of them looked like a slide and said nothing. A
     * caption is a label for something else, so it is named here as not
     * counting.
     */
    "- MAJBURIY: har bir sahifada role=\"body\" YOKI role=\"bullets\" YOKI role=\"lead\" bo'lgan matn, yoki chart, yoki card bo'lsin.",
    "  Sarlavha, eyebrow va caption mazmun HISOBLANMAYDI — ular boshqa narsaning yorlig'i.",
    /**
     * Sizes, because "use the page" is not an instruction a model can follow.
     *
     * The first runs came back with everything in one- and two-row bands: no
     * overlap, no overflow, and a third of the page doing any work. Concrete
     * spans are something a model can obey and the compiler can check.
     */
    "- Har bir sahifada role=\"title\" bo'lsin (muqovada ham) — sahifa nima haqidaligini aytsin.",
    "- O'LCHAM: title kamida 6 ustun × 2 qator. body/bullets kamida 5 ustun × 3 qator.",
    "  Rasm kerak bo'lsa kamida 4 ustun × 4 qator. Elementlar sahifaning kamida yarmini egallasin.",
    "- Sahifada bitta eng katta element bo'lsin — ko'z avval qayerga tushishini bilsin.",
    "- Bo'sh joy dizaynning bir qismi: sahifani to'ldirish shart emas, lekin yarim bo'sh sahifa ham bo'lmasin.",
    "- Rasm kerak bo'lsa KATTA bo'lsin; kichik thumbnail ishlatmang.",
    "- Rasm ustidagi matn uchun overlay (scrim_bottom yoki veil) qo'ying va color: onImage ishlating.",
    "- Statistika bo'lsa: katta raqam + yonida uni tushuntiruvchi matn.",
    "- Chart bo'lsa: yonida tushuntirish bo'lsin, chart yolg'iz qolmasin.",
    "- Fakt, raqam, sana, ism yoki iqtibosni O'YLAB TOPMANG.",
    input.used.length > 0
      ? `- Bu decknning oldingi kompozitsiyalari: ${input.used.slice(-3).join(" ; ")}. Boshqacha quring.`
      : null,
  ].filter(Boolean).join("\n");
}

/**
 * What to change, in the words of what was measured.
 *
 * A repair asked for "make it better" returns the same slide. Each fault
 * carries the element it happened at and the numbers behind it, so the
 * instruction is a specific edit rather than an opinion.
 */
export function repairPrompt(scene: Scene, report: QualityReport): string {
  const advice: Record<string, string> = {
    collision: "elementlarni boshqa kataklarga ko'chiring — ular ustma-ust tushyapti",
    out_of_bounds: "element setkadan chiqib ketgan, place ni tuzating",
    overflow: "matnni qisqartiring YOKI blokka ko'proq qator bering — shrift o'lchamini kichraytirmang",
    sparse: "sahifa juda bo'sh: elementlarning span va rows qiymatlarini kattalashtiring (body kamida 5×3, title 6×2)",
    crowded: "sahifa juda to'la: kamroq element yoki ko'proq bo'sh joy",
    unbalanced: "og'irlik bir burchakka yig'ilgan, muvozanatlang",
    no_hierarchy: "ikkita element bir xil eng katta o'lchamda — bittasini kichraytiring",
    repeats: "oldingi slayd bilan bir xil joylashuv — elementlarni boshqacha joylashtiring (masalan rasm chapga, matn o'ngga yoki to'liq boshqa struktura)",
    no_heading: "sahifada sarlavha yo'q — role=\"title\" matn qo'shing",
    no_content: "sahifada mazmun yo'q — role=\"body\" matn qo'shing (sarlavha va caption hisoblanmaydi)",
  };
  return [
    "Quyidagi slayd tekshiruvdan o'tmadi. Uni TUZATING — qaytadan yozmang, faqat kamchiliklarni yo'qoting.",
    `Ball: ${report.score}/100`,
    "",
    "KAMCHILIKLAR:",
    ...report.faults.map((fault) => `- ${fault.code} (${fault.detail}) → ${advice[fault.code] ?? "tuzating"}`),
    "",
    "JORIY SLAYD:",
    JSON.stringify(scene),
    "",
    "Xuddi shu sxemada to'liq tuzatilgan slaydni qaytaring.",
  ].join("\n");
}
