import { namedSubject } from "./photo-query.ts";
import { queryLadder, type PhotoHit } from "./unsplash-results.ts";

/**
 * Which index to ask, in what order, and what to do when one does not answer.
 *
 * Split from `providers/photo.ts` for the reason every other pure module here
 * is: the searches need a network and a key, and the *order* needs neither and
 * is the part worth testing. A provider order that is only exercised against
 * the live internet is one nobody can prove the fallback of — you would have to
 * break Unsplash on purpose to see Openverse answer.
 */

export type PhotoSource = "unsplash" | "wikimedia" | "openverse";
export type Orientation = "landscape" | "portrait" | "square" | "any";

export type ProviderSearch = (query: string, orientation: Orientation, skip: number) => Promise<PhotoHit | null>;

export type PhotoProviders = {
  /** False when no key is configured; Unsplash is then skipped entirely. */
  unsplashConfigured: () => boolean;
  unsplash: ProviderSearch;
  /**
   * Wikimedia Commons. No key, no configuration flag — the API is open, so
   * there is nothing to switch on and nothing that can be left unset.
   */
  wikimedia: ProviderSearch;
  openverse: ProviderSearch;
};

/**
 * Unsplash across the whole ladder first, then Openverse across it.
 *
 * Not alternating per rung: that would trade a good Unsplash match for a vague
 * Openverse one, which is the opposite of preferring Unsplash. The fallback
 * covers every way the first provider can fail to produce a picture — no
 * result, an error, a rate limit — because from here they are the same fact:
 * nothing came back, and the deck still needs an image.
 *
 * A provider that throws does not end the search. An install whose Unsplash key
 * has expired must keep making decks, and it does that by falling through to
 * the index that needs no key at all.
 */
export async function findFromProviders(
  providers: PhotoProviders,
  input: { query: string; orientation?: Orientation; theme?: string | null; skip?: number },
): Promise<{ hit: PhotoHit; source: PhotoSource } | null> {
  const orientation = input.orientation ?? "landscape";
  const skip = input.skip ?? 0;
  const ladder = queryLadder(input.query, input.theme ?? undefined);

  /**
   * A named person goes to the encyclopaedia, and only there.
   *
   * Unsplash has no photograph of Alisher Navoiy and will not say so: it
   * answers with a confident portrait of somebody else, which on the cover of a
   * biography is worse than an empty frame. Openverse indexes Wikimedia, which
   * either holds that person or holds nothing.
   */
  /**
   * Who is asked first depends on whether the query names something.
   *
   * A stock library always answers. Asked for "Amir Temur" it does not say "I
   * have no picture of him" — it returns a confident photograph of a monument
   * somewhere else, and the deck looks illustrated while showing the wrong
   * thing. An encyclopaedia either has that subject or has nothing, and
   * nothing is the answer that lets the next provider try.
   *
   * So a named subject goes to Commons first. A person never reaches the stock
   * library at all: a photograph of the wrong monument is a weak slide, and a
   * photograph of the wrong human on a biography is a different kind of wrong.
   * Everything unnamed keeps the order it always had.
   */
  const person = looksLikePerson(input.query);
  const named = person || namedSubject(input.query).length > 0;

  const unsplash = { source: "unsplash" as const, search: providers.unsplash };
  const wikimedia = { source: "wikimedia" as const, search: providers.wikimedia };
  const openverse = { source: "openverse" as const, search: providers.openverse };

  const order: Array<{ source: PhotoSource; search: ProviderSearch }> = [];
  if (named) order.push(wikimedia);
  if (!person && providers.unsplashConfigured()) order.push(unsplash);
  if (!named) order.push(wikimedia);
  order.push(openverse);

  for (const { source, search } of order) {
    /**
     * A name is asked for as a name, not widened.
     *
     * The ladder drops words to broaden a failing search, which for a subject
     * finds something near enough and for a person finds a different person —
     * "Alisher Navoiy" widened to "Alisher" is a search for anybody.
     */
    const rungs = person ? ladder.slice(0, 1) : ladder;
    for (const rung of rungs) {
      let hit: PhotoHit | null = null;
      try {
        hit = await search(rung, orientation, skip);
      } catch {
        // This provider is having a bad day. The next one is the whole reason
        // there is a next one; a throw must not become a deck with no picture.
        break;
      }
      if (hit) {
        /**
         * Which index answered, and what it answered with.
         *
         * A deck whose pictures came from the fallback looks the same as one
         * whose pictures came from the first choice, and the difference only
         * shows up in the log. No query text beyond the subject and no secret:
         * the search terms are the author's topic, not their identity.
         */
        console.log(JSON.stringify({
          event: "photo_found",
          photo_query: rung,
          photo_provider: source,
          photo_width: hit.width,
          photo_height: hit.height,
          fell_back: source !== order[0]?.source,
        }));
        return { hit, source };
      }
    }
  }
  console.log(JSON.stringify({ event: "photo_missing", photo_query: input.query, tried: order.map((entry) => entry.source) }));
  return null;
}

/**
 * Does this query name a person?
 *
 * It matters because the two indexes fail differently. Asked for "Alisher
 * Navoiy", a stock library does not say "I have no picture of him" — it
 * confidently returns a photograph of some other person, and a biography deck
 * opens with a stranger's face. An encyclopaedic index either has that person
 * or returns nothing, which is the honest answer and the one a deck can
 * survive.
 *
 * Deliberately conservative. A false positive costs a stock photograph that
 * would have been fine; a false negative puts the wrong human on the cover of
 * somebody's biography, and those are not the same mistake.
 */

/** Words that make a phrase a subject rather than a name. */
const NOT_A_NAME = new Set([
  "haqida", "hayoti", "biografiya", "tarjimai", "faoliyati", "ijodi", "asarlari",
  "tarixi", "rivoji", "muammolari", "tahlili", "asoslari", "usullari", "turlari",
  "about", "life", "biography", "history", "analysis",
]);

/**
 * Uzbek names carry these as separate words. "Jaxongir Qurbonnazarov o'g'li" is
 * one person, not a person and a topic.
 */
const NAME_PARTICLES = new Set(["o'g'li", "ogli", "qizi", "bin", "ibn", "van", "de", "al"]);

export function looksLikePerson(query: string): boolean {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) return false;

  /**
   * The topic words come off first, then what is left has to be a name.
   *
   * Checking the length before stripping them was backwards: "Alisher Navoiy
   * hayoti va ijodi" is five words and a biography of one person, and counting
   * first ruled it out before the words that made it long were even looked at.
   */
  const remaining = words.filter((word) => {
    const bare = word.toLowerCase().replace(/[^\p{L}'’]/gu, "");
    if (!bare) return false;
    if (NOT_A_NAME.has(bare) || NAME_PARTICLES.has(bare)) return false;
    // Connectives: too short to be a name, and lower case in every language
    // this writes in.
    return !(bare.length <= 2 && word === word.toLowerCase());
  });

  if (remaining.length < 2 || remaining.length > 3) return false;

  // Every remaining word starts with a capital and is a word rather than a
  // number or a code. A sentence has lower-case words in it; a name does not.
  return remaining.every((word) => /^[\p{Lu}][\p{L}'’-]{1,}$/u.test(word));
}
