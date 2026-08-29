import type { SupabaseClient } from "npm:@supabase/supabase-js";

import { identityCritical, readIntent, type ImageIntent } from "./image-intent.ts";
import { searchStock, type PhotoSource } from "./providers/photo.ts";
import type { Orientation } from "./wikimedia-results.ts";
import type { PhotoHit } from "./unsplash-results.ts";

/**
 * The one place a picture is decided.
 *
 * Everything that wants an image — the deck generator, the studio's sample
 * slide, and whatever asks next — comes through here. Not because a wrapper is
 * tidy, but because the rules that matter are the ones about *not* using a
 * picture, and a rule that lives in one caller is a rule the other callers
 * break.
 *
 * Three layers, cheapest first:
 *
 *   1. What somebody already confirmed. A person looked at a file and said it
 *      is Yulduz Usmonova; there is nothing to search and nothing to get wrong.
 *   2. What this deck already found. The same subject on four slides should
 *      not be four searches, or four different photographs of one woman.
 *   3. The provider ladder that already exists — Wikidata for people, Commons
 *      for named things, Unsplash for ideas, Openverse behind all of it.
 *
 * The layer that matters most is the one that returns nothing. For a named
 * person whose identity cannot be established, no picture is the answer, and
 * every provider below is skipped rather than asked more loosely.
 */

export type ResolveStatus = "verified" | "found" | "no_image";

/** Why a candidate was not used, in words a query can group by. */
export type RejectionReason =
  | "identity_unverified"
  | "identity_mismatch"
  | "context_mismatch"
  | "no_provider_result"
  | "duplicate"
  | "broken_image"
  | "unsupported_format"
  | "rights_rejected";

export type ResolvedImage = {
  status: ResolveStatus;
  intent: ImageIntent;
  entity: string;
  /** The cache key: lowercased, apostrophes folded. */
  normalized: string;
  provider: PhotoSource | "verified" | null;
  hit: PhotoHit | null;
  /** Set when a confirmed row answered, so the caller can skip downloading. */
  storagePath: string | null;
  confidence: number;
  reason: RejectionReason | null;
  /** Every step, for the debugger. Never a secret and never a key. */
  trace: Array<{ step: string; detail?: string }>;
};

export type ResolveInput = {
  query: string;
  title?: string | null;
  topic?: string | null;
  orientation?: Orientation;
  stylePreference?: string | null;
  skip?: number;
  /**
   * Subjects this deck has already illustrated.
   *
   * A deck about one person should not repeat one photograph on six slides.
   * The caller owns the set because only it knows what a deck is.
   */
  used?: ReadonlySet<string>;
};

const CONFIDENCE = { verified: 1, entity: 0.9, named: 0.7, generic: 0.5 } as const;

/**
 * A confirmed picture, if somebody has confirmed one.
 *
 * Read through whatever client the caller has. A miss is silent and ordinary:
 * most subjects have never been confirmed and never need to be.
 */
async function fromLibrary(
  service: SupabaseClient,
  normalized: string,
  intent: ImageIntent,
): Promise<ResolvedImage | null> {
  const { data, error } = await service
    .from("verified_images")
    .select("display_name, image_storage_path, original_url, source_url, provider, creator, license, license_url")
    .eq("normalized_entity", normalized)
    .eq("entity_type", intent)
    .eq("verified", true)
    .maybeSingle();

  if (error) {
    // Loud, and not fatal: the search below still works, and an operator
    // learns the cache is unreadable rather than paying for it silently.
    console.error(JSON.stringify({ event: "verified_lookup_failed", detail: error.message }));
    return null;
  }
  if (!data) return null;

  return {
    status: "verified",
    intent,
    entity: data.display_name as string,
    normalized,
    provider: "verified",
    storagePath: data.image_storage_path as string,
    confidence: CONFIDENCE.verified,
    reason: null,
    trace: [{ step: "verified_library", detail: "confirmed by an administrator" }],
    hit: {
      url: (data.original_url as string) ?? "",
      width: 0,
      height: 0,
      attribution: {
        title: data.display_name as string,
        creator: (data.creator as string) ?? "",
        license: (data.license as string) ?? "",
        licenseUrl: (data.license_url as string) ?? "",
        sourceUrl: (data.source_url as string) ?? "",
        provider: (data.provider as string) ?? "verified",
      },
    },
  };
}

