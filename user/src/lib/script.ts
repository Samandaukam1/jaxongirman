/**
 * Cyrillic in Uzbek text, found and turned into Latin on the phone.
 *
 * Uzbek decks are written in the Latin alphabet, so a topic typed in Cyrillic
 * is refused (the server refuses it too). Rather than leave the person to
 * retype it, `toLatin` spells it the way the official alphabet does — a fixed
 * table, no model and no network.
 */

const CYRILLIC = /[Ѐ-ӿԀ-ԯⷠ-ⷿꙀ-ꚟ]/;

/** Mirrors `has_cyrillic` in the database and `hasCyrillic` in the deck engine. */
export function hasCyrillic(text: string): boolean {
  return CYRILLIC.test(text);
}

const LETTERS: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ё: "yo", ж: "j", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "x", ч: "ch", ш: "sh", щ: "sh", ъ: "’", ы: "i", ь: "", э: "e", ю: "yu",
  я: "ya", ў: "o‘", қ: "q", ғ: "g‘", ҳ: "h",
};

const VOWELS = new Set("аеёиоуэюяўАЕЁИОУЭЮЯЎ");
const SEPARATORS = new Set("ъьЪЬ");

function isLetter(char: string | undefined): boolean {
  return Boolean(char && /\p{L}/u.test(char));
}

function isUpper(char: string | undefined): boolean {
  return Boolean(char && char !== char.toLowerCase());
}

/**
 * Uzbek Cyrillic spelled in Uzbek Latin.
 *
 * Two letters depend on where they stand: "е" is "ye" at the start of a word
 * and after a vowel or a separator sign, "e" elsewhere; "ц" is "s" at the start
 * of a word and "ts" after a vowel. A capital that becomes two letters stays a
 * capital only on the first (Ч → Ch) unless the word around it is in capitals
 * (ЧОРСУ → CHORSU). Anything that is not Cyrillic is kept as it was.
 */
export function toLatin(text: string): string {
  const chars = Array.from(text);
  let out = "";
  chars.forEach((char, index) => {
    const lower = char.toLowerCase();
    const before = chars[index - 1];
    const after = chars[index + 1];
    let latin: string | undefined;

    if (lower === "е") {
      latin = !isLetter(before) || VOWELS.has(before!) || SEPARATORS.has(before!) ? "ye" : "e";
    } else if (lower === "ц") {
      latin = before && VOWELS.has(before) ? "ts" : "s";
    } else {
      latin = LETTERS[lower];
    }

    if (latin === undefined) {
      out += char;
      return;
    }
    if (!isUpper(char) || latin === "" || latin === "’") {
      out += latin;
      return;
    }
    const shouting = isUpper(after) || (!isLetter(after) && isUpper(before));
    out += shouting ? latin.toUpperCase() : latin.charAt(0).toUpperCase() + latin.slice(1);
  });
  return out;
}
