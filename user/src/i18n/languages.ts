/** The languages the app speaks. Uzbek (Latin) first: it is the default and the source of every table. */
export const APP_LANGUAGES = ["uz", "en", "ru", "tr"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

/** Each language named in itself, as a language picker should. */
export const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  uz: "Özbekça",
  en: "English",
  ru: "Русский",
  tr: "Türkçe",
};

/** The locale formatting calls are given. */
export const LOCALES: Record<AppLanguage, string> = { uz: "uz-Latn-UZ", en: "en-US", ru: "ru-RU", tr: "tr-TR" };

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && (APP_LANGUAGES as readonly string[]).includes(value);
}
