import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import { NAMESPACES, resources } from "./resources";

/**
 * The app's words in three languages, from static tables bundled with the
 * app — no network and no model is ever asked to translate an interface.
 * Uzbek (Latin) is the default and the fallback.
 */
const i18n = createInstance();
void i18n.use(initReactI18next).init({
  resources,
  lng: "uz",
  fallbackLng: "uz",
  ns: NAMESPACES,
  defaultNS: "common",
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
});

export { i18n };
export { APP_LANGUAGES, LANGUAGE_NAMES, LOCALES, isAppLanguage, type AppLanguage } from "./languages";
