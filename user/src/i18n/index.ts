import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import { deepNewAlphabet, toNewAlphabet } from "../lib/alphabet";
import { NAMESPACES, resources } from "./resources";

/**
 * The app's words in four languages, from static tables bundled with the
 * app — no network and no model is ever asked to translate an interface.
 * Uzbek (Latin) is the default and the fallback.
 *
 * The Uzbek tables are written in the current Latin alphabet and shown in the
 * updated one (O‘ → Ö, G‘ → Ğ, Sh → Ş, Ch → Ç): they are converted once, here,
 * so every screen gets the same spelling and the tables stay easy to edit.
 */
const i18n = createInstance();
void i18n.use(initReactI18next).init({
  resources: { ...resources, uz: deepNewAlphabet(resources.uz) },
  lng: "uz",
  fallbackLng: "uz",
  ns: NAMESPACES,
  defaultNS: "common",
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
});

export { i18n };

/**
 * Words that arrive from the server — an admin's category name, a
 * notification — shown as the rest of the interface is: in the updated
 * alphabet when the app speaks Uzbek, untouched otherwise.
 */
export function readerSpelling(text: string): string {
  return i18n.language === "uz" ? toNewAlphabet(text) : text;
}
export { APP_LANGUAGES, LANGUAGE_NAMES, LOCALES, isAppLanguage, type AppLanguage } from "./languages";
