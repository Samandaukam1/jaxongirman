/**
 * Matching what somebody typed against what they can see.
 *
 * Uzbek is written with four different apostrophes depending on the keyboard,
 * and in two alphabets: the app shows the updated one (Öquv, Şahar), older
 * titles carry the current one (O‘quv, Shahar), and somebody looking for either
 * types whatever their phone gives them — "o'quv", "oquv", "öquv". A search
 * that respects the difference finds nothing and looks broken — which is
 * indistinguishable, from the outside, from having nothing to find. So both
 * sides are folded to plain letters: ö and o‘ to o, ğ and g‘ to g, ş and sh to
 * s, ç and ch to c.
 *
 * Pure, so the rule is testable without a database behind it.
 */

export type Searchable = { title: string; detail: string; kind: string };

export function normalise(value: string): string {
  return value
    .toLocaleLowerCase("uz")
    .replace(/[‘’'`\u02bb\u02bc]/g, "'")
    .replace(/([og])'/g, "$1")
    .replace(/sh/g, "s")
    .replace(/ch/g, "c")
    .replace(/[öğşç]/g, (letter) => ({ ö: "o", ğ: "g", ş: "s", ç: "c" })[letter] ?? letter)
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word has to appear somewhere, in any order. */
export function searchProjects<T extends Searchable>(projects: readonly T[], query: string): T[] {
  const wanted = normalise(query);
  if (!wanted) return [...projects];
  const words = wanted.split(" ");
  return projects.filter((project) => {
    const haystack = normalise(`${project.title} ${project.detail} ${project.kind}`);
    return words.every((word) => haystack.includes(word));
  });
}
