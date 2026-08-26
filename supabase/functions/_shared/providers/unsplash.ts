/**
 * Unsplash, as a second source rather than a replacement.
 *
 * Openverse is what this product has always searched, and it has two things
 * going for it that are easy to overlook: it needs no key, and every result it
 * returns is already filtered to licences that permit commercial use and
 * modification — which is what a slide does to a photograph. Unsplash is
 * better-curated, and for a deck somebody is going to present that matters.
 *
 * So both exist. Which one answers is decided by whether a key is configured,
 * not by a flag somebody has to remember: an install with no Unsplash key keeps
 * working exactly as it did.
 *
 * Attribution is not optional and is not a footnote here. Unsplash's terms
 * require the photographer credited and a link back, so a result that cannot
 * supply both is not returned — the same rule Openverse's side already applies.
 */

import { firstUsable, type PhotoHit, type UnsplashPhoto } from "../unsplash-results.ts";

export type { PhotoHit };

const ENDPOINT = "https://api.unsplash.com/search/photos";

/** Unsplash asks to be told which application is calling, and which version. */
const CLIENT = "Jaxongirman/1.0";

export const unsplashConfigured = (): boolean => Boolean(Deno.env.get("UNSPLASH_ACCESS_KEY"));

export async function searchUnsplash(
  query: string,
  orientation: "landscape" | "portrait" | "square" | "any",
): Promise<PhotoHit | null> {
  const key = Deno.env.get("UNSPLASH_ACCESS_KEY");
  if (!key || !query.trim()) return null;

  const parameters = new URLSearchParams({
    query,
    per_page: "8",
    content_filter: "high",
  });
  // Unsplash has no "square"; asking for one returns nothing rather than
  // something near enough, so it is left unset and the crop does that work.
  if (orientation === "landscape" || orientation === "portrait") {
    parameters.set("orientation", orientation);
  }

  let payload: { results?: UnsplashPhoto[] };
  try {
    const response = await fetch(`${ENDPOINT}?${parameters}`, {
      headers: {
        Authorization: `Client-ID ${key}`,
        "Accept-Version": "v1",
        "User-Agent": CLIENT,
      },
    });
    if (!response.ok) return null;
    payload = await response.json() as { results?: UnsplashPhoto[] };
  } catch {
    return null;
  }

  return firstUsable(payload.results ?? []);
}

