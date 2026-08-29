import { normaliseName } from "./entity-match.ts";
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

export type PhotoSource = "unsplash" | "wikidata" | "wikimedia" | "openverse";
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
  /**
   * The picture a named person's own entity records as itself.
   *
   * Separate from the others because it is not a search and does not answer
   * like one. Identity is established first and the picture follows from it,
   * and when there is no picture the caller has to know *why*: a name that
   * turns out to be a building may go on to the ordinary providers, and a name
   * that is a person may not.
   */
  person: PersonLookup;
};

export type PersonResult =
  /** Verified: this is the picture the entity records as itself. */
  | { kind: "photo"; hit: PhotoHit }
  /** The name resolves to a place, a film, a building — carry on searching. */
  | { kind: "not_a_person" }
  /** It reads as a person and could not be verified. Stop: no picture. */
  | { kind: "unverified"; reason: string };

export type PersonLookup = (
  name: string,
  orientation: Orientation,
  skip: number,
) => Promise<PersonResult>;

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
  input: {
    query: string;
    orientation?: Orientation;
    theme?: string | null;
    skip?: number;
    /**
     * What the caller already worked out about the subject.
     *
     * This can tell a name from a phrase, but not a square from a surname:
     * "Registon maydoni" has no second capital, so it read as an ordinary
     * phrase and went to a stock library — which answered with a handsome
     * archway that is not the Registan. The resolver knows better and says so.
     */
    intent?: "exact_person" | "named_thing" | "generic";
    /**
     * Who or what the caller decided this is about.
     *
     * The query is one slide's scene; the subject can only be read from the
     * slide's title or the deck's topic, which is where a person's name usually
     * lives. Without it this ladder re-derived the subject from the scene
     * alone: a slide reading "Qoraqalpog‘iston tabiati" in a deck about a
     * person it cannot verify was checked as if it were about Karakalpakstan,
     * passed the person test by not being one, and came back with a stock
     * photograph filed under that person's name. The identity rule has to be
     * applied to the identity the answer will be labelled with.
     */
    subject?: string | null;
  },
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
  /**
   * Is the *subject* a person, rather than the whole decorated query?
   *
   * By the time a slide asks for a picture the query carries the scene as well
   * as the subject — "Sherzodxon Qudratxoja dramatic" — and testing the whole
   * string decides it is not a name, which is how the wrong photograph reached
   * a biography even after the person rule existed. The subject is the part
   * that names something; the rest describes it.
   */
  const subject = (input.subject ?? "").trim() || namedSubject(input.query) || input.query;
  const maybePerson = input.intent === "exact_person"
    || (input.intent === undefined && looksLikePerson(subject));
  const named = maybePerson
    || input.intent === "named_thing"
    || (input.intent === undefined && namedSubject(input.query).length > 0);

  const unsplash = { source: "unsplash" as const, search: providers.unsplash };
  const wikimedia = { source: "wikimedia" as const, search: providers.wikimedia };
  const openverse = { source: "openverse" as const, search: providers.openverse };

  /**
   * A named person has exactly one acceptable source, and it is not a search.
   *
   * Every image index answers a name with something. Commons offers a comedy
   * premiere for "Sherzodxon Qudratxo'ja"; a stock library offers a confident
   * portrait of a stranger; Openverse offers whichever photograph of a person
   * its index liked. All three look like success and all three put somebody
   * else's face on a person's biography.
   *
   * So a person is resolved as an entity or not at all. No picture is a slide
   * the design already knows how to draw. The wrong picture is a different
   * kind of mistake, and no amount of relevance ranking makes it recoverable.
   */
  if (maybePerson) {
    /**
     * Asked by name alone, never by the decorated query.
     *
     * The scene words describe a photograph; the entity lookup needs the
     * person. Sending "Sherzodxon Qudratxoja dramatic" to an encyclopaedia
     * finds nothing and would fail somebody who is actually in it.
     */
    let result: PersonResult = { kind: "unverified", reason: "lookup_failed" };
    try {
      result = await providers.person(subject, orientation, skip);
    } catch {
      result = { kind: "unverified", reason: "lookup_failed" };
    }

    if (result.kind === "photo") {
      console.log(JSON.stringify({
        event: "photo_found", photo_query: subject, photo_provider: "wikidata",
        photo_width: result.hit.width, photo_height: result.hit.height,
        search_type: "person", fell_back: false,
      }));
      return { hit: result.hit, source: "wikidata" };
    }

    if (result.kind === "unverified") {
      console.log(JSON.stringify({
        event: "photo_missing", photo_query: subject, search_type: "person",
        // Said explicitly, because an empty frame on a biography is a decision
        // rather than a failure and somebody will ask why.
        reason: result.reason,
      }));
      return null;
    }
    // `not_a_person`: a place, a building, a film named after somebody. The
    // ordinary providers are exactly right for those.
  }

  const order: Array<{ source: PhotoSource; search: ProviderSearch }> = [];
  if (named) order.push(wikimedia);
  if (providers.unsplashConfigured()) order.push(unsplash);
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
    const rungs = maybePerson ? ladder.slice(0, 1) : ladder;
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

  /**
   * Every remaining word starts with a capital and is a word rather than a
   * number or a code. A sentence has lower-case words in it; a name does not.
   *
   * The apostrophes come out first. `Qudratxo‘ja` carries U+2018, `Qudratxo’ja`
   * carries U+2019 and `Qudratxoʻja` carries U+02BB — one surname on three
   * keyboards — and a character class that knows only some of them decides a
   * person is not a person, which is how the wrong photograph gets through.
   */
  return remaining.every((word) => {
    const bare = word.replace(/[‘’ʻʼ′'`´]/g, "");
    return /^[\p{Lu}][\p{L}-]{1,}$/u.test(bare) && normaliseName(word).length > 1;
  });
}
