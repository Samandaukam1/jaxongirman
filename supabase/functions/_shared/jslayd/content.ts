// GENERATED FILE — do not edit by hand.
// Source: packages/jslayd/src/content.ts
// Regenerate with: node supabase/scripts/build-jslayd-runtime.mjs
//
// The JSLAYD runtime, projected into the Edge tree. Edit the package, not this.

import type { ArchetypePurpose, Binding, Condition } from "./spec.ts";

/**
 * The content a slide carries into the renderer.
 *
 * This is the boundary between "what the deck says" and "what the design looks
 * like". The AI writer fills this; it never sees a coordinate, a colour or a
 * font (§43). Everything visual comes from the `.jslayd` document.
 */

export type ImageRef = { bucket: string; path: string } | { url: string };

export type ChartData = {
  type: "bar" | "horizontalBar" | "line" | "area" | "pie" | "doughnut" | "donut";
  labels: string[];
  values: number[];
};

export type TableData = {
  columns: string[];
  rows: string[][];
};

export type SlideData = {
  /** Zero-based position in the deck. */
  index: number;
  total: number;
  purpose: ArchetypePurpose;
  title: string;
  subtitle: string | null;
  body: string | null;
  bullets: string[];
  quote: { text: string; attribution: string } | null;
  statistic: { value: string; label: string } | null;
  chart: ChartData | null;
  table: TableData | null;
  /** Resolved pictures, keyed by the archetype's image slot id (§27). */
  images: Record<string, ImageRef | null>;
  sources: string[];
  meta: DeckMeta;
};

export type DeckMeta = {
  author: string | null;
  teacher: string | null;
  date: string | null;
  brand: string;
  sectionLabel: string | null;
};

export const DEFAULT_META: DeckMeta = {
  author: null,
  teacher: null,
  date: null,
  brand: "JAXONGIR AI",
  sectionLabel: null,
};

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * A binding's value, or null when the slide has nothing for it.
 *
 * The switch is exhaustive over the closed `Binding` union, which is what makes
 * "no arbitrary lookup" a compile-time property rather than a promise: there is
 * no path from a document string to an object property (§38, §39).
 */
export function resolveBinding(binding: Binding, slide: SlideData): string | null {
  switch (binding) {
    case "title": return clean(slide.title) || null;
    case "subtitle": return clean(slide.subtitle) || null;
    case "body": return clean(slide.body) || null;
    case "bullets": return slide.bullets.length ? slide.bullets.map(clean).filter(Boolean).join("\n") : null;
    case "purpose": return slide.purpose;
    case "section_label": return clean(slide.meta.sectionLabel) || null;
    case "author": return clean(slide.meta.author) || null;
    case "teacher": return clean(slide.meta.teacher) || null;
    case "date": return clean(slide.meta.date) || null;
    case "brand": return clean(slide.meta.brand) || null;
    case "page_number": return String(slide.index + 1);
    case "slide_count": return String(slide.total);
    case "quote_text": return slide.quote ? clean(slide.quote.text) || null : null;
    case "quote_attribution": return slide.quote ? clean(slide.quote.attribution) || null : null;
    case "stat_value": case "stat_1": return slide.statistic ? clean(slide.statistic.value) || null : null;
    case "stat_label": return slide.statistic ? clean(slide.statistic.label) || null : null;
    // A design may lay out three stat cards; a slide carries one figure, so the
    // extra slots stay empty and their elements drop out rather than repeat it.
    case "stat_2": case "stat_3": return null;
    case "chart_title": case "table_title": return clean(slide.title) || null;
    case "sources":
      return slide.sources.length
        ? slide.sources.map((source, position) => `${position + 1}. ${clean(source)}`).join("\n")
        : null;
    // Handled by their own element readers, never as text.
    case "chart_data": case "table_data": case "image_1": case "image_2": case "image_3":
      return null;
  }
}

/** Bullet items as a list, honouring the element's own cap. */
export function resolveBullets(slide: SlideData, maxItems: number): string[] {
  const items = slide.bullets.map(clean).filter(Boolean);
  if (items.length) return items.slice(0, maxItems);
  // A slide that wrote prose instead of bullets still deserves the list slot:
  // splitting on sentences keeps the composition rather than blanking it.
  const body = clean(slide.body);
  if (!body) return [];
  return body.split(/(?<=[.!?])\s+/).map(clean).filter(Boolean).slice(0, maxItems);
}

export function conditionHolds(condition: Condition, slide: SlideData): boolean {
  const hasImage = Object.values(slide.images).some(Boolean);
  switch (condition) {
    case "always": return true;
    case "hasImage": return hasImage;
    case "noImage": return !hasImage;
    case "hasStat": return Boolean(slide.statistic);
    case "hasChart": return Boolean(slide.chart && slide.chart.values.length > 0);
    case "hasTable": return Boolean(slide.table && slide.table.rows.length > 0);
    case "hasQuote": return Boolean(slide.quote);
    case "hasBullets": return slide.bullets.length > 0;
    case "hasBody": return Boolean(clean(slide.body));
    case "hasSubtitle": return Boolean(clean(slide.subtitle));
    case "hasSources": return slide.sources.length > 0;
  }
}

/** Total characters of prose on a slide — what archetype selection scores on. */
export function textVolume(slide: SlideData): number {
  return [
    clean(slide.title),
    clean(slide.subtitle),
    clean(slide.body),
    ...slide.bullets.map(clean),
    slide.quote ? clean(slide.quote.text) : "",
  ].reduce((sum, part) => sum + part.length, 0);
}

/** Deterministic sample content for admin previews and thumbnails (§62). */
export function previewSlide(purpose: ArchetypePurpose, index = 0, total = 8): SlideData {
  return {
    index,
    total,
    purpose,
    title: "G'oyangizni taqdimotga aylantiring",
    subtitle: "Jaxongir AI tomonidan tayyorlangan",
    body: "Namunaviy matn bloki shablon ritmini va matn zichligini ko'rsatadi.",
    bullets: [
      "Aniq tuzilma va o'qilishi oson iyerarxiya",
      "Mavzuga mos vizual yechim",
      "Amaliy xulosa va keyingi qadam",
    ],
    quote: { text: "Yaxshi dizayn — ko'rinmaydigan tartib.", attribution: "Dieter Rams" },
    statistic: { value: "68%", label: "auditoriya asosiy fikrni yaxshi eslab qoladi" },
    chart: { type: "doughnut", labels: ["Birinchi", "Ikkinchi", "Uchinchi"], values: [48, 32, 20] },
    table: {
      columns: ["Ko'rsatkich", "2023", "2024", "O'zgarish"],
      rows: [
        ["Foydalanuvchi", "12 400", "31 900", "+157%"],
        ["Taqdimot", "48 200", "126 700", "+163%"],
        ["O'rtacha ball", "72", "86", "+14"],
        ["Qaytish", "38%", "61%", "+23 p.p."],
      ],
    },
    images: {},
    sources: ["Jaxongir AI ichki tahlili, 2025", "O'zbekiston statistika qo'mitasi"],
    meta: { ...DEFAULT_META },
  };
}
