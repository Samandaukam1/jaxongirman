/**
 * The spoken script that goes with a deck.
 *
 * Two things happen here and they are deliberately one function. `write`
 * produces the script and stores it; `pdf` renders what is stored into a file a
 * person can print and hold. Splitting them would mean two deployments, two
 * auth checks and two places to keep the document's shape in step, for a
 * document written once and read many times.
 *
 * The generator calls this at the end of a deck and does not wait: a script
 * that fails must never cost somebody the deck it belongs to. The app calls it
 * too — for a deck made before this existed, and to rewrite one whose deck has
 * since been edited.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js";

import { createClient } from "npm:@supabase/supabase-js";

import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import {
  DEFENSE_SCHEMA_NAME, DEFENSE_SYSTEM, defensePrompt, defenseSchema, isUsable, readDefense,
  type DefenseScript, type DefenseSlide,
} from "../_shared/defense.ts";
import { renderDefensePdf } from "../_shared/defense-pdf.ts";
import { geminiWriter } from "../_shared/gemini.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { ProviderUnavailable } from "../_shared/writer.ts";

type Body = { presentationId?: string; action?: "write" | "pdf" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The service client, for the internal path that has no `requestContext`. */
function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase server environment is incomplete");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * The deck as the writer needs to see it: what each slide says, in order.
 *
 * Read from `slide_elements` rather than from anything the generator held in
 * memory, so a deck somebody edited produces a script about the deck they have.
 */
