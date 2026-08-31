import { requestContext } from "../_shared/auth.ts";
import { chooseDesign } from "../_shared/design-choice.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { runGenerationPipeline } from "../_shared/pipeline.ts";
import { generativeEnabled } from "../_shared/scene-generation.ts";
import type { PresentationStyle } from "../_shared/presentation-types.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

type RequestBody = {
  presentationId?: string;
  topic?: string;
  title?: string;
  style?: PresentationStyle;
  slideCount?: number;
  authorName?: string | null;
  teacherName?: string | null;
  sources?: string[];
  uploadPaths?: string[];
  idempotencyKey?: string;
  paletteCode?: string;
  designSlug?: string;
  retry?: boolean;
};

const styles = new Set<PresentationStyle>(["simple", "good", "great", "super_professional"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const codePattern = /^[a-z0-9_]{3,40}$/;
/** JSLAYD slugs are hyphenated rather than underscored. */
const slugPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Unknown codes are passed as null; the RPC then falls back to the defaults. */
function designCode(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && codePattern.test(trimmed) ? trimmed : null;
}

function designSlug(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 64 && slugPattern.test(trimmed) ? trimmed : null;
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const context = await requestContext(request);
    const body = await bodyJson<RequestBody>(request);
    if (!body.presentationId || !uuidPattern.test(body.presentationId)) throw new HttpError(400, "Valid presentationId is required", "invalid_presentation_id");

    let job: { presentation_id: string; job_id: string; estimated_credits: number };
    if (body.retry) {
      const { count, error: countError } = await context.serviceClient.from("generation_jobs").select("id", { count: "exact", head: true }).eq("presentation_id", body.presentationId).eq("owner_id", context.user.id);
      if (countError) throw countError;
      const key = body.idempotencyKey?.trim() || `${body.presentationId}:retry:${(count ?? 0) + 1}`;
      const { data, error } = await context.userClient.rpc("retry_generation", { p_presentation_id: body.presentationId, p_idempotency_key: key });
      if (error) throw new HttpError(error.code === "P0001" ? 402 : 400, error.message, error.code ?? "retry_failed");
      job = data?.[0] as typeof job;
    } else {
      if (!body.topic || body.topic.trim().length < 3 || body.topic.length > 2000) throw new HttpError(400, "Topic must be 3–2000 characters", "invalid_topic");
      if (!body.style || !styles.has(body.style)) throw new HttpError(400, "Presentation style is invalid", "invalid_style");

      /**
       * A style the operator has switched off is not on offer.
       *
       * The phone reads the enabled list, but the check belongs here: an older
       * build, a cached screen or a direct call would otherwise start a deck in
       * a tier the catalogue no longer publishes designs for, and the failure
       * would arrive minutes later as "no design available" after the credits
       * were reserved.
       */
      const tier = await context.serviceClient
        .from("style_configs")
        .select("is_active,label")
        .eq("style", body.style)
        .maybeSingle();
      if (tier.data && tier.data.is_active === false) {
        throw new HttpError(422, `«${tier.data.label}» uslubi hozircha yopiq.`, "style_disabled");
      }
      if (!Number.isInteger(body.slideCount) || (body.slideCount ?? 0) < 1 || (body.slideCount ?? 0) > 30) throw new HttpError(400, "Slide count must be 1–30", "invalid_slide_count");
      const sources = Array.isArray(body.sources) ? body.sources.map((source) => String(source).trim()).filter(Boolean).slice(0, 30) : [];

      /**
       * The template selector, and the runs it must not run on.
       *
       * `chooseDesign` ranks the published JSLAYD designs and returns the one a
       * deck will be laid into. Under the generative engine there is nothing
       * for it to choose: the deck is composed page by page and a slug pinned
       * here would be a template the deck never uses, recorded as though it
       * had. So the selector is skipped entirely rather than run and ignored —
       * a bypass you can see in the log, not one you have to infer from a
       * column that gets nulled later.
       *
       * Under JSLAYD it behaves exactly as before: "Jaxongir AI tanlaydi" is
       * the default on the phone, so most decks arrive with a topic and no
       * slug, and the ranking fills it in before the RPC.
       */
      const generative = await generativeEnabled(context.serviceClient);
      let chosenDesign: string | null = null;
      if (generative) {
        console.log(JSON.stringify({
          event: "design_selection_skipped",
          presentation_id: body.presentationId,
          DESIGN_ENGINE: "generative_v1",
          LEGACY_TEMPLATE_USED: false,
        }));
      } else {
        chosenDesign = designSlug(body.designSlug);
        if (!chosenDesign) {
          const automatic = await chooseDesign(context.serviceClient, {
            tier: body.style,
            topic: body.topic.trim(),
            // So a person's own recent decks can step aside for a new one.
            userId: context.user.id,
          });
          if (!automatic) {
            throw new HttpError(422, "Bu uslub uchun nashr qilingan dizayn topilmadi.", "no_design_available");
          }
          chosenDesign = automatic.slug;
          // Which subjects decided it, so a surprising choice can be explained
          // without re-running the ranking. Never the topic itself.
          console.log("design chosen automatically", JSON.stringify({
            tier: body.style, slug: automatic.slug, score: automatic.score, matched: automatic.matched,
            // True only when every published design in the tier was used recently.
            repeated: automatic.repeated,
          }));
        }
      }

      const { data, error } = await context.userClient.rpc("start_generation", {
        p_presentation_id: body.presentationId,
        p_topic: body.topic.trim(),
        p_title: (body.title ?? body.topic).trim().slice(0, 180),
        p_style: body.style,
        p_slide_count: body.slideCount!,
        p_author_name: body.authorName?.trim().slice(0, 120) || undefined,
        p_teacher_name: body.teacherName?.trim().slice(0, 120) || undefined,
        p_sources: sources,
        p_idempotency_key: body.idempotencyKey?.trim() || body.presentationId,
        p_template_code: null,
        p_palette_code: designCode(body.paletteCode),
        // Null under the generative engine, where no design is used and none
        // may be recorded. Under JSLAYD it is a published slug: an unknown or
        // unpublished one is refused by the RPC before a credit is reserved,
        // and there is no built-in path left for it to fall to.
        p_design_slug: chosenDesign,
      });
      if (error) throw new HttpError(error.code === "P0001" ? 402 : 400, error.message, error.code ?? "generation_start_failed");
      job = data?.[0] as typeof job;
      if (!job) throw new Error("Generation RPC returned no job");

      const prefix = `${context.user.id}/${body.presentationId}/`;
      const uploadPaths = Array.isArray(body.uploadPaths) ? [...new Set(body.uploadPaths.map(String))].filter((path) => path.startsWith(prefix)).slice(0, 8) : [];
      if (uploadPaths.length) {
        const { error: assetError } = await context.serviceClient.from("presentation_assets").insert(uploadPaths.map((path) => ({ presentation_id: body.presentationId, owner_id: context.user.id, kind: "upload", storage_bucket: "user-uploads", storage_path: path })));
        if (assetError) {
          await context.serviceClient.rpc("fail_generation", { p_job_id: job.job_id, p_error_code: "asset_registration_failed", p_error_message: assetError.message });
          throw assetError;
        }
      }
    }

    /**
     * Sweep the jobs nothing is working on any more.
     *
     * Done here rather than on a schedule because this is the one moment the
     * system is guaranteed to be awake, and because a stranded reservation is
     * most likely to matter to the person who is standing here about to spend
     * credits again. It costs one indexed query, never blocks the generation it
     * runs beside, and is safe to call as often as it is reached: the function
     * refuses a job that has already ended.
     */
    context.serviceClient.rpc("fail_stale_generations", { p_stale_minutes: 8 })
      .then(async ({ data, error }) => {
        if (error) { console.error("stale sweep failed", error.message); return; }
        if (data) console.log(JSON.stringify({ event: "stale_jobs_failed", count: data }));
        // And the holds whose job row is gone entirely, which the sweep above
        // cannot see because it walks jobs.
        const { data: freed, error: reconcileError } = await context.serviceClient.rpc("reconcile_credit_reservations");
        if (reconcileError) console.error("reservation reconcile failed", reconcileError.message);
        else if (freed) console.log(JSON.stringify({ event: "reservations_released", wallets: freed }));
      })
      .catch(() => {});

    if (!job?.job_id) throw new Error("Generation job was not created");
    const pipeline = runGenerationPipeline({ jobId: job.job_id, presentationId: body.presentationId, ownerId: context.user.id, service: context.serviceClient });
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(pipeline);
    else await pipeline;

    return json({ presentationId: body.presentationId, jobId: job.job_id, estimatedCredits: job.estimated_credits, status: "queued" }, 202);
  } catch (error) {
    return errorResponse(error);
  }
});
