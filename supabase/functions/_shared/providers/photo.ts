import type { SupabaseClient } from "npm:@supabase/supabase-js";

/**
 * Photographs, found rather than generated.
 *
 * Three indexes, one pipeline. Unsplash is better curated and is asked first;
 * Wikimedia Commons has the subjects a real deck is about — Amir Temur, the
 * Registan, a labelled heart — which no stock library carries; Openverse is the
 * widest net behind both, indexing openly licensed work across Flickr,
 * Wikimedia and others. Each answers when the one before it cannot: no result,
 * an error, or a rate limit, which on a free Unsplash key is a matter of when
 * rather than if.
 *
 * Which one replies is decided by whether a key is configured, never by a flag
 * somebody has to remember, and the fallback is not optional: an install with
 * no Unsplash key must keep working exactly as it did.
 *
 * Every result carries a licence and an author, from either provider, because a
 * deck a student presents in a lecture hall or a company shows to a client is a
 * public use, and a picture with unknown provenance is one nobody can safely
 * publish. Provenance that was not stored cannot be recovered later.
 *
 * Nothing here calls an image model. That is the point.
 */

import { photoQuery } from "../photo-query.ts";
import { firstUsableOpenverse, type OpenversePhoto } from "../openverse-results.ts";
import { findFromProviders, type Orientation, type PhotoSource } from "../photo-order.ts";
import type { PhotoHit } from "../unsplash-results.ts";
import { searchUnsplash, unsplashConfigured } from "./unsplash.ts";
import { searchWikimedia } from "./wikimedia.ts";
import { searchPerson } from "./wikidata.ts";

const ENDPOINT = "https://api.openverse.org/v1/images/";

export type { PhotoSource };

export type StockPhoto = {
  slideIndex: number;
  bucket: string;
  path: string;
  source: PhotoSource;
  width: number;
  height: number;
  /** What has to be shown for the licence to be honoured. */
  attribution: {
    title: string;
    creator: string;
    license: string;
    licenseUrl: string;
    sourceUrl: string;
    provider: string;
  };
};

/**
 * The one place a photograph is looked for.
 *
 * Both the deck generator and the studio's sample slide call this, so there is
 * one ladder, one provider order and one set of licence rules rather than two
 * that drift. The sample an administrator judges a design by has to be found
 * the same way a customer's picture is, or it is not a sample of anything.
 *
 * Unsplash is tried across the whole ladder before Openverse gets a turn.
 * Alternating per rung would trade a good Unsplash match for a vague Openverse
 * one, which is the opposite of preferring Unsplash.
 */
export function searchStock(input: {
  query: string;
  orientation?: Orientation;
  /** The design's `stylePreference`, used only to widen a failing search. */
  theme?: string | null;
  /** Usable results to pass over, for "another photograph, same subject". */
  skip?: number;
}): Promise<{ hit: PhotoHit; source: PhotoSource } | null> {
  return findFromProviders({
    unsplashConfigured,
    unsplash: searchUnsplash,
    wikimedia: searchWikimedia,
    openverse: searchOpenverse,
    person: searchPerson,
  }, input);
}

async function searchOpenverse(query: string, orientation: Orientation, skip = 0): Promise<PhotoHit | null> {
  const parameters = new URLSearchParams({
    q: query,
    // Only work that may be reused commercially and modified. A presentation is
    // a public use and a slide crops its pictures.
    license_type: "commercial,modification",
    size: "large",
    mature: "false",
    page_size: "8",
  });
  if (orientation !== "any") {
    parameters.set("aspect_ratio", orientation === "square" ? "square" : orientation === "portrait" ? "tall" : "wide");
  }

  try {
    const response = await fetch(`${ENDPOINT}?${parameters}`, {
      headers: { "User-Agent": "Jaxongirman/1.0 (presentation generator)" },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { results?: OpenversePhoto[] };
    return firstUsableOpenverse(payload.results ?? [], skip);
  } catch {
    return null;
  }
}

export async function findPhoto(
  service: SupabaseClient,
  input: {
    ownerId: string;
    presentationId: string;
    slideIndex: number;
    direction: string;
    topic: string;
    orientation?: Orientation;
    /** The design's own `stylePreference`, when the slot declares one. */
    stylePreference?: string | null;
  },
): Promise<StockPhoto | null> {
  try {
    const query = photoQuery(input.direction, input.topic);
    if (!query) return null;

    const found = await searchStock({
      query,
      orientation: input.orientation ?? "landscape",
      theme: input.stylePreference ?? null,
    });
    if (!found) return null;

    const image = await fetch(found.hit.url);
    if (!image.ok) return null;
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (bytes.byteLength === 0) return null;

    const type = image.headers.get("content-type") ?? "image/jpeg";
    const extension = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const path = `${input.ownerId}/${input.presentationId}/${crypto.randomUUID()}.${extension}`;

    const { error } = await service.storage.from("stock-images").upload(path, bytes, {
      contentType: type,
      upsert: false,
    });
    if (error) return null;

    return {
      slideIndex: input.slideIndex,
      bucket: "stock-images",
      path,
      source: found.source,
      // Carried so the exporter can pick the hole this actually fits: a
      // landscape photograph in a portrait frame is a face cropped to its ear.
      width: found.hit.width,
      height: found.hit.height,
      // Whatever the provider said, unchanged: a credit line rewritten by the
      // system is a credit line nobody can check against the source.
      attribution: found.hit.attribution,
    };
  } catch {
    // A search that fails costs the deck a picture, never the deck.
    return null;
  }
}
