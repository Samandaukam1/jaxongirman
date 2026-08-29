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
  /** The subject, normalised — what the deck records as already illustrated. */
  entity?: string;
  /** Which service found it, recorded so a finished deck can be audited. */
  via?: string;
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
  /** What the caller already knows about the subject; see `findFromProviders`. */
  intent?: "exact_person" | "named_thing" | "generic";
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
    /** The slide's own title, which names the subject better than a scene does. */
    title?: string | null;
    /** The slot the design will draw this in, carried so the logs can say. */
    imageSlot?: string | null;
    /** Subjects this deck has already illustrated, so one is not repeated. */
    used?: ReadonlySet<string>;
    /**
     * Why a slide has no picture, when it has none.
     *
     * Every failure here is deliberately survivable, which used to mean every
     * failure was also invisible: a deck with no photographs looked exactly
     * like a deck that wanted none. The reason is handed back so the stage can
     * say it out loud, in the row an operator can read afterwards.
     */
    report?: (reason: string) => void;
  },
): Promise<StockPhoto | null> {
  try {
    const query = photoQuery(input.direction, input.topic);
    if (!query) return null;

    console.log(JSON.stringify({
      event: "image_request_started",
      presentation_id: input.presentationId,
      slide_index: input.slideIndex,
      image_slot: input.imageSlot ?? null,
      orientation: input.orientation ?? "landscape",
    }));

    /**
     * Through the image service, which is where the resolver lives.
     *
     * The generator used to resolve, download and store a picture itself. It
     * now asks the same service a person asks when they pick one by hand, so
     * there is one place that decides what may be shown as whom, one
     * downloader — DNS-checked, size-capped, validated by magic bytes — and one
     * bucket the bytes land in. What comes back is a stored file or a reason
     * there is none.
     *
     * Called with the service client, so the request carries the one credential
     * the automatic door accepts. No Telegram account, no chat and no bot token
     * are involved: this is server-to-server.
     */
    const answer = await service.functions.invoke("telegram-image-bot", {
      /**
       * Sent by hand, because the client does not send it here.
       *
       * A supabase-js client built with the service key puts it on every
       * PostgREST and Storage request, which is why the rest of this pipeline
       * works — but `functions.invoke` from inside another edge function
       * arrives with no Authorization header at all. The receiving door was
       * therefore refusing the one caller it exists for, and every deck came
       * back with no photographs and no explanation. It says why now, and the
       * credential is attached explicitly rather than assumed.
       */
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}` },
      body: {
        action: "auto_resolve",
        ownerId: input.ownerId,
        presentationId: input.presentationId,
        slideIndex: input.slideIndex,
        imageSlot: input.imageSlot ?? null,
        query,
        title: input.title ?? null,
        topic: input.topic,
        orientation: input.orientation ?? "landscape",
        stylePreference: input.stylePreference ?? null,
        used: [...(input.used ?? [])],
      },
    });

    if (answer.error) {
      let code = "service_unavailable";
      try {
        const body = await answer.error.context?.json?.();
        code = body?.error ?? body?.code ?? code;
      } catch { /* already consumed */ }
      console.error(JSON.stringify({
        event: "image_resolution_failed",
        presentation_id: input.presentationId,
        slide_index: input.slideIndex,
        reason: code,
      }));
      input.report?.(code);
      return null;
    }

    const result = answer.data as {
      status?: string;
      service?: string;
      reason?: string;
      provider?: PhotoSource | "verified";
      entity?: string;
      bucket?: string;
      path?: string;
      width?: number;
      height?: number;
      attribution?: StockPhoto["attribution"];
    } | null;
    if (!result || result.status !== "selected" || !result.path || !result.attribution) {
      input.report?.(result?.reason ?? result?.status ?? "empty_answer");
      return null;
    }

    return {
      slideIndex: input.slideIndex,
      bucket: result.bucket ?? "stock-images",
      path: result.path,
      source: (result.provider ?? "unsplash") as PhotoSource,
      entity: result.entity,
      via: result.service,
      // Carried so the exporter can pick the hole this actually fits: a
      // landscape photograph in a portrait frame is a face cropped to its ear.
      width: result.width ?? 0,
      height: result.height ?? 0,
      attribution: result.attribution,
    };
  } catch (error) {
    // A search that fails costs the deck a picture, never the deck.
    input.report?.(error instanceof Error ? error.name : "unknown");
    return null;
  }
}
