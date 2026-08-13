/**
 * The deck a paired projector is allowed to draw.
 *
 * The browser showing a presentation is signed out — that is the whole point of
 * pairing by QR — so it cannot be given the deck under row-level security the
 * way a signed-in client is. What it holds instead is a per-session capability:
 * an unguessable token minted when the session was opened, stored only as a
 * hash, and worthless once the session ends.
 *
 * The order of checks is the design. `presentation_screen_snapshot` is asked
 * first, and it is the only thing that decides whether this request is allowed:
 * it hashes the presented token, matches it against the session row, and
 * refuses unless that session is `active` — which it only becomes once a
 * signed-in phone has claimed it. Every identifier used afterwards comes back
 * from that call rather than from the request body, so a caller cannot name a
 * presentation, an owner, or a storage object of their choosing.
 *
 * The service role is used after that, and only within those bounds:
 *   * one presentation — the one the session is showing;
 *   * its owner's rows only;
 *   * render fields only, so nothing about who owns it travels to the screen;
 *   * storage objects only under `{owner}/{presentation}/`, which is where both
 *     the generator and the importer write, so an element whose content points
 *     somewhere else is dropped rather than signed.
 *
 * Signed URLs last an hour: shorter than the four-hour session ceiling, long
 * enough that a talk does not stall reloading images. Accepted risk, stated
 * plainly: while a session is active, whoever holds its screen token can read
 * that deck. Ending the talk ends that.
 */
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { createClient } from "npm:@supabase/supabase-js";

type Body = { sessionId?: string; screenToken?: string };

/** The two buckets slide images are ever written to. */
const IMAGE_BUCKETS = new Set(["generated-images", "presentation-assets"]);
const SIGNED_URL_SECONDS = 60 * 60;

type Snapshot = {
  session_id: string;
  presentation_id: string | null;
  deck_revision: number;
};

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("Supabase server environment is incomplete");

    const body = await bodyJson<Body>(request);
    const sessionId = body.sessionId?.trim();
    const screenToken = body.screenToken?.trim();
    if (!sessionId || !screenToken) {
      throw new HttpError(400, "sessionId and screenToken are required", "invalid_request");
    }

    const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // The capability check. Nothing below runs unless this passes, and every
    // identifier below comes from its result rather than from the caller.
    const validated = await service.rpc("presentation_screen_snapshot", {
      p_session_id: sessionId,
      p_screen_token: screenToken,
    });
    if (validated.error) throw new HttpError(403, "Ekran uchun ruxsat yaroqsiz.", "screen_capability_invalid");
    const snapshot = validated.data as unknown as Snapshot;

    if (!snapshot.presentation_id) {
      // Paired, but the phone has not chosen a deck yet. That is a state, not a
      // failure, and the screen renders a waiting frame for it.
      return json({ title: "Taqdimot", slides: [], elements: [], deckRevision: snapshot.deck_revision });
    }

    const presentation = await service
      .from("presentations")
      .select("id,owner_id,title")
      .eq("id", snapshot.presentation_id)
      .single();
    if (presentation.error) throw new HttpError(404, "Taqdimot topilmadi.", "presentation_missing");
    const { owner_id: ownerId, id: presentationId, title } = presentation.data;

    const slides = await service
      .from("slides")
      .select("id,position,title,layout,background")
      .eq("presentation_id", presentationId)
      .eq("owner_id", ownerId)
      .order("position");
    if (slides.error) throw slides.error;

    const elements = await service
      .from("slide_elements")
      .select("id,slide_id,type,x,y,width,height,rotation,z_index,opacity,locked,style,content")
      .eq("presentation_id", presentationId)
      .eq("owner_id", ownerId)
      .order("z_index");
    if (elements.error) throw elements.error;

    const rendered = [];
    for (const element of elements.data) {
      if (element.type !== "image") {
        rendered.push(element);
        continue;
      }
      const signed = await signImage(service, element.content, ownerId, presentationId);
      // An image we will not sign is an image the screen cannot draw. Sending it
      // anyway would render an empty box over the slide.
      if (signed) rendered.push({ ...element, content: signed });
    }

    return json({
      title: typeof title === "string" && title ? title : "Taqdimot",
      slides: slides.data,
      elements: rendered,
      deckRevision: snapshot.deck_revision,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message, code: error.code }, error.status);
    }
    return errorResponse(error);
  }
});

/**
 * Signs one image, or refuses.
 *
 * The path is checked against the prefix the writers use rather than merely
 * against the owner, so an element pointing at another deck of the same owner
 * is refused too — the screen was paired to one presentation, not to a library.
 */
async function signImage(
  service: ReturnType<typeof createClient>,
  content: unknown,
  ownerId: string,
  presentationId: string,
): Promise<Record<string, unknown> | null> {
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const record = content as Record<string, unknown>;
  const bucket = typeof record.storageBucket === "string" ? record.storageBucket : null;
  const path = typeof record.storagePath === "string" ? record.storagePath : null;
  if (!bucket || !path || !IMAGE_BUCKETS.has(bucket)) return null;
  if (path.includes("..") || !path.startsWith(`${ownerId}/${presentationId}/`)) return null;

  const signed = await service.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) return null;

  // The storage coordinates stay behind: the screen needs a URL it can fetch,
  // not the location of the object inside the project.
  const { storageBucket: _bucket, storagePath: _path, ...rest } = record;
  return { ...rest, signedUrl: signed.data.signedUrl };
}
