/**
 * The image resolution service: what generation asks when a slide needs a
 * picture and there is nobody to ask.
 *
 * This is not Telegram, and it was briefly misfiled as if it were. Telegram is
 * a way for a *person* to choose a picture — a deep link, a chat, buttons, a
 * tap — and it is implemented in `telegram-image-bot`, where every step
 * involves a human. Generation has no human in it: an author typed a topic and
 * is waiting. So it gets its own door with its own name, and a picture found
 * here is recorded as found here.
 *
 * Nothing about the decision differs. Both doors open onto the same
 * ImageResolver, which is the one place that knows a named person from a place
 * from an idea, that prefers a picture an administrator has confirmed, and that
 * answers with nothing at all rather than with the wrong face. Providers are
 * never called from here.
 *
 * Server-to-server only. No bot token is involved, which is why automatic
 * illustration works today while manual selection waits for one.
 */
import { createClient } from "npm:@supabase/supabase-js";

import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { downloadRemoteImage } from "../_shared/image-download.ts";
import { resolveImage } from "../_shared/image-resolver.ts";

/**
 * Stamped on every answer and stored with the picture.
 *
 * A deck's pictures should say which service found them, not only which index
 * they came from — otherwise "did generation actually go through the resolver"
 * is a question only the source code can answer, and source code is not
 * evidence about a deck somebody generated last week. It says
 * `image-resolution-service` because that is what ran; `telegram` belongs on a
 * picture only when a person chose it in Telegram.
 */
const SERVICE_NAME = "image-resolution-service";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Body = {
  action?: "resolve";
  ownerId?: string;
  presentationId?: string;
  query?: string;
  title?: string | null;
  topic?: string | null;
  orientation?: "landscape" | "portrait" | "square" | "any";
  stylePreference?: string | null;
  slideIndex?: number;
  imageSlot?: string | null;
  /** Subjects this deck has already illustrated, so one is not repeated. */
  used?: string[];
};

function serverClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("supabase_server_environment_incomplete");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function queryText(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new HttpError(400, "Rasm so‘rovini yozing.", "missing_query");
  if (text.length > 200) throw new HttpError(400, "Rasm so‘rovi juda uzun.", "query_too_long");
  return text;
}

function errorCode(error: unknown): string {
  if (error instanceof HttpError) return error.code;
  if (error instanceof Error && error.message) return error.message.slice(0, 64);
  return "unknown";
}

/**
 * The automatic door, opened by what a caller can do rather than by what it
 * knows.
 *
 * This function is reachable without a JWT — Telegram's webhook cannot present
 * one — so the automatic action has to lock itself. The obvious lock is to
 * compare the bearer token against the service role key, and it is the wrong
 * one: the platform issues that credential in more than one format, and a
 * string comparison quietly refuses a legitimate server the day the format
 * changes. It refused ours.
 *
 * So the credential is put to work instead. Listing accounts is something only
 * the server may do; a signed-in person's token and the public key both fail
 * it. That is a fact about authority rather than about spelling, and it stays
 * true through every key rotation and format change.
 */
async function requireServerCaller(request: Request): Promise<void> {
  const offered = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("supabase_server_environment_incomplete");
  if (!offered) throw new HttpError(403, "Forbidden: no_authorization_header", "forbidden");
  const probe = createClient(url, offered, { auth: { persistSession: false, autoRefreshToken: false } });
  const allowed = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
  // The refusal names itself. An authorisation error is not secret material,
  // and a door that will not say why it is shut cannot be fixed from outside.
  if (allowed.error) throw new HttpError(403, `Forbidden: ${allowed.error.message}`, "forbidden");
}

/**
 * One picture, found and stored, for a slide nobody is looking at yet.
 */
