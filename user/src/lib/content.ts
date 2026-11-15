import { i18n } from "../i18n";
import { toNewAlphabet } from "./alphabet";

/**
 * Words an operator wrote, in the app's language.
 *
 * Plan names, coin packages, material types and the policy texts carry their
 * other languages beside the Uzbek source (`*_i18n` objects, edited in the
 * console's "Tillar va tarjimalar"). A language nobody has written yet falls
 * back to the Uzbek source. Uzbek is shown in the updated alphabet (O‘ → Ö,
 * G‘ → Ğ, Sh → Ş, Ch → Ç), like the rest of the interface, whichever alphabet
 * the operator typed it in.
 */
export function localized(source: string | null | undefined, translations: unknown, language: string = i18n.language): string {
  const own = pick(translations, language);
  if (own) return language === "uz" ? toNewAlphabet(own) : own;
  return toNewAlphabet(source ?? "");
}

/**
 * The same, but with the app's own word as the fallback outside Uzbek — for a
 * button an operator may have labelled in Uzbek only, where the app's own
 * translated label reads better than an untranslated one.
 */
export function localizedOr(source: string | null | undefined, translations: unknown, fallback: string, language: string = i18n.language): string {
  const own = pick(translations, language);
  if (own) return language === "uz" ? toNewAlphabet(own) : own;
  return language === "uz" && source ? toNewAlphabet(source) : fallback;
}

function pick(translations: unknown, language: string): string | null {
  if (!translations || typeof translations !== "object") return null;
  const value = (translations as Record<string, unknown>)[language];
  return typeof value === "string" && value.trim() ? value : null;
}
