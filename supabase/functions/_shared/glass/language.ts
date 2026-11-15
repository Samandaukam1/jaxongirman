/**
 * The language a deck is written in — separate from the language of the app
 * that ordered it: a person may use the app in Russian and make a deck in
 * English.
 *
 * Choosing one costs nothing extra: the prompts stay as they are and gain one
 * line saying which language to answer in; there is no translation pass. What
 * the server sets itself — the agenda's heading, the thanks, the labels on the
 * cover — comes from the table below, and numbers are written the language's
 * way. A Russian deck is set only in faces that draw every Russian letter.
 */

import { CYRILLIC_FAMILIES } from "./metrics.ts";

export const DECK_LANGUAGES = ["uz", "en", "ru", "tr"] as const;
export type DeckLanguage = (typeof DECK_LANGUAGES)[number];

export function isDeckLanguage(value: unknown): value is DeckLanguage {
  return typeof value === "string" && (DECK_LANGUAGES as readonly string[]).includes(value);
}

/** The one line every writing prompt ends with. */
export const ANSWER_IN: Record<DeckLanguage, string> = {
  uz: "Hammasini o‘zbek lotin yozuvida, o‘ va g‘ harflari bilan yozing.",
  en: "Write every word of the slides in English (the instructions above are in Uzbek; the answer is not).",
  ru: "Весь текст слайдов пишите на русском языке, кириллицей (инструкции выше на узбекском, ответ — нет).",
  tr: "Write every word of the slides in Turkish, with correct Turkish letters (ç ğ ı İ ö ş ü) (the instructions above are in Uzbek; the answer is not).",
};

export const SYSTEM_PROMPT: Record<DeckLanguage, string> = {
  uz: "Siz Jaxongir AI — akademik taqdimotlar bo‘yicha katta strateg va muharrirsiz. Faqat berilgan sxemada, o‘zbek lotin yozuvida javob bering. Faktlarni uydirmang.",
  en: "Siz Jaxongir AI — akademik taqdimotlar bo‘yicha katta strateg va muharrirsiz. Faqat berilgan sxemada javob bering. Javob matni INGLIZ tilida bo‘lsin. Faktlarni uydirmang.",
  ru: "Siz Jaxongir AI — akademik taqdimotlar bo‘yicha katta strateg va muharrirsiz. Faqat berilgan sxemada javob bering. Javob matni RUS tilida, kirill yozuvida bo‘lsin. Faktlarni uydirmang.",
  tr: "Siz Jaxongir AI — akademik taqdimotlar bo‘yicha katta strateg va muharrirsiz. Faqat berilgan sxemada javob bering. Javob matni TURK tilida bo‘lsin. Faktlarni uydirmang.",
};

/** How the research notes are asked to be written. */
export const RESEARCH_IN: Record<DeckLanguage, string> = {
  uz: "Uzbek Latin script",
  en: "English",
  ru: "Russian (Cyrillic)",
  tr: "Turkish",
};

export type Chrome = {
  deck: string;
  agenda: string;
  agendaEyebrow: string;
  sections: (count: number) => string;
  references: string;
  referencesEyebrow: string;
  referencesFallback: string;
  thanks: string;
  thanksTitle: string;
  closingEyebrow: string;
  author: string;
  teacher: string;
  keyPoint: string;
  /** Before a page's own sources at its foot: "Manba: …". */
  source: string;
  decimal: string;
};

/** Words the server sets on a deck itself, in the deck's language. */
/**
 * The words around a deck's own: headers, footers, the closing page. Uzbek is
 * set in the updated Latin alphabet (O‘ → Ö, G‘ → Ğ, Sh → Ş, Ch → Ç), the same
 * as the slides' words once `spellSlide` has respelled them.
 */
