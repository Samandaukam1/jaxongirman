/**
 * Uzbek Latin in the updated alphabet: O‘ → Ö, G‘ → Ğ, Sh → Ş, Ch → Ç.
 *
 * Jaxongirman speaks Uzbek in the updated Latin alphabet — the interface and
 * everything it makes. The words are still written (and models still write
 * them) in the current one, so the swap happens here, on the way to the screen
 * or the file: a fixed table, no model and no network.
 *
 * What it leaves alone:
 * - `{{placeholders}}`, `<tags>`, `$t(…)`, links, e-mail addresses and
 *   @usernames;
 * - words that are plainly not Uzbek: a "w", a "c" that is not part of "ch",
 *   a pair Uzbek never writes (th, ph, ck, ee, oo, ou, sch, a leading chr), a
 *   capital inside the word (PowerPoint, ChatGPT), or a letter Uzbek does not
 *   have (é, ü, a Cyrillic letter…);
 * - the tutuq belgisi (ma’lumot, san’at): only the o and g marks change;
 * - a quote around a word ('ming' keeps its g), and an English possessive
 *   (Google's);
 *
 * Text already in the updated alphabet comes back as it went in, so running
 * it twice is the same as running it once.
 *
 * This file is copied byte for byte to supabase/functions/_shared/alphabet.ts,
 * and a test keeps the two copies the same.
 */

/** Every mark people type after o and g: ‘ ʻ ' ’ ` ʼ */
const MARKS = "‘ʻ'’`ʼ";
const LEADING = new RegExp(`^[${MARKS}]+`);
const PROTECTED = /\{\{[^}]*\}\}|<[^>]*>|\$t\([^)]*\)|https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|@[A-Za-z0-9_.]+/g;
const WORD = new RegExp(`[\\p{L}${MARKS}]+`, "gu");
const NOT_UZBEK = new RegExp(`[wW]|[cC](?![hH])|\\p{Ll}\\p{Lu}|[^A-Za-zÖĞŞÇöğşç${MARKS}]`, "u");
const NOT_UZBEK_PAIRS = /th|ph|ck|ee|oo|ou|sch|^chr/i;
// An English possessive ("Google's") is not an Uzbek o‘ or g‘; "o‘sish" still is.
const O_MARK = new RegExp(`([oO])[${MARKS}](?=\\p{L})(?!s\\b)`, "gu");
const G_MARK = new RegExp(`([gG])[${MARKS}](?!s\\b)`, "g");

function isForeign(word: string): boolean {
  return NOT_UZBEK.test(word) || NOT_UZBEK_PAIRS.test(word);
}

function swap(word: string): string {
  return word
    .replace(O_MARK, (_, o: string) => (o === "O" ? "Ö" : "ö"))
    .replace(G_MARK, (_, g: string) => (g === "G" ? "Ğ" : "ğ"))
    .replace(/([sS])[hH]/g, (_, s: string) => (s === "S" ? "Ş" : "ş"))
    .replace(/([cC])[hH]/g, (_, c: string) => (c === "C" ? "Ç" : "ç"));
}

function convertWord(token: string): string {
  // A mark before a word is an opening quote, so a mark at its end closes it.
  const lead = LEADING.exec(token)?.[0] ?? "";
  let core = token.slice(lead.length);
  let tail = "";
  if (lead && core.length > 1 && MARKS.includes(core.slice(-1))) {
    tail = core.slice(-1);
    core = core.slice(0, -1);
  }
  if (!core || isForeign(core)) return token;
  return lead + swap(core) + tail;
}

function convertWords(text: string): string {
  return text.replace(WORD, convertWord);
}

/** Uzbek text in the updated Latin alphabet. Anything that is not Uzbek Latin is kept as it was. */
export function toNewAlphabet(text: string): string {
  if (!text) return text;
  let out = "";
  let last = 0;
  for (const match of text.matchAll(PROTECTED)) {
    const at = match.index ?? 0;
    out += convertWords(text.slice(last, at)) + match[0];
    last = at + match[0].length;
  }
  return out + convertWords(text.slice(last));
}

/** Every string inside a value (objects and arrays, however deep) in the updated alphabet; keys are kept. */
export function deepNewAlphabet<T>(value: T): T {
  if (typeof value === "string") return toNewAlphabet(value) as T;
  if (Array.isArray(value)) return value.map((item) => deepNewAlphabet(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, deepNewAlphabet(item)]),
    ) as T;
  }
  return value;
}
