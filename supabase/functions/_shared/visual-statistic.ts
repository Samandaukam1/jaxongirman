/**
 * The minimum visual evidence every generated presentation carries.
 *
 * A prompt that says "use a chart where useful" is a preference, not a
 * guarantee: an otherwise healthy model can return eight text slides and the
 * renderer quite correctly draws no chart. The product requirement is
 * stronger — every generated PowerPoint must contain at least one visible
 * statistical comparison — so the outline is normalised deterministically
 * before layout selection and the written data is validated again before it
 * reaches the database.
 *
 * Pure on purpose. Planning and validation can be unit-tested without a model,
 * Supabase or Deno, and the pipeline remains the only caller that mutates
 * production state.
 */

export type VisualStatistic = {
  type: "bar" | "donut";
  labels: string[];
  values: number[];
};

export type OutlineLike = {
  title: string;
  purpose: string;
  layout: string;
  [key: string]: unknown;
};

const NUMERIC_WORDS = /\b(raqam|statistik|foiz|ulush|nisbat|dinamik|o['‘’ʻʼ]?sish|kamay|taqqos|natija|ko['‘’ʻʼ]?rsatkich)\b/iu;

/**
 * Makes one content slide explicitly responsible for the deck's chart.
 *
 * Existing chart intent wins. Otherwise a statistic/numeric slide is the most
 * semantically honest candidate; only when the outline has none do we choose a
 * middle slide, away from the opening definition and closing conclusion. The
 * title is preserved and the purpose is extended, so no narrative idea is
 * silently discarded.
 */
export function requireVisualStatistic<T extends OutlineLike>(slides: readonly T[]): T[] {
  const copied = slides.map((slide) => ({ ...slide })) as T[];
  if (copied.length === 0 || copied.some((slide) => slide.layout === "chart")) return copied;

  let index = copied.findIndex((slide) =>
    slide.layout === "statistic" || NUMERIC_WORDS.test(`${slide.title} ${slide.purpose}`));

  if (index < 0) {
    index = copied.length < 3
      ? copied.length - 1
      : Math.max(1, Math.min(copied.length - 2, Math.floor(copied.length * 0.6)));
  }

  const selected = copied[index]!;
  copied[index] = {
    ...selected,
    layout: "chart",
    purpose: `${selected.purpose.replace(/[.\s]+$/u, "")}. `
      + "Tekshirilgan 2–8 ta o‘zaro taqqoslanadigan raqamni bar yoki doira diagrammasida ko‘rsatish.",
  };
  return copied;
}

/** True only for data a bar or pie/donut chart can actually draw. */
export function isVisualStatistic(value: unknown): value is VisualStatistic {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const chart = value as Partial<VisualStatistic>;
  if (chart.type !== "bar" && chart.type !== "donut") return false;
  if (!Array.isArray(chart.labels) || !Array.isArray(chart.values)) return false;
  if (chart.labels.length < 2 || chart.labels.length > 8 || chart.labels.length !== chart.values.length) return false;
  if (!chart.labels.every((label) => typeof label === "string" && label.trim().length > 0)) return false;
  if (!chart.values.every((number) => typeof number === "number" && Number.isFinite(number))) return false;
  // A donut represents parts of a whole; negative or all-zero parts have no
  // geometric meaning. Bars may legitimately show a negative change.
  if (chart.type === "donut" && (chart.values.some((number) => number < 0) || chart.values.every((number) => number === 0))) return false;
  return true;
}

export function deckHasVisualStatistic(slides: readonly { chart?: unknown }[]): boolean {
  return slides.some((slide) => isVisualStatistic(slide.chart));
}

/**
 * Two charts in a row should not be the same chart.
 *
 * The writer picks a type per slide with no memory of the one before it, so a
 * deck that earns two charts usually draws two bars — the same shape, the same
 * colours, one slide apart, which reads as a rendering mistake rather than as
 * two findings. A bar next to a doughnut reads as two findings.
 *
 * Only the type is changed, never the numbers, and only when the data suits
 * the other form: a doughnut is parts of a whole, so a series containing a
 * negative or summing to nothing stays a bar. That means a deck can still
 * legitimately carry two bars — when every alternative would misrepresent the
 * figures, which is the one thing worse than a repeated shape.
 */
export function diversifyChartTypes<T extends { chart?: unknown }>(slides: readonly T[]): T[] {
  let previous: VisualStatistic["type"] | null = null;
  return slides.map((slide) => {
    if (!isVisualStatistic(slide.chart)) return slide;
    const chart = slide.chart;
    if (previous !== chart.type) {
      previous = chart.type;
      return slide;
    }
    const flipped = { ...chart, type: chart.type === "bar" ? "donut" as const : "bar" as const };
    if (!isVisualStatistic(flipped)) {
      // The numbers cannot be drawn the other way. A repeat is the honest
      // answer; misrepresenting them is not.
      previous = chart.type;
      return slide;
    }
    previous = flipped.type;
    return { ...slide, chart: flipped };
  });
}
