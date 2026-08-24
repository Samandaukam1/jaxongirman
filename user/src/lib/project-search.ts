/**
 * Matching what somebody typed against what they can see.
 *
 * Uzbek is written with four different apostrophes depending on the keyboard,
 * and somebody looking for "o‘quv" types whichever their phone gives them. A
 * search that respects the difference finds nothing and looks broken — which is
 * indistinguishable, from the outside, from having nothing to find.
 *
 * Pure, so the rule is testable without a database behind it.
 */

export type Searchable = { title: string; detail: string; kind: string };

export function normalise(value: string): string {
  return value
    .toLocaleLowerCase("uz")
    .replace(/[‘’'`\u02bb\u02bc]/g, "'")
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