async function readDeck(service: SupabaseClient, presentationId: string, ownerId: string) {
  const presentation = await service
    .from("presentations")
    .select("id, title, topic, author_name, teacher_name, updated_at, status")
    .eq("id", presentationId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (presentation.error) throw presentation.error;
  if (!presentation.data) throw new HttpError(404, "Taqdimot topilmadi.", "not_found");
  if (presentation.data.status !== "ready") {
    throw new HttpError(409, "Taqdimot hali tayyor emas.", "not_ready");
  }

  const [slides, elements, profile] = await Promise.all([
    service.from("slides").select("id, position, title").eq("presentation_id", presentationId).order("position"),
    service.from("slide_elements").select("slide_id, type, content").eq("presentation_id", presentationId),
    service.from("profiles").select("organization").eq("id", ownerId).maybeSingle(),
  ]);
  if (slides.error) throw slides.error;
  if (elements.error) throw elements.error;

  const bySlide = new Map<string, string[]>();
  for (const element of elements.data ?? []) {
    if (element.type !== "text") continue;
    const said = String((element.content as { text?: unknown } | null)?.text ?? "").trim();
    if (!said) continue;
    const lines = bySlide.get(element.slide_id) ?? [];
    lines.push(said);
    bySlide.set(element.slide_id, lines);
  }

  const deck: DefenseSlide[] = (slides.data ?? []).map((slide) => ({
    position: slide.position,
    title: slide.title ?? `${slide.position + 1}-slayd`,
    text: (bySlide.get(slide.id) ?? []).join(" · "),
  }));

  return { presentation: presentation.data, deck, organization: profile.data?.organization ?? null };
}

async function write(service: SupabaseClient, presentationId: string, ownerId: string): Promise<DefenseScript> {
  const { presentation, deck, organization } = await readDeck(service, presentationId, ownerId);
  if (deck.length === 0) throw new HttpError(409, "Taqdimotda slayd yo‘q.", "empty_deck");

  const writer = geminiWriter();
  if (!writer.configured) throw new HttpError(503, "AI xizmati sozlanmagan.", "provider_not_configured");

  await service.from("presentation_defenses").upsert({
    presentation_id: presentationId,
    owner_id: ownerId,
    status: "generating",
    failure_reason: null,
  });

  try {
    const prompt = defensePrompt({
      topic: presentation.topic ?? presentation.title,
      authorName: presentation.author_name,
      teacherName: presentation.teacher_name,
      organization,
      slides: deck,
    });
    const answer = await writer.structured<unknown>({
      prompt: `${DEFENSE_SYSTEM}\n\n${prompt}`,
      system: DEFENSE_SYSTEM,
      schemaName: DEFENSE_SCHEMA_NAME,
      schema: defenseSchema(),
      // A minute of speech per slide over a dozen slides, with room to spare.
      maxOutputTokens: 8_000,
      attempts: 2,
    });

    const script = readDefense(answer.data, deck);
    if (!isUsable(script)) throw new Error("script came back mostly empty");

    const stored = await service.from("presentation_defenses").upsert({
      presentation_id: presentationId,
      owner_id: ownerId,
      status: "ready",
      introduction: script.introduction,
      conclusion: script.conclusion,
      sections: script.sections,
      written_for: presentation.updated_at,
      failure_reason: null,
    });
    if (stored.error) throw stored.error;

    await service.from("ai_usage").insert({
      owner_id: ownerId,
      provider: "google",
      model: writer.writingModel,
      operation: "presentation_defense_write",
      input_tokens: answer.usage.input_tokens ?? 0,
      output_tokens: answer.usage.output_tokens ?? 0,
      request_id: answer.requestId,
      metadata: { presentation_id: presentationId, slides: deck.length },
    });

    return script;
  } catch (failure) {
    const reason = failure instanceof ProviderUnavailable ? failure.reason : "unknown";
    console.error(JSON.stringify({
      event: "presentation_defense_failed",
      presentation_id: presentationId,
      reason,
      detail: String((failure as Error)?.message ?? failure).slice(0, 300),
    }));
    await service.from("presentation_defenses").upsert({
      presentation_id: presentationId,
      owner_id: ownerId,
      status: "failed",
      failure_reason: "Himoya matni yozilmadi. Qayta urinib ko‘ring.",
    });
    throw failure;
  }
}

/**
 * Whether this request is the generator, rather than a person.
 *
 * The deck pipeline asks for a script the moment a deck is finished, and it has
 * no session to do it with — it runs as the service role, and `getUser` on a
 * service key is not a user. So one narrow door: the caller must present the
 * service key itself and name the owner outright.
 *
 * Compared in constant time, and only ever here. Widening `requestContext` to
 * accept this would put the same door on every function in the project, most of
 * which have no reason to have one.
 */
function internalOwner(request: Request): string | null {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const presented = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const owner = (request.headers.get("x-owner-id") ?? "").trim();
  if (!key || !presented || !owner || !UUID.test(owner)) return null;
  if (presented.length !== key.length) return null;

  let differences = 0;
  for (let index = 0; index < key.length; index += 1) {
    differences |= presented.charCodeAt(index) ^ key.charCodeAt(index);
  }
  return differences === 0 ? owner : null;
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  try {
    const body = await bodyJson<Body>(request, 4_000);
    const presentationId = (body.presentationId ?? "").trim();
    if (!UUID.test(presentationId)) throw new HttpError(400, "Taqdimot tanlanmadi.", "invalid_presentation_id");

    const internal = internalOwner(request);
    const context = internal ? null : await requestContext(request);
    const service = context ? context.serviceClient : serviceClient();
    const ownerId = internal ?? context!.user.id;

    if (body.action === "pdf") {
      const stored = await service
        .from("presentation_defenses")
        .select("introduction, conclusion, sections, status")
        .eq("presentation_id", presentationId)
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (stored.error) throw stored.error;
      if (!stored.data || stored.data.status !== "ready") {
        throw new HttpError(409, "Himoya matni hali tayyor emas.", "not_ready");
      }

      const presentation = await service
        .from("presentations").select("title, author_name, teacher_name")
        .eq("id", presentationId).eq("owner_id", ownerId).single();
      if (presentation.error) throw presentation.error;

      const bytes = await renderDefensePdf({
        title: presentation.data.title,
        authorName: presentation.data.author_name,
        teacherName: presentation.data.teacher_name,
        script: {
          introduction: stored.data.introduction,
          conclusion: stored.data.conclusion,
          sections: (stored.data.sections ?? []) as never,
        },
      });

      const path = `${ownerId}/${presentationId}/himoya-matni.pdf`;
      const upload = await service.storage.from("exports")
        .upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (upload.error) throw upload.error;

      return json({ ok: true, storagePath: path, sizeBytes: bytes.byteLength });
    }

    /**
     * Writing runs to completion before answering.
     *
     * One request and a few seconds, so there is nothing to poll and no job to
     * invent. The generator that calls this at the end of a deck does not await
     * the response, which is where the not-waiting belongs.
     */
    const script = await write(service, presentationId, ownerId);
    return json({ ok: true, ...script });
  } catch (error) {
    if (error instanceof ProviderUnavailable) {
      return errorResponse(new HttpError(503, "Matn modeli hozir javob bermayapti.", "provider_unavailable"));
    }
    return errorResponse(error);
  }
});
