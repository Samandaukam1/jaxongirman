import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The handful of typefaces this person actually uses.
 *
 * Two thousand families and no memory means finding the same font twice is the
 * same search twice. Kept on the device rather than the account: it is a
 * working habit, not a setting, and it costs a round trip nobody asked for.
 */

const KEY = "jaxongirman:recent-fonts";
const KEEP = 8;

export async function recentFonts(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/** Most recent first, no duplicates, and never more than `KEEP`. */
export function foldRecent(list: readonly string[], slug: string): string[] {
  return [slug, ...list.filter((entry) => entry !== slug)].slice(0, KEEP);
}

export async function rememberFont(slug: string): Promise<string[]> {
  const next = foldRecent(await recentFonts(), slug);
  try { await AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch { /* a nicety, not a feature */ }
  return next;
}
