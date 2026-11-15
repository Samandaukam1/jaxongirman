/**
 * Where ad pages sit in a presented or downloaded deck.
 *
 * One ad page after every fifth page of the deck — page 6, 12, 18 … — each ad
 * once, and only where more of the deck follows, so a deck never ends on an ad
 * and never shows more ad pages than there are ads. `presentation_ad_pages` in
 * the database counts the same pages; the phone, the screen and the exported
 * file all lay them out with this.
 *
 * This file is copied byte for byte to supabase/functions/_shared/presentation-ads.ts,
 * and a test keeps the two copies the same.
 */

export type PresentationAd = { id: string; path: string; link: string | null };

export type DeckPage<Ad = PresentationAd> =
  | { kind: "slide"; index: number }
  | { kind: "ad"; ad: Ad };

/** The pages of a deck of `slideCount` slides with `ads` placed in it. */
export function deckWithAds<Ad>(slideCount: number, ads: readonly Ad[]): DeckPage<Ad>[] {
  const pages: DeckPage<Ad>[] = [];
  let placed = 0;
  for (let index = 0; index < slideCount; index += 1) {
    pages.push({ kind: "slide", index });
    const afterFifth = (index + 1) % 5 === 0;
    const moreFollows = index < slideCount - 1;
    const ad = ads[placed];
    if (afterFifth && moreFollows && ad !== undefined) {
      pages.push({ kind: "ad", ad });
      placed += 1;
    }
  }
  return pages;
}
