/**
 * What to ask a photo index for.
 *
 * Separated from the provider because the provider does network and storage,
 * and this is the part worth testing: a query built out of style words returns
 * pictures of clay and studio lighting rather than of the subject.
 */

/**
 * Turns a slide's visual direction into something a photo index can answer.
 *
 * An image model takes a paragraph; a search takes nouns. The direction written
 * for a generator — "isolated 3D clay render of a neural network, soft contact
 * shadow" — describes a style nothing in an index is tagged with, so the style
 * words are dropped and what is left is the subject.
 */
/**
 * The names in a topic, which are the part an index can actually look up.
 *
 * "Amir Temur va Temuriylar davri" is answerable because of the two words in
 * it that name somebody. A capitalised word that is not the first is a name, a
 * place or a title — the sentence's own opening capital says nothing.
 */
export function namedSubject(topic: string): string {
  const words = topic.trim().split(/\s+/).filter(Boolean);
  const named: string[] = [];

  for (const [at, word] of words.entries()) {
    const bare = word.replace(/[^\p{L}\p{N}'’-]/gu, "");
    if (bare.length < 3) continue;
    // The first word's capital is the sentence's, not the subject's — unless
    // the word after it is capitalised too, which is what a full name looks
    // like.
    const capitalised = /^\p{Lu}/u.test(bare);
    if (!capitalised) continue;
    if (at === 0 && !/^\p{Lu}/u.test(words[1]?.replace(/[^\p{L}]/gu, "") ?? "")) continue;
    named.push(bare);
    // Two is a name. Three is a name and the beginning of a sentence, and an
    // index matches worse the more it is given.
    if (named.length === 2) break;
  }

  return named.join(" ");
}

export function photoQuery(direction: string, topic: string): string {
  const STYLE_WORDS = new Set([
    "3d", "render", "clay", "isolated", "matte", "soft", "shadow", "cgi",
    "illustration", "vector", "flat", "minimal", "editorial", "photography",
    "photo", "background", "backdrop", "negative", "space", "composition",
    "lighting", "studio", "closeup", "close-up", "shot", "style", "modern",
    "professional", "high", "quality", "detailed", "realistic",
  ]);

  const words = direction
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STYLE_WORDS.has(word));

  const subject = words.slice(0, 4).join(" ").trim();

  /**
   * A named subject is carried into the query, whatever the direction said.
   *
   * The writer describes a *scene* — "dramatic editorial photography of a
   * historic monument" — and that description is true of ten thousand
   * monuments. Stripped of its style words it becomes a generic subject any
   * stock library can answer, so a deck about Amir Temur was illustrated with
   * a photograph of no monument in particular.
   *
   * The name goes first because it is the part an index matches on, and the
   * scene stays behind it because it is still what the slide is showing.
   */
  const named = namedSubject(topic);
  if (named) {
    const already = named.toLowerCase().split(/\s+/).every((word) => subject.includes(word));
    if (!already) {
      return subject.length >= 3
        ? `${named} ${words.slice(0, 1).join(" ")}`.trim()
        : named;
    }
  }

  // A direction that was nothing but style words leaves the topic, which is at
  // least about the right thing.
  return subject.length >= 3 ? subject : topic.split(/\s+/).slice(0, 4).join(" ");
}
