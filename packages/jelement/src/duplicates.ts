import type { JElement } from "./document.ts";
import { normalizeTerm } from "./spec.ts";

/**
 * Finding the element that already exists.
 *
 * An analyzer asked to extend a family will produce siblings that overlap what
 * is there — "wheel loader" when the family already has a "mining loader" — and
 * the two are the same object under different names. Two of them make the
 * library worse than one: a query matches both, neither is the answer, and the
 * planner picks whichever sorted first.
 *
 * Deliberately not clever. This finds names and aliases that genuinely refer to
 * the same thing, and says so with the evidence; it does not attempt to judge
 * meaning. A false positive costs an admin one click; a false negative costs the
 * library a duplicate forever, so the bar is set to catch the obvious cases
 * loudly rather than the subtle ones quietly.
 */

export type DuplicateMatch = {
  /** The incoming element. */
  candidate: string;
  /** What it collides with. */
  existing: string;
  /** 0–1. Only reported above the threshold. */
  confidence: number;
  reason: string;
};

/** Every way an element answers to a name, normalised. */
function namesOf(element: Pick<JElement, "canonicalName" | "semantic">): Set<string> {
  const names = new Set<string>([normalizeTerm(element.canonicalName)]);
  for (const group of [
    element.semantic.aliases,
    element.semantic.uzbekTerms,
    element.semantic.englishTerms,
    element.semantic.russianTerms,
  ]) {
    for (const term of group) {
      const normalized = normalizeTerm(term);
      if (normalized) names.add(normalized);
    }
  }
  return names;
}

const FILLER = new Set(["the", "a", "an", "of", "for", "va", "bilan", "uchun"]);

function wordsOf(name: string): string[] {
  return normalizeTerm(name).split(" ").filter((word) => word.length > 1 && !FILLER.has(word));
}

/**
 * How likely two names are the same object.
 *
 * Counting shared words does not work, and the reason is worth stating: "wheel
 * loader" against "mining loader" and "mining drill" against "mining loader"
 * both share exactly one word of two. One pair is probably one object and the
 * other is certainly two.
 *
 * What separates them is *which* word is shared. The last word is the thing
 * itself — loader, drill, truck — and the ones before it qualify it. Two names
 * ending in the same noun are candidates; two names ending in different nouns
 * are different objects however much else they share.
 *
 * English and Uzbek both put the head last (`aniqlovchi` before `aniqlanmish`),
 * which is why one rule covers the two languages this library is used in.
 */
function similarity(first: readonly string[], second: readonly string[]): number {
  if (first.length === 0 || second.length === 0) return 0;

  const headFirst = first[first.length - 1]!;
  const headSecond = second[second.length - 1]!;
  if (headFirst !== headSecond) return 0;

  // Same thing. How close depends on how much the qualifiers agree — none in
  // common still counts, because the noun is the stronger signal.
  const qualifiersFirst = first.slice(0, -1);
  const qualifiersSecond = second.slice(0, -1);
  if (qualifiersFirst.length === 0 && qualifiersSecond.length === 0) return 0.95;

  const set = new Set(qualifiersSecond);
  const shared = qualifiersFirst.filter((word) => set.has(word)).length;
  const denominator = Math.max(qualifiersFirst.length, qualifiersSecond.length, 1);
  return 0.6 + 0.35 * (shared / denominator);
}

/**
 * Compares one incoming element against what a family already holds.
 *
 * Three signals, strongest first: the same name, a name one of them already
 * answers to, and a name made of mostly the same words. The first two are
 * certainties and the third is a question worth asking.
 */
export function findDuplicates(
  incoming: readonly Pick<JElement, "canonicalName" | "semantic">[],
  existing: readonly Pick<JElement, "canonicalName" | "semantic">[],
  options: { threshold?: number } = {},
): DuplicateMatch[] {
  const threshold = options.threshold ?? 0.6;
  const matches: DuplicateMatch[] = [];

  for (const candidate of incoming) {
    const candidateNames = namesOf(candidate);
    const candidateWords = wordsOf(candidate.canonicalName);

    let best: DuplicateMatch | null = null;

    for (const other of existing) {
      const otherNames = namesOf(other);

      // The same name. Not a judgement call.
      if (normalizeTerm(candidate.canonicalName) === normalizeTerm(other.canonicalName)) {
        best = {
          candidate: candidate.canonicalName, existing: other.canonicalName,
          confidence: 1, reason: "Bir xil nom.",
        };
        break;
      }

      // One already answers to the other's name, which is what a rename looks
      // like from the outside.
      const shared = [...candidateNames].filter((name) => otherNames.has(name));
      if (shared.length > 0) {
        const match: DuplicateMatch = {
          candidate: candidate.canonicalName, existing: other.canonicalName,
          confidence: 0.9,
          reason: `Ikkalasi ham «${shared[0]}» nomiga javob beradi.`,
        };
        if (!best || match.confidence > best.confidence) best = match;
        continue;
      }

      // Mostly the same words. A question, not a verdict.
      const score = similarity(candidateWords, wordsOf(other.canonicalName));
      if (score >= threshold) {
        const match: DuplicateMatch = {
          candidate: candidate.canonicalName, existing: other.canonicalName,
          confidence: score,
          reason: `Ikkalasi ham «${candidateWords[candidateWords.length - 1]}» — bir xil narsa bo'lishi mumkin.`,
        };
        if (!best || match.confidence > best.confidence) best = match;
      }
    }

    if (best) matches.push(best);
  }

  return matches.sort((first, second) => second.confidence - first.confidence);
}

/** Two elements inside one specification that collide with each other. */
export function findInternalDuplicates(
  elements: readonly Pick<JElement, "canonicalName" | "semantic">[],
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (let index = 1; index < elements.length; index += 1) {
    matches.push(...findDuplicates([elements[index]!], elements.slice(0, index)));
  }
  return matches;
}
