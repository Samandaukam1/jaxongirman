/**
 * An Uzbek deck in the updated alphabet: O‘ → Ö, G‘ → Ğ, Sh → Ş, Ch → Ç.
 *
 * The model writes Uzbek in the current alphabet, which it knows far better,
 * and the words a reader sees are respelled here, once, before anything is
 * composed or saved — so the phone, the PDF and the PowerPoint all show the
 * same spelling. What a reader never sees is left alone: kinds, icons, source
 * numbers and the English searches the photographs are found with.
 */
import { toNewAlphabet } from "../alphabet.ts";
import type { DeckOutline, Side, SlideContent } from "./content.ts";
import type { DeckLanguage } from "./language.ts";

const spell = toNewAlphabet;

function side(value: Side | null): Side | null {
  return value ? { heading: spell(value.heading), points: value.points.map(spell) } : null;
}

export function spellSlide(slide: SlideContent, language: DeckLanguage): SlideContent {
  if (language !== "uz") return slide;
  return {
    ...slide,
    title: spell(slide.title),
    eyebrow: spell(slide.eyebrow),
    lead: spell(slide.lead),
    points: slide.points.map((point) => ({ ...point, title: spell(point.title), text: spell(point.text) })),
    stats: slide.stats.map((stat) => ({ value: spell(stat.value), label: spell(stat.label) })),
    quote: slide.quote ? { text: spell(slide.quote.text), author: spell(slide.quote.author) } : null,
    chart: slide.chart
      ? {
        ...slide.chart,
        labels: slide.chart.labels.map(spell),
        ...(slide.chart.names ? { names: slide.chart.names.map(spell) } : {}),
        unit: spell(slide.chart.unit),
        insight: spell(slide.chart.insight),
      }
      : null,
    left: side(slide.left),
    right: side(slide.right),
  };
}

export function spellOutline(outline: DeckOutline, language: DeckLanguage): DeckOutline {
  if (language !== "uz") return outline;
  return {
    ...outline,
    shortTitle: spell(outline.shortTitle),
    subtitle: spell(outline.subtitle),
    slides: outline.slides.map((entry) => ({ ...entry, title: spell(entry.title), focus: spell(entry.focus) })),
  };
}

/** A name or a topic the author typed, respelled for an Uzbek deck. */
export function spellText<T extends string | null | undefined>(text: T, language: DeckLanguage): T {
  return (language === "uz" && text ? spell(text) : text) as T;
}