export const CHROME: Record<DeckLanguage, Chrome> = {
  uz: {
    deck: "Taqdimot",
    agenda: "Mavzular rejasi",
    agendaEyebrow: "REJA",
    sections: (count) => `${count} ta asosiy bölim`,
    references: "Foydalanilgan adabiyotlar",
    referencesEyebrow: "Manbalar",
    referencesFallback: "Taqdimot oçiq ilmiy va rasmiy manbalar asosida tayyorlandi.",
    thanks: "E’tiboringiz uçun rahmat!",
    thanksTitle: "E’tiboringiz uçun rahmat",
    closingEyebrow: "Yakun",
    author: "Tayyorladi",
    teacher: "Öqituvçi",
    keyPoint: "Asosiy fikr",
    source: "Manba",
    decimal: ",",
  },
  en: {
    deck: "Presentation",
    agenda: "Agenda",
    agendaEyebrow: "AGENDA",
    sections: (count) => `${count} ${count === 1 ? "section" : "sections"}`,
    references: "References",
    referencesEyebrow: "Sources",
    referencesFallback: "This presentation draws on open scholarly and official sources.",
    thanks: "Thank you for your attention!",
    thanksTitle: "Thank you for your attention",
    closingEyebrow: "Closing",
    author: "Prepared by",
    teacher: "Supervisor",
    keyPoint: "Key idea",
    source: "Source",
    decimal: ".",
  },
  ru: {
    deck: "Презентация",
    agenda: "План",
    agendaEyebrow: "ПЛАН",
    sections: (count) => `${count} ${russianPlural(count, "основной раздел", "основных раздела", "основных разделов")}`,
    references: "Список литературы",
    referencesEyebrow: "Источники",
    referencesFallback: "Презентация подготовлена на основе открытых научных и официальных источников.",
    thanks: "Спасибо за внимание!",
    thanksTitle: "Спасибо за внимание",
    closingEyebrow: "Завершение",
    author: "Подготовил(а)",
    teacher: "Преподаватель",
    keyPoint: "Главная мысль",
    source: "Источник",
    decimal: ",",
  },
  tr: {
    deck: "Sunum",
    agenda: "Gündem",
    agendaEyebrow: "GÜNDEM",
    sections: (count) => `${count} ana bölüm`,
    references: "Kaynakça",
    referencesEyebrow: "Kaynaklar",
    referencesFallback: "Bu sunum açık bilimsel ve resmî kaynaklara dayanılarak hazırlandı.",
    thanks: "Dinlediğiniz için teşekkürler!",
    thanksTitle: "Dinlediğiniz için teşekkürler",
    closingEyebrow: "Kapanış",
    author: "Hazırlayan",
    teacher: "Danışman",
    keyPoint: "Ana fikir",
    source: "Kaynak",
    decimal: ",",
  },
};

function russianPlural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}

/** A number as the deck's language writes it: a decimal comma in Uzbek and Russian, a point in English. */
export function deckNumber(value: number, language: DeckLanguage): string {
  return String(Math.round(value * 100) / 100).replace(".", CHROME[language].decimal);
}

/**
 * Faces that do not draw Ğ ğ Ş ş (or İ), which Uzbek in the updated alphabet
 * and Turkish need.
 * Checked against the font files (font-library/fonts-main) on 2026-11-15: of
 * the faces in METRICS, only Prata lacks them (it has Ö and Ç but no Turkish
 * letters). A renderer asked for a missing letter borrows it from another
 * face, which is exactly the patchwork a deck must not show.
 */
const WITHOUT_UZBEK_LETTERS: ReadonlySet<string> = new Set(["Prata"]);

/**
 * Wraps a face check so a deck only ever picks faces that draw its letters:
 * every Russian letter for a Russian deck, Ö Ğ Ş Ç for an Uzbek or Turkish one.
 */
export function facesFor(language: DeckLanguage, available: (family: string, weight: number) => boolean) {
  if (language === "ru") return (family: string, weight: number) => CYRILLIC_FAMILIES.has(family) && available(family, weight);
  if (language === "uz" || language === "tr") return (family: string, weight: number) => !WITHOUT_UZBEK_LETTERS.has(family) && available(family, weight);
  return available;
}

/**
 * Whether a piece of text holds Cyrillic letters (Russian, Uzbek Cyrillic and
 * the rest of the block): an Uzbek Latin deck refuses a topic written in them.
 */
export function hasCyrillic(text: string): boolean {
  return /[Ѐ-ӿԀ-ԯⷠ-ⷿꙀ-ꚟ]/.test(text);
}
