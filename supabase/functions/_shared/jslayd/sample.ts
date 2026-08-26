// GENERATED FILE — do not edit by hand.
// Source: packages/jslayd/src/sample.ts
// Regenerate with: node supabase/scripts/build-jslayd-runtime.mjs
//
// The JSLAYD runtime, projected into the Edge tree. Edit the package, not this.

import { buildWritingBrief, checkFit, type TextSlotBudget } from "./budget.ts";
import { DEFAULT_META, type SlideData } from "./content.ts";
import type { Archetype, JslaydDocument } from "./document.ts";
import type { Binding } from "./spec.ts";

/**
 * Filling a blueprint with real content, without letting the model near the
 * layout.
 *
 * This is the studio's "namunaviy slayd", and it is also what generation does —
 * which is the point. An admin judging a design has to see what a customer
 * would get, not a flattering mock-up written to fit. So the same three things
 * happen here as in the pipeline: the blueprint states its slots and how much
 * each one holds, the model writes into them, and what comes back is measured
 * against the real boxes before anything is drawn.
 *
 * The model is told about roles and lengths. It is never told a coordinate, a
 * font, a colour or a size, and it is never shown the design — there is nothing
 * here for it to move. That division is the whole architecture: the art
 * direction is the blueprint's, the words are the model's, and neither is
 * asked to do the other's job.
 */

/* ------------------------------------------------------------------ asking */

/** A slot as the model is shown it: what to write, and how much. */
export type SlotRequest = {
  binding: Binding;
  role: string;
  /** Aim for this; the maximum is what actually fits the box. */
  idealWords: number;
  maxWords: number;
  maxCharacters: number;
  /** Only for a list: how many items the design will draw. */
  maxItems?: number;
  /** 1 is the loudest thing on the slide. */
  priority: number;
};

export type SampleBrief = {
  archetypeId: string;
  purpose: string;
  language: string;
  slots: SlotRequest[];
  wantsImage: boolean;
  wantsChart: boolean;
  wantsTable: boolean;
};

const ROLE_INSTRUCTION: Record<string, string> = {
  eyebrow: "bo‘lim yorlig‘i, ikki-uch so‘z",
  title: "asosiy sarlavha; kuchli va aniq, to‘liq gap emas",
  subtitle: "sarlavhani to‘ldiruvchi bir qator",
  body: "bir-ikki jumlalik izoh; sarlavhani takrorlamang",
  bullets: "mustaqil o‘qiladigan qisqa band",
  quote: "mavzuga oid qisqa iqtibos",
  attribution: "iqtibos muallifi",
  statistic_value: "faqat son, belgisi bilan bo‘lishi mumkin (42%, 1.8×)",
  statistic_label: "son nimani bildiradi",
  chart_title: "diagramma sarlavhasi",
  table_title: "jadval sarlavhasi",
  meta: "qo‘shimcha ma’lumot",
};

/**
 * Bindings whose answer would be thrown away, so they are never asked for.
 *
 * `stat_2` and `stat_3` resolve to null by construction — a slide carries one
 * figure and `resolveBinding` says so — so a design with three stat cards draws
 * one and drops two. Asking the model to write the other two would spend tokens
 * on text that cannot reach the slide, and would read in review as a bug in the
 * writer rather than the engine's documented shape.
 */
const UNREACHABLE = new Set<Binding>(["stat_2", "stat_3"]);

/**
 * Where a binding's answer lands in `SlideData`.
 *
 * Several bindings share one field: `chart_title` and `table_title` both read
 * `slide.title`, and `stat_1` reads the same value as `stat_value`. Asking for
 * each separately would spend two answers on one string and then silently keep
 * whichever was written last. So slots are merged by destination, and the
 * tightest box wins the budget — text sized for the smaller of the two boxes
 * fits both, and text sized for the larger overflows one of them.
 */
function fieldOf(binding: Binding): string {
  if (binding === "chart_title" || binding === "table_title") return "title";
  if (binding === "stat_1") return "stat_value";
  if (binding.startsWith("bullet_")) return binding;
  return binding;
}

/**
 * What to ask for, derived from the design rather than declared beside it.
 *
 * The capacity numbers come from `buildWritingBrief`, which measures the actual
 * box with the actual font — not from a `maxWords` somebody typed into the
 * blueprint and never checked against the geometry. A slot claiming seven words
 * over a box that holds four is a deck that overflows on every slide.
 */
