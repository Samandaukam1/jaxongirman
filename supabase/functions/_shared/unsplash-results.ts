/**
 * Reading an Unsplash search result, without doing the search.
 *
 * Split from the provider for the reason every other pure module here is: the
 * fetch needs `Deno.env` and a network, and the decisions — which result is
 * usable, what to try when nothing is — need neither and are the parts worth
 * testing. `photo-query.ts` sits beside `providers/photo.ts` for the same
 * reason.
 */

export type PhotoHit = {
  /** Where the bytes are, at a size worth putting on a slide. */
  url: string;
  width: number;
  height: number;
  attribution: {
    title: string;
    creator: string;
    license: string;
    licenseUrl: string;
    sourceUrl: string;
    provider: string;
  };
};


/** What a search result looks like on the wire, in the parts that are read. */
export type UnsplashPhoto = {
  id?: string;
  description?: string | null;
  alt_description?: string | null;
  width?: number;
  height?: number;
  urls?: { regular?: string; full?: string; raw?: string };
  links?: { html?: string };
  user?: { name?: string; username?: string; links?: { html?: string } };
};

/**
 * The first result that can be used *and* credited.
 *
 * Both halves matter. A photo with no file is useless; a photo with no
 * photographer and no link back cannot be published under Unsplash's terms, so
 * it is skipped rather than used with an empty credit line.
 */
export function firstUsable(results: readonly UnsplashPhoto[]): PhotoHit | null {
  for (const photo of results) {
    const url = photo.urls?.regular ?? photo.urls?.full;
    const creator = photo.user?.name ?? photo.user?.username;
    const sourceUrl = photo.links?.html;
    if (!url || !creator || !sourceUrl) continue;

    return {
      url,
      width: photo.width ?? 0,
      height: photo.height ?? 0,
      attribution: {
        title: (photo.description ?? photo.alt_description ?? "").trim() || "Untitled",
        creator,
        license: "Unsplash License",
        licenseUrl: "https://unsplash.com/license",
        sourceUrl,
        provider: "Unsplash",
      },
    };
  }
  return null;
}

/**
 * The queries to try, in order, before giving up on a picture.
 *
 * A search that returns nothing is common and is not a failure: "quarterly
 * revenue growth in emerging markets" is a sentence, not something an index is
 * tagged with. Each step drops information rather than inventing it — the last
 * one is deliberately abstract, because a texture that suits the theme is a
 * better slide than an empty frame, and an image-free layout is better than
 * either when even that fails.
 */
export function queryLadder(query: string, theme?: string): string[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const ladder: string[] = [];

  if (words.length > 0) ladder.push(words.join(" "));
  // The first three words are usually the subject; the rest is qualification.
  if (words.length > 3) ladder.push(words.slice(0, 3).join(" "));
  if (words.length > 1) ladder.push(words[0]!);
  if (theme) ladder.push(`${theme} abstract background`);
  ladder.push("abstract texture");

  return [...new Set(ladder.map((entry) => entry.toLowerCase()))];
}
