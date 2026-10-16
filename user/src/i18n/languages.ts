/** The languages the app speaks. Uzbek (Latin) first: it is the default and the source of every table. */
export const APP_LANGUAGES = ["uz", "en", "ru"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

/** Each language named in itself, as a language picker should. */
export const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  uz: "O‘zbekcha",
  en: "English",
  ru: "Русский",
};

/** The locale formatting calls are given. */
export const LOCALES: Record<AppLanguage, string> = { uz: "uz-Latn-UZ", en: "en-US", ru: "ru-RU" };

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && (APP_LANGUAGES as readonly string[]).includes(value);
}