export function sampleBrief(
  document: JslaydDocument,
  archetype: Archetype,
  options: { language?: string } = {},
): SampleBrief {
  return {
    archetypeId: archetype.id,
    purpose: archetype.purpose,
    language: options.language ?? "uz",
    slots: [...chosenSlots(document, archetype, options).values()]
      .map((chosen) => chosen.request)
      .sort((a, b) => a.priority - b.priority),
    wantsImage: archetype.selection.supportsImage,
    wantsChart: archetype.selection.supportsChart,
    wantsTable: archetype.selection.supportsTable,
  };
}

/**
 * One question per destination, each carrying the box it must survive.
 *
 * Shared by the asking half and the reading half on purpose. They were written
 * separately once, and the reading half looked the budget up by binding — which
 * finds the first box in document order, not the box the question was sized
 * for. A design that draws its section label twice, wide at the top and narrow
 * in the corner, then produced text measured against the wide one and clipped
 * in the narrow one, and nothing reported a problem because both halves were
 * individually consistent. Deriving both from this map is what makes that
 * disagreement impossible rather than merely fixed.
 */
function chosenSlots(
  document: JslaydDocument,
  archetype: Archetype,
  options: { language?: string },
): Map<string, { request: SlotRequest; budget: TextSlotBudget }> {
  const brief = buildWritingBrief(document, archetype, { language: options.language ?? "uz" });
  const byField = new Map<string, { request: SlotRequest; budget: TextSlotBudget }>();

  for (const slot of brief.slots) {
    if (UNREACHABLE.has(slot.binding)) continue;

    const request: SlotRequest = {
      binding: slot.binding,
      role: slot.role,
      idealWords: slot.budget.preferredWords,
      maxWords: slot.budget.maximumWords,
      maxCharacters: slot.budget.maximumCharacters,
      ...(slot.budget.maximumItems ? { maxItems: slot.budget.maximumItems } : {}),
      priority: slot.priority,
    };

    const field = fieldOf(slot.binding);
    const seen = byField.get(field);
    if (!seen) {
      byField.set(field, { request, budget: slot });
      continue;
    }
    // Same destination, smaller box: keep the one that is hardest to fit, and
    // the priority of whichever slot the design shouts loudest.
    if (request.maxCharacters < seen.request.maxCharacters) {
      byField.set(field, {
        request: { ...request, priority: Math.min(seen.request.priority, request.priority) },
        budget: slot,
      });
    }
  }

  return byField;
}

/**
 * The instruction.
 *
 * Deliberately short. Every extra sentence is tokens spent on every sample an
 * admin generates, and the constraints that matter are numbers — which live in
 * the schema the answer is decoded against, not in prose a model may skim.
 */
export function samplePrompt(brief: SampleBrief, topic: string): string {
  const lines = [
    `Mavzu: ${topic}`,
    `Til: ${brief.language}`,
    `Slayd maqsadi: ${brief.purpose}`,
    "",
    "Quyidagi joylarga matn yozing. Belgilangan uzunlikdan oshmang — uzun matn",
    "slaydga sig‘maydi va kesiladi.",
    "",
  ];

  for (const slot of brief.slots) {
    const what = ROLE_INSTRUCTION[slot.role] ?? "ushbu joy uchun matn";
    /**
     * Characters, not only words.
     *
     * A statistics card in the corpus holds four characters. Said as "about one
     * word" that reads as an invitation to write "O‘zbekiston", and the answer
     * gets cut to "O‘zb" — obedient to the letter of the instruction and
     * useless on the slide. The character count is the constraint the box
     * actually imposes, so it is the one the writer is given.
     */
    const limit = slot.maxItems
      ? `${slot.maxItems} tagacha band, har biri ${slot.maxCharacters} belgidan oshmasin`
      : `${slot.idealWords} so‘z atrofida, ${slot.maxCharacters} belgidan oshmasin`;
    lines.push(`- ${slot.binding}: ${what}; ${limit}.`);
  }

  if (brief.wantsImage) {
    lines.push(
      "",
      "image_query: rasm qidiruvi uchun ingliz tilida 2–5 so‘z. Faqat predmetni",
      "nomlang — “3D”, “render”, “minimalist” kabi uslub so‘zlari fotobankda teg",
      "emas va qidiruvni buzadi.",
    );
  }
  if (brief.wantsChart) lines.push("", "chart: 3–6 ta yorliq va shuncha son.");
  if (brief.wantsTable) lines.push("", "table: 2–4 ustun va 2–5 qator.");

  // Never a coordinate, a font, a colour or a size. The design owns those.
  lines.push("", "Geometriya, shrift, rang yoki o‘lcham haqida hech narsa yozmang.");
  return lines.join("\n");
}

