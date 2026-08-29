/**
 * Asking for a picture, from anywhere.
 *
 * The deck generator calls the resolver in-process; this is the same resolver
 * behind an endpoint, for the callers that are not the generator: the admin
 * console's debugger today, an inline Telegram bot later. One decision path,
 * one set of rules about what not to use, however the question arrives.
 *
 * Two modes, because two different questions get asked. `best` is what a
 * generator wants — one answer or none. `candidates` is what a person wants
 * when they are about to confirm one: several, with the reasoning attached, so
 * the choice is theirs and they can see why the machine ranked it that way.
 *
 * Admin-only for now. The rules it enforces are about what may be published as
 * a named person, and that is not a decision to expose before there is somebody
 * accountable on the other end of it.
 */
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { readIntent } from "../_shared/image-intent.ts";
import { resolveImage } from "../_shared/image-resolver.ts";
import { searchStock } from "../_shared/providers/photo.ts";
import type { Orientation } from "../_shared/wikimedia-results.ts";

type Body = {
  query?: string;
  title?: string | null;
  topic?: string | null;
  mode?: "best" | "candidates";
  orientation?: Orientation;
  stylePreference?: string | null;
  /** How many to offer in `candidates`. Bounded so one call cannot walk an index. */
  limit?: number;
};

const ORIENTATIONS = new Set(["landscape", "portrait", "square", "any"]);

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const context = await requestContext(request);
    const { data: isAdmin } = await context.serviceClient.rpc("is_admin", { p_user_id: context.user.id });
    if (!isAdmin) throw new HttpError(403, "forbidden", "forbidden");

    const body = await bodyJson<Body>(request);
    const query = (body.query ?? "").trim();
    if (!query) throw new HttpError(400, "So‘rov yozilmadi.", "missing_query");
    if (query.length > 200) throw new HttpError(400, "So‘rov juda uzun.", "query_too_long");

    const orientation = ORIENTATIONS.has(String(body.orientation)) ? body.orientation! : "landscape";
    const mode = body.mode === "candidates" ? "candidates" : "best";
    const reading = readIntent({ query, title: body.title, topic: body.topic });

    if (mode === "best") {
      const resolved = await resolveImage(context.serviceClient, {
        query,
        title: body.title ?? null,
        topic: body.topic ?? null,
        orientation,
        stylePreference: body.stylePreference ?? null,
      });
      return json(resolved);
    }

    /**
     * Several answers, each with what the ladder had to say about it.
     *
     * Walked by asking the same search to step past what it already offered,
     * so the list is the providers' own order rather than a second ranking
     * invented here. A person that cannot be verified yields nothing at all,
     * and that emptiness is the answer rather than a reason to loosen the
     * search — which is exactly what a human is about to confirm or not.
     */
    const limit = Math.max(1, Math.min(10, Number(body.limit) || 6));
    const candidates = [];
    const seen = new Set<string>();

    for (let at = 0; at < limit; at += 1) {
      const found = await searchStock({
        query,
        orientation,
        theme: body.stylePreference ?? null,
        skip: at,
      });
      if (!found) break;
      if (seen.has(found.hit.url)) break;
      seen.add(found.hit.url);
      candidates.push({ provider: found.source, ...found.hit });
    }

    return json({
      intent: reading.intent,
      entity: reading.entity,
      normalized: reading.normalized,
      orientation,
      candidates,
      // Said plainly: for a person this is not "we looked and there were few",
      // it is "nothing could be proved", and confirming one by hand is how it
      // gets an answer.
      note: candidates.length === 0 && reading.intent === "exact_person"
        ? "Bu shaxs uchun tasdiqlangan rasm topilmadi. Qo‘lda tasdiqlash kerak."
        : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
