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

const typography = {
  type: "object",
  additionalProperties: false,
  properties: {
    font: { type: "string", enum: [...FONT_ROLES] },
    step: { type: "string", enum: Object.keys(TYPE_SCALE) },
    color: { type: "string", enum: [...COLOR_ROLES] },
    align: { type: "string", enum: ["start", "center", "end"] },
  },
  required: ["font", "step", "color"],
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

const textElement = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["text"] },
    role: { type: "string", enum: [...TEXT_ROLES] },
    place: placement,
    typography,
    text: { type: "string" },
  },
  required: ["type", "role", "place", "typography", "text"],
};

/**
 * One level of nesting, and no more.
 *
 * A card inside a card is a composition nobody wanted and a recursive schema
 * models refuse in different ways. Cards hold type; that is what they are for.
 */
export function sceneSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      purpose: { type: "string" },
      background: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["solid", "gradient", "image", "panel_split"] },
          color: { type: "string", enum: [...COLOR_ROLES] },
          from: { type: "string", enum: [...COLOR_ROLES] },
          to: { type: "string", enum: [...COLOR_ROLES] },
          angle: { type: "number" },
          panel: { type: "string", enum: [...COLOR_ROLES] },
          at: { type: "number" },
          intent,
          overlay: { type: "string", enum: ["none", "scrim_bottom", "scrim_left", "veil"] },
        },
        required: ["kind"],
      },
      elements: {
        type: "array",
        minItems: 2,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["text", "image", "card", "chart", "shape"] },
            role: { type: "string", enum: [...TEXT_ROLES] },
            kind: { type: "string", enum: [...SHAPE_KINDS, ...CHART_TYPES] },
            place: placement,
            typography,
            text: { type: "string" },
            treatment: { type: "string", enum: [...IMAGE_TREATMENTS, ...CARD_TREATMENTS] },
            radius: { type: "number" },
            intent,
            overlay: { type: "string", enum: ["none", "scrim_bottom", "scrim_left", "veil"] },
            color: { type: "string", enum: [...COLOR_ROLES] },
            opacity: { type: "number" },
            children: { type: "array", maxItems: 4, items: textElement },
            chart: {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", enum: [...CHART_TYPES] },
                labels: { type: "array", minItems: 2, maxItems: 8, items: { type: "string" } },
                values: { type: "array", minItems: 2, maxItems: 8, items: { type: "number" } },
                unit: { type: "string" },
              },
              required: ["kind", "labels", "values"],
            },
          },
          required: ["type", "place"],
        },
      },
    },
    required: ["purpose", "background", "elements"],
  };
}

/* --------------------------------------------------------------- prompts */

const GRID_RULES = [
  `Sahifa ${GRID.columns} ustun × ${GRID.rows} qatorli setkaga joylashadi.`,
  `"place": {"column": 0…${GRID.columns - 1}, "span": 1…${GRID.columns}, "row": 0…${GRID.rows - 1}, "rows": 1…${GRID.rows}}.`,
  `column+span ${GRID.columns} dan, row+rows ${GRID.rows} dan oshmasin.`,
  `Elementlar bir xil kataklarni EGALLAMASIN — ustma-ust tushgan slayd rad etiladi.`,
  `"bleed": true faqat butun sahifani egallaydigan fon rasmi uchun.`,
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

export function scenePrompt(input: {
  brief: SemanticBrief;
  topic: string;
  fonts: Record<string, string>;
  mood: string;
  /** Compositions already used in this deck, so the next one differs. */
  used: readonly string[];
  language?: string;
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
    "SETKA:",
    GRID_RULES,
    "",
    "LUG'AT:",
    VOCABULARY,
    "",
    "QOIDALAR:",
    "- Sahifada bitta eng katta element bo'lsin — ko'z avval qayerga tushishini bilsin.",
    "- Har bir sahifada mazmun tashuvchi element bo'lsin: body, bullets, lead, quote, statistic, chart yoki card.",
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
    sparse: "sahifa juda bo'sh: mazmun qo'shing yoki elementlarni kattalashtiring",
    crowded: "sahifa juda to'la: kamroq element yoki ko'proq bo'sh joy",
    unbalanced: "og'irlik bir burchakka yig'ilgan, muvozanatlang",
    no_hierarchy: "ikkita element bir xil eng katta o'lchamda — bittasini kichraytiring",
    no_content: "sahifada mazmun tashuvchi element yo'q: body, card yoki chart qo'shing",
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
