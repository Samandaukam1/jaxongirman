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

export type PhotoSource = "unsplash" | "openverse";
export type Orientation = "landscape" | "portrait" | "square" | "any";

export type ProviderSearch = (query: string, orientation: Orientation, skip: number) => Promise<PhotoHit | null>;

export type PhotoProviders = {
  /** False when no key is configured; Unsplash is then skipped entirely. */
  unsplashConfigured: () => boolean;
  unsplash: ProviderSearch;
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

  const order: Array<{ source: PhotoSource; search: ProviderSearch }> = [];
  if (providers.unsplashConfigured()) order.push({ source: "unsplash", search: providers.unsplash });
  order.push({ source: "openverse", search: providers.openverse });

  for (const { source, search } of order) {
    for (const rung of ladder) {
      let hit: PhotoHit | null = null;
      try {
        hit = await search(rung, orientation, skip);
      } catch {
        // This provider is having a bad day. The next one is the whole reason
        // there is a next one; a throw must not become a deck with no picture.
        break;
      }
      if (hit) return { hit, source };
    }
  }
  return null;
}