async function resolve(request: Request, body: Body): Promise<Response> {
  await requireServerCaller(request);

  const ownerId = (body.ownerId ?? "").trim();
  const presentationId = (body.presentationId ?? "").trim();
  if (!UUID.test(ownerId) || !UUID.test(presentationId)) {
    throw new HttpError(400, "Taqdimot yoki egasi yaroqsiz.", "invalid_target");
  }
  const query = queryText(body.query);
  const slideIndex = Number.isSafeInteger(body.slideIndex) ? Number(body.slideIndex) : null;
  const imageSlot = typeof body.imageSlot === "string" && body.imageSlot.trim() ? body.imageSlot.trim() : null;
  const used = new Set((Array.isArray(body.used) ? body.used : []).filter((value) => typeof value === "string"));
  const where = { presentation_id: presentationId, slide_index: slideIndex, image_slot: imageSlot };

  console.log(JSON.stringify({ event: "image_resolution_started", ...where, query_length: query.length, used: used.size }));
  const service = serverClient();

  let resolved;
  try {
    resolved = await resolveImage(service, {
      query,
      title: body.title ?? null,
      topic: body.topic ?? null,
      orientation: body.orientation ?? "landscape",
      stylePreference: body.stylePreference ?? null,
      used,
    });
  } catch (error) {
    // A resolver that fails costs the deck a picture, never the deck. The
    // caller is told plainly rather than left to time out.
    console.error(JSON.stringify({ event: "image_resolution_failed", ...where, reason: errorCode(error) }));
    return json({ status: "error", reason: errorCode(error) });
  }

  console.log(JSON.stringify({
    event: "image_resolver_result", ...where,
    status: resolved.status, intent: resolved.intent, provider: resolved.provider,
    entity: resolved.normalized, confidence: resolved.confidence, reason: resolved.reason,
  }));

  if (resolved.status === "no_image" || !resolved.hit) {
    console.log(JSON.stringify({ event: "image_no_image", ...where, intent: resolved.intent, reason: resolved.reason }));
    return json({ status: "no_image", intent: resolved.intent, entity: resolved.normalized, reason: resolved.reason });
  }

  /**
   * A confirmed picture is already in the bucket: nothing to fetch, nothing to
   * store, and the same file every time somebody asks for this subject.
   */
  if (resolved.status === "verified" && resolved.storagePath) {
    console.log(JSON.stringify({
      event: "image_selected", ...where, provider: "verified",
      intent: resolved.intent, entity: resolved.normalized,
    }));
    return json({
      status: "selected", service: SERVICE_NAME, provider: "verified", intent: resolved.intent, entity: resolved.normalized,
      bucket: "stock-images", path: resolved.storagePath,
      width: resolved.hit.width, height: resolved.hit.height,
      mimeType: null, attribution: resolved.hit.attribution,
    });
  }

  let stored;
  try {
    const { bytes, image } = await downloadRemoteImage(resolved.hit.url);
    console.log(JSON.stringify({
      event: "image_downloaded", ...where, provider: resolved.provider,
      bytes: bytes.byteLength, mime: image.mimeType, width: image.width, height: image.height,
    }));
    const path = `${ownerId}/${presentationId}/${crypto.randomUUID()}.${image.extension}`;
    const upload = await service.storage.from("stock-images").upload(path, bytes, {
      contentType: image.mimeType,
      upsert: false,
    });
    if (upload.error) throw new Error("image_store_failed");
    stored = { path, image };
  } catch (error) {
    console.error(JSON.stringify({ event: "image_resolution_failed", ...where, provider: resolved.provider, reason: errorCode(error) }));
    return json({ status: "error", reason: errorCode(error) });
  }

  console.log(JSON.stringify({
    event: "image_selected", ...where, provider: resolved.provider,
    intent: resolved.intent, entity: resolved.normalized, confidence: resolved.confidence,
  }));
  return json({
    status: "selected",
    service: SERVICE_NAME,
    provider: resolved.provider,
    intent: resolved.intent,
    entity: resolved.normalized,
    bucket: "stock-images",
    path: stored.path,
    width: stored.image.width,
    height: stored.image.height,
    mimeType: stored.image.mimeType,
    // Whatever the provider said, unchanged: a credit line the system rewrote
    // is a credit line nobody can check against the source.
    attribution: resolved.hit.attribution,
  });
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  try {
    const body = await bodyJson<Body>(request, 32_000);
    if (body.action && body.action !== "resolve") throw new HttpError(400, "Noma’lum amal.", "invalid_action");
    return await resolve(request, body);
  } catch (error) {
    return errorResponse(error);
  }
});
