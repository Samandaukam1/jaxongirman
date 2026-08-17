import type { SupabaseClient } from "npm:@supabase/supabase-js";

/**
 * Photographs, found rather than generated.
 *
 * Openverse indexes openly licensed images across Flickr, Wikimedia and others,
 * and needs no API key. That last part matters less than the first: every
 * result carries a licence, and a deck a student presents in a lecture hall or
 * a company shows to a client is a public use. A picture with unknown
 * provenance is one nobody can safely publish, so the search asks only for
 * work that may be used commercially and modified, and keeps the author and
 * the licence with the file.
 *
 * Nothing here calls an image model. That is the point.
 */

import { photoQuery } from "../photo-query.ts";

const ENDPOINT = "https://api.openverse.org/v1/images/";

export type StockPhoto = {
  slideIndex: number;
  bucket: string;
  path: string;
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

type OpenverseResult = {
  id?: string;
  title?: string;
  creator?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  url?: string;
  provider?: string;
  width?: number;
  height?: number;
};

async function search(query: string, orientation: "landscape" | "portrait" | "square" | "any"): Promise<OpenverseResult | null> {
  const parameters = new URLSearchParams({
    q: query,
    // Only work that may be reused commercially and modified. A presentation is
    // a public use and a slide crops its pictures.
    license_type: "commercial,modification",
    size: "large",
    mature: "false",
    page_size: "8",
  });
  if (orientation !== "any") parameters.set("aspect_ratio", orientation === "square" ? "square" : orientation === "portrait" ? "tall" : "wide");

  const response = await fetch(`${ENDPOINT}?${parameters}`, {
    headers: { "User-Agent": "Jaxongirman/1.0 (presentation generator)" },
  });
  if (!response.ok) return null;

  const payload = await response.json() as { results?: OpenverseResult[] };
  // The first result that actually has a file and an author to credit. A
  // result missing either is one that cannot be used honestly.
  return (payload.results ?? []).find((entry) => entry.url && (entry.creator || entry.provider)) ?? null;
}

/**
 * Finds a photograph for a slide and stores it beside the deck.
 *
 * Downloaded rather than linked: a deck that referenced a third-party URL would
 * lose its pictures whenever that host moved them, and an export has to work
 * offline.
 *
 * Returns null rather than throwing. No picture is a composition on the
 * palette ground, which several designs treat as deliberate; a failed
 * generation used to be the thing that stopped a deck, and a photo search
 * should not inherit that.
 */
export async function findPhoto(
  service: SupabaseClient,
  input: {
    ownerId: string;
    presentationId: string;
    slideIndex: number;
    direction: string;
    topic: string;
    orientation?: "landscape" | "portrait" | "square" | "any";
  },
): Promise<StockPhoto | null> {
  try {
    const query = photoQuery(input.direction, input.topic);
    if (!query) return null;

    const found = await search(query, input.orientation ?? "landscape");
    if (!found?.url) return null;

    const image = await fetch(found.url);
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

    const license = found.license
      ? `${found.license.toUpperCase()}${found.license_version ? ` ${found.license_version}` : ""}`
      : "unknown";

    return {
      slideIndex: input.slideIndex,
      bucket: "stock-images",
      path,
      attribution: {
        title: found.title ?? query,
        creator: found.creator ?? found.provider ?? "noma'lum",
        license,
        licenseUrl: found.license_url ?? "",
        sourceUrl: found.foreign_landing_url ?? found.url,
        provider: found.provider ?? "openverse",
      },
    };
  } catch {
    // A search that fails costs the deck a picture, never the deck.
    return null;
  }
}
