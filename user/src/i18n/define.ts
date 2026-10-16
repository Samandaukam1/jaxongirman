/**
 * One table of words per part of the app, in all three languages at once.
 *
 * The Uzbek table is the source; English and Russian must have exactly its
 * keys, so a missing translation is a type error rather than a gap someone
 * finds on screen. Plural keys follow i18next: `_one`, `_few`, `_many`,
 * `_other` — every language carries all four so the shapes match, and each
 * uses the ones its grammar needs.
 */
export type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };

export function translations<T extends Record<string, unknown>>(uz: T, en: Shape<T>, ru: Shape<T>) {
  return { uz, en, ru };
}
