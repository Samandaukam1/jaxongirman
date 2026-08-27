/**
 * Deciding whether a Wikidata item really is the person that was asked for.
 *
 * The rule this exists to enforce: a deck about Sherzodxon Qudratxo'ja must
 * never show a photograph of somebody else. Searching Commons by name cannot
 * give that guarantee — its index answers "Sherzodxon Qudratxo'ja" with a
 * comedy premiere and two files whose titles are in Cyrillic, and title
 * matching either takes the wrong one or finds nothing.
 *
 * So identity is established before a picture is chosen: the entity is looked
 * up, its label is checked against the name that was asked for, and only then
 * is the picture *that entity records as itself* used. The evidence is the
 * entity's own statement, not a resemblance.
 *
 * Pure, so every rule below is testable without a network.
 */

/**
 * Uzbek Latin writes the same name several ways.
 *
 * `Qudratxo'ja`, `Qudratxo'ja` and `Qudratxoʻja` are one surname typed on three
 * keyboards. A comparison that treats them as different names rejects the right
 * person; one that ignores letters entirely accepts the wrong one.
 */
export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    // Every apostrophe-ish mark becomes the same mark, then goes away: it is a
    // typing choice rather than part of the name.
    .replace(/[‘’ʻʼ′'`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The parts of a name worth matching on: initials and particles are not. */
export function nameParts(value: string): string[] {
  const skip = new Set(["oglu", "ogli", "qizi", "bin", "ibn", "van", "de", "al", "haqida", "hayoti", "ijodi"]);
  return normaliseName(value)
    .split(" ")
    .filter((part) => part.length >= 3 && !skip.has(part));
}

/**
 * Wikidata's own item, in the parts identity is judged on.
 *
 * `instanceOf` matters as much as the label: "Alisher Navoiy" is a poet, a
 * film and a listed building, and only one of them has a face.
 */
export type EntityFacts = {
  id: string;
  labels: readonly string[];
  aliases: readonly string[];
  /** Q-ids from P31. A person is `Q5`. */
  instanceOf: readonly string[];
  /** The file name from P18, without the `File:` prefix. */
  image: string | null;
  description?: string;
};

/** `Q5` is human. Nothing else is a person, whatever its label says. */
export const HUMAN = "Q5";

export type Verdict =
  | { ok: true; reason: "label_exact" | "label_all_parts" }
  | { ok: false; reason: "not_human" | "no_image" | "name_mismatch" };

/**
 * Is this item the person that was asked for, and does it carry their picture?
 *
 * Every part of the requested name has to appear in one of the item's own
 * names. That is stricter than a similarity score and deliberately so:
 * "Sherzodxon Qudratxo'ja" must not match "Sherzod Qudratov" because two of
 * three parts happen to line up. Precision matters more than recall here —
 * a missing picture is a slide; the wrong face is a different person's life.
 */
export function verifyPerson(entity: EntityFacts, requested: string): Verdict {
  if (!entity.instanceOf.includes(HUMAN)) return { ok: false, reason: "not_human" };
  if (!entity.image) return { ok: false, reason: "no_image" };

  const wanted = nameParts(requested);
  if (wanted.length === 0) return { ok: false, reason: "name_mismatch" };

  const names = [...entity.labels, ...entity.aliases].map(normaliseName).filter(Boolean);
  if (names.some((name) => name === normaliseName(requested))) return { ok: true, reason: "label_exact" };

  // Every part, in one single name — not scattered across an alias each.
  // "Alisher" in one alias and "Navoiy" in another is two people's names
  // sharing an item, which happens on merged entries.
  const carries = names.some((name) => {
    const parts = name.split(" ");
    return wanted.every((part) => parts.some((word) => word === part || word.startsWith(part) || part.startsWith(word)));
  });

  return carries ? { ok: true, reason: "label_all_parts" } : { ok: false, reason: "name_mismatch" };
}

/**
 * The best candidate among several items with the same name.
 *
 * Wikidata answers "Alisher Navoiy" with the poet, a film named after him and
 * a listed building. The verdict filters those out; where more than one person
 * survives, the earliest-created item wins, because a lower Q-number is the
 * older and better-described entry rather than a later duplicate.
 */
export function chooseEntity(entities: readonly EntityFacts[], requested: string): EntityFacts | null {
  const passing = entities
    .map((entity) => ({ entity, verdict: verifyPerson(entity, requested) }))
    .filter((row) => row.verdict.ok);
  if (passing.length === 0) return null;

  const exact = passing.filter((row) => row.verdict.ok && row.verdict.reason === "label_exact");
  const pool = exact.length > 0 ? exact : passing;

  return pool
    .slice()
    .sort((first, second) => numberOf(first.entity.id) - numberOf(second.entity.id))[0]!.entity;
}

const numberOf = (id: string): number => Number(id.replace(/^Q/i, "")) || Number.MAX_SAFE_INTEGER;