/**
 * The schema the answer is decoded against.
 *
 * Written in the subset Gemini reads, so it needs no narrowing pass: one
 * property per slot the design actually has, which is what stops the model
 * inventing a `footer` the blueprint has nowhere to put.
 */
export function sampleSchema(brief: SampleBrief): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const slot of brief.slots) {
    properties[slot.binding] = slot.maxItems
      ? {
        type: "array",
        description: `${slot.maxItems} tagacha band, har biri ${slot.maxCharacters} belgigacha`,
        items: { type: "string" },
        maxItems: slot.maxItems,
      }
      : { type: "string", description: `${slot.maxCharacters} belgigacha (${slot.maxWords} so‘z)` };
    required.push(slot.binding);
  }

  if (brief.wantsImage) {
    properties.image_query = { type: "string", description: "English, 2–5 words, subject only" };
    required.push("image_query");
  }
  if (brief.wantsChart) {
    properties.chart = {
      type: "object",
      properties: {
        type: { type: "string", enum: ["bar", "horizontalBar", "line", "area", "pie", "doughnut"] },
        labels: { type: "array", items: { type: "string" }, maxItems: 6 },
        values: { type: "array", items: { type: "number" }, maxItems: 6 },
      },
      required: ["type", "labels", "values"],
    };
  }
  if (brief.wantsTable) {
    properties.table = {
      type: "object",
      properties: {
        columns: { type: "array", items: { type: "string" }, maxItems: 4 },
        rows: { type: "array", items: { type: "array", items: { type: "string" } }, maxItems: 5 },
      },
      required: ["columns", "rows"],
    };
  }

  return { type: "object", properties, required };
}

/* ----------------------------------------------------------------- reading */

export type SampleAnswer = {
  [binding: string]: unknown;
  image_query?: string;
  chart?: { type?: string; labels?: unknown[]; values?: unknown[] };
  table?: { columns?: unknown[]; rows?: unknown[] };
};

export type SlotOutcome = {
  binding: Binding;
  text: string | string[];
  /** False when the answer was longer than its box and had to be cut. */
  fits: boolean;
  /** Characters the model wrote, when that was more than the box holds. */
  trimmedFrom?: number;
};

export type SampleResult = {
  slide: SlideData;
  outcomes: SlotOutcome[];
  /** What to search a photo bank for, when the design has an image slot. */
  imageQuery: string | null;
};

type ChartType = NonNullable<SlideData["chart"]>["type"];
const CHART_TYPES = new Set<string>(["bar", "horizontalBar", "line", "area", "pie", "doughnut", "donut"]);

/**
 * Take the model at its word, then measure.
 *
 * A length limit in a prompt is a request, not a guarantee, and the failure it
 * produces is the one nobody catches in review: a title that fits the sample
 * and overflows on the third real deck. So every answer goes back through
 * `checkFit` — the same measurement the generator uses — and anything past its
 * box is cut at a word boundary rather than shipped to be clipped mid-glyph.
 *
 * What comes out is a `SlideData`, not a bag of strings, because that is what
 * the renderer takes: the caller can draw the result immediately, and every
 * binding resolves through the same `resolveBinding` a customer's deck uses.
 */