/**
 * Find the picture this slide should use, or say why there is none.
 *
 * Never throws for a missing picture: a slide without one is a composition the
 * design already knows how to draw, and a generation that fails because a
 * photo index was slow is a deck nobody gets.
 */
export async function resolveImage(
  service: SupabaseClient,
  input: ResolveInput,
): Promise<ResolvedImage> {
  const began = Date.now();
  const reading = readIntent({ query: input.query, title: input.title, topic: input.topic });
  const orientation = input.orientation ?? "landscape";
  const trace: Array<{ step: string; detail?: string }> = [
    { step: "intent", detail: `${reading.intent} · ${reading.entity}` },
  ];

  const say = (result: ResolvedImage): ResolvedImage => {
    console.log(JSON.stringify({
      event: "image_resolved",
      query: input.query,
      intent: result.intent,
      normalized_entity: result.normalized,
      cache_hit: result.status === "verified",
      provider: result.provider,
      accepted: result.status !== "no_image",
      rejection_reason: result.reason,
      duration_ms: Date.now() - began,
    }));
    return result;
  };

  const confirmed = await fromLibrary(service, reading.normalized, reading.intent);
  if (confirmed) return say({ ...confirmed, trace: [...trace, ...confirmed.trace] });
  trace.push({ step: "verified_library", detail: "no confirmed picture" });

  /**
   * The same subject twice in one deck is one search and one picture.
   *
   * Repeating it on every slide is worse than leaving some of them bare, so a
   * subject already used is reported as a duplicate and the caller decides.
   */
  if (input.used?.has(reading.normalized)) {
    return say({
      status: "no_image", intent: reading.intent, entity: reading.entity, normalized: reading.normalized,
      provider: null, hit: null, storagePath: null, confidence: 0,
      reason: "duplicate",
      trace: [...trace, { step: "duplicate", detail: "this deck has already used this subject" }],
    });
  }

  /**
   * The ladder that already exists, unchanged.
   *
   * It routes a person to the entity lookup and refuses to fall through to a
   * stock library; it sends named things to Commons first and ideas to
   * Unsplash. Nothing here re-decides any of that.
   */
  const found = await searchStock({
    query: input.query,
    orientation,
    theme: input.stylePreference ?? null,
    skip: input.skip ?? 0,
    /**
     * What was worked out above, handed down rather than guessed again.
     *
     * "Registon maydoni" has no second capital, so the ladder's own test read
     * it as an ordinary phrase and sent it to a stock library — which answered
     * with a handsome archway that is not the Registan.
     */
    intent: reading.intent === "exact_person"
      ? "exact_person"
      : reading.intent === "generic_concept" ? "generic" : "named_thing",
  });

  if (!found) {
    return say({
      status: "no_image", intent: reading.intent, entity: reading.entity, normalized: reading.normalized,
      provider: null, hit: null, storagePath: null, confidence: 0,
      // For a person the ladder refuses rather than fails: it found nobody it
      // could prove, which is a different fact from finding no photograph.
      reason: identityCritical(reading.intent) ? "identity_unverified" : "no_provider_result",
      trace: [...trace, { step: "providers", detail: "nothing usable" }],
    });
  }

  const confidence = found.source === "wikidata"
    ? CONFIDENCE.entity
    : reading.intent === "generic_concept" ? CONFIDENCE.generic : CONFIDENCE.named;

  return say({
    status: "found",
    intent: reading.intent,
    entity: reading.entity,
    normalized: reading.normalized,
    provider: found.source,
    hit: found.hit,
    storagePath: null,
    confidence,
    reason: null,
    trace: [...trace, { step: "providers", detail: found.source }],
  });
}
