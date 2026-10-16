import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { APP_LANGUAGES, i18n, isAppLanguage, type AppLanguage } from "@/i18n";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

const STORAGE_KEY = "jx.language";

type LanguageState = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => Promise<void>;
  /** Languages the operator offers for the interface; Uzbek always. */
  uiLanguages: readonly AppLanguage[];
  /** Languages the operator offers for deck generation; Uzbek always. */
  deckLanguages: readonly AppLanguage[];
};

/** Reads one list from `i18n.languages`, keeping Uzbek and the known languages only. */
function offered(value: unknown): readonly AppLanguage[] {
  if (!Array.isArray(value)) return APP_LANGUAGES;
  const known = APP_LANGUAGES.filter((language) => language === "uz" || value.includes(language));
  return known;
}

const LanguageContext = createContext<LanguageState | null>(null);

/**
 * The language the app speaks.
 *
 * Remembered on the phone, so the first screen opens in it, and with the
 * account (`profiles.preferred_language`), so it follows the person to
 * another phone. The account's choice wins once they are signed in. Changing
 * it changes every screen at once — no sign-out, no restart.
 */
export function LanguageProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [language, setCurrent] = useState<AppLanguage>(isAppLanguage(i18n.language) ? i18n.language : "uz");
  const [settings, setSettings] = useState<{ ui: readonly AppLanguage[]; deck: readonly AppLanguage[] }>({ ui: APP_LANGUAGES, deck: APP_LANGUAGES });

  const apply = useCallback(async (next: AppLanguage) => {
    if (i18n.language !== next) await i18n.changeLanguage(next);
    setCurrent(next);
  }, []);

  // The phone's memory first: the first screen should not flash in Uzbek.
  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (isAppLanguage(stored)) void apply(stored);
    }).catch(() => {});
  }, [apply]);

  // Which languages the operator offers (Tillar va tarjimalar). Everything is
  // offered until the setting answers, and if it never does.
  useEffect(() => {
    let active = true;
    void supabase.from("app_settings").select("value").eq("key", "i18n.languages").maybeSingle().then(({ data }) => {
      const value = (data?.value ?? null) as { ui?: unknown; deck?: unknown } | null;
      if (active && value) setSettings({ ui: offered(value.ui), deck: offered(value.deck) });
    });
    return () => { active = false; };
  }, []);

  // Then the account's choice, which follows the person between phones.
  useEffect(() => {
    if (!user) return;
    let active = true;
    void supabase.from("profiles").select("preferred_language").eq("id", user.id).maybeSingle().then(({ data }) => {
      const chosen = (data as { preferred_language?: string } | null)?.preferred_language;
      if (active && isAppLanguage(chosen)) {
        void apply(chosen);
        void AsyncStorage.setItem(STORAGE_KEY, chosen).catch(() => {});
      }
    });
    return () => { active = false; };
  }, [apply, user]);

  const setLanguage = useCallback(async (next: AppLanguage) => {
    await apply(next);
    await AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    if (user) {
      await supabase.from("profiles").update({ preferred_language: next }).eq("id", user.id);
    }
  }, [apply, user]);

  const value = useMemo(
    () => ({ language, setLanguage, uiLanguages: settings.ui, deckLanguages: settings.deck }),
    [language, setLanguage, settings],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageState {
  const state = useContext(LanguageContext);
  if (!state) throw new Error("useLanguage must be used inside LanguageProvider");
  return state;
}