export function readSample(
  answer: SampleAnswer,
  document: JslaydDocument,
  archetype: Archetype,
  options: { language?: string } = {},
): SampleResult {
  const chosen = chosenSlots(document, archetype, options);

  const outcomes: SlotOutcome[] = [];
  const text = new Map<Binding, string>();
  const bullets: string[] = [];

  for (const { request, budget } of chosen.values()) {
    const raw = answer[request.binding];
    if (raw === undefined || raw === null) continue;

    if (Array.isArray(raw)) {
      const limit = request.maxItems ?? raw.length;
      const items = raw.slice(0, limit).map((item) => fit(budget, String(item)));
      outcomes.push({
        binding: request.binding,
        text: items,
        fits: raw.length <= limit && items.every((item, at) => item === String(raw[at]).trim()),
        ...(raw.length > limit ? { trimmedFrom: raw.length } : {}),
      });
      for (const item of items) bullets.push(item);
      continue;
    }

    const written = String(raw).trim();
    const fits = checkFit(budget, written).fits;
    const kept = fits ? written : fit(budget, written);
    outcomes.push({
      binding: request.binding,
      text: kept,
      fits,
      ...(fits ? {} : { trimmedFrom: written.length }),
    });
    text.set(request.binding, kept);
  }

  // One column each, for a design built as parallel boxes: `bullet_3` is the
  // third item of the same list `bullets` would have drawn, so both shapes end
  // up in one array and `resolveBinding` reads whichever the design asked for.
  for (let at = 1; at <= 6; at += 1) {
    const one = text.get(`bullet_${at}` as Binding);
    if (one !== undefined) bullets[at - 1] = one;
  }

  const quoteText = text.get("quote_text");
  const quoteBy = text.get("quote_attribution");
  const statValue = text.get("stat_value") ?? text.get("stat_1");
  const statLabel = text.get("stat_label");

  const slide: SlideData = {
    index: 0,
    total: 1,
    purpose: archetype.purpose,
    title: text.get("title") ?? text.get("chart_title") ?? text.get("table_title") ?? "",
    subtitle: text.get("subtitle") ?? null,
    body: text.get("body") ?? null,
    bullets: bullets.filter((item) => typeof item === "string" && item.length > 0),
    /**
     * Either half is enough to build the pair.
     *
     * A timeline in the corpus draws stat labels down its spine and no figures
     * beside them. Requiring the value first meant the labels were written,
     * measured, reported as fitting — and then thrown away, because the object
     * that carries them was never created. The empty half resolves to null and
     * its element drops out on its own, which is what an unused slot should do.
     */
    quote: quoteText || quoteBy ? { text: quoteText ?? "", attribution: quoteBy ?? "" } : null,
    statistic: statValue || statLabel ? { value: statValue ?? "", label: statLabel ?? "" } : null,
    chart: readChart(answer.chart),
    table: readTable(answer.table),
    images: {},
    elements: {},
    sources: [],
    meta: { ...DEFAULT_META, sectionLabel: text.get("section_label") ?? null },
  };

  const query = typeof answer.image_query === "string" ? answer.image_query.trim() : "";
  const wantsImage = archetype.selection.supportsImage;
  return { slide, outcomes, imageQuery: wantsImage && query ? query : null };
}

/** Cut at a word boundary; a sentence ending mid-word reads as a bug. */
function fit(slot: TextSlotBudget, value: string): string {
  const text = value.trim();
  const limit = slot.budget.maximumCharacters;
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf(" ");
  return (boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).trimEnd();
}

/**
 * A chart is only drawn when its two halves agree.
 *
 * Four labels against three values is not a chart with a gap; it is a chart
 * where every bar after the third is labelled with the wrong thing. Dropping it
 * shows the design with an empty visual slot, which is a legible mistake.
 */
function readChart(raw: SampleAnswer["chart"]): SlideData["chart"] {
  if (!raw || !Array.isArray(raw.labels) || !Array.isArray(raw.values)) return null;
  const labels = raw.labels.map((label) => String(label).trim()).filter(Boolean);
  const values = raw.values.map(Number).filter((value) => Number.isFinite(value));
  if (labels.length < 2 || labels.length !== values.length) return null;
  const type = typeof raw.type === "string" && CHART_TYPES.has(raw.type) ? (raw.type as ChartType) : "bar";
  return { type, labels, values };
}

function readTable(raw: SampleAnswer["table"]): SlideData["table"] {
  if (!raw || !Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return null;
  const columns = raw.columns.map((column) => String(column).trim()).filter(Boolean);
  if (columns.length < 2) return null;
  const rows = raw.rows
    .filter(Array.isArray)
    .map((row) => (row as unknown[]).slice(0, columns.length).map((cell) => String(cell).trim()))
    // A short row would draw cells shifted left of their headers.
    .filter((row) => row.length === columns.length);
  return rows.length ? { columns, rows } : null;
}
