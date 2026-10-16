import { hasCyrillic, isDeckLanguage } from "../_shared/glass/language.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js";

import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { readDesignRequest, type DesignRequest } from "../_shared/glass/dna.ts";
import { runGenerationPipeline } from "../_shared/pipeline.ts";
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
  /**
   * The J Tanga the author agreed to on the price screen. Sent by builds that
   * show the page price; when the price has risen past it the deck is not
   * started and they are asked again. Older builds leave it out.
   */
  confirmedCoins?: number | null;
  /** The language the deck is written in: `uz` (Latin), `en` or `ru`. Older builds leave it out — Uzbek. */
  language?: string | null;
  /** What the author wants of the deck, in their own words: tone, depth, what to include. */
  requirements?: string | null;
  /**
   * The author's design choice, when "Avtomatik dizayn" was turned off:
   * `{ style: "glass" | "editorial" | "soft3d", palette: <family> | null }`.
   * Absent or unreadable means automatic.
   */
  design?: unknown;
  /** Accepted from older builds and ignored: every deck's design is invented for it. */
  paletteCode?: string;
  designSlug?: string;
  retry?: boolean;
};

const styles = new Set<PresentationStyle>(["simple", "good", "great", "super_professional"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The author's requirements, as plain text the prompts can quote safely. */
function requirementsOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F]/g, "").trim().slice(0, 2_000);
  return text || null;
}

/** Writes the design choice onto the job, keeping whatever else its context holds. */
async function rememberDesign(service: SupabaseClient, jobId: string, design: DesignRequest): Promise<void> {
  const current = await service.from("generation_jobs").select("context").eq("id", jobId).maybeSingle();
  const context = (current.data?.context && typeof current.data.context === "object" ? current.data.context : {}) as Record<string, unknown>;
  const saved = await service.from("generation_jobs").update({ context: { ...context, design } }).eq("id", jobId);
  if (saved.error) console.error(JSON.stringify({ event: "design_not_remembered", job_id: jobId, reason: saved.error.message }));
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
      // A retry is the same deck: it keeps the design its first job was asked for.
      const earlier = await context.serviceClient.from("generation_jobs").select("context")
        .eq("presentation_id", body.presentationId).eq("owner_id", context.user.id).neq("id", job.job_id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const carried = readDesignRequest((earlier.data?.context as { design?: unknown } | null)?.design);
      if (carried) await rememberDesign(context.serviceClient, job.job_id, carried);
    } else {
      if (!body.topic || body.topic.trim().length < 3 || body.topic.length > 2000) throw new HttpError(400, "Topic must be 3–2000 characters", "invalid_topic");
      if (!body.style || !styles.has(body.style)) throw new HttpError(400, "Presentation style is invalid", "invalid_style");
      const language = body.language == null ? null : String(body.language);
      if (language !== null && !isDeckLanguage(language)) throw new HttpError(400, "Taqdimot tili noto‘g‘ri.", "invalid_language");
      // An Uzbek deck is written in Latin; the database refuses it too.
      if ((language ?? "uz") === "uz" && (hasCyrillic(body.topic) || hasCyrillic(body.title ?? ""))) {
        throw new HttpError(400, "Mavzuni lotin yozuvida kiriting.", "cyrillic_topic");
      }

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
       * No design is chosen here, by anybody.
       *
       * The published-design catalogue (JSLAYD) and the PowerPoint templates
       * are retired: every deck's look is invented for it by the Liquid Glass
       * engine during generation. A slug or palette sent by an older build is
       * read and dropped, never forwarded, so no path can reach a retired
       * design.
       */
      console.log(JSON.stringify({ event: "design_selection_skipped", presentation_id: body.presentationId, DESIGN_ENGINE: "glass_v1" }));
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
        p_palette_code: null,
        p_design_slug: null,
        // Only sent when the app sent it, so a build that predates page
        // pricing calls the function exactly as it always has.
        ...(Number.isInteger(body.confirmedCoins) && (body.confirmedCoins as number) >= 0
          ? { p_confirmed_coins: body.confirmedCoins }
          : {}),
        ...(language ? { p_language: language } : {}),
      });
      if (error) throw new HttpError(error.code === "P0001" ? 402 : 400, error.message, error.code ?? "generation_start_failed");
      job = data?.[0] as typeof job;
      if (!job) throw new Error("Generation RPC returned no job");

      const requirements = requirementsOf(body.requirements);
      // Only a style and a family from the known lists are ever stored.
      const design = readDesignRequest(body.design);
      if (design) {
        // On the job first: nothing constrains that column, so the choice
        // reaches the generator even when the deck's own column refuses it.
        await rememberDesign(context.serviceClient, job.job_id, design);
      }
      if (requirements) {
        const stored = await context.serviceClient.from("presentations")
          .update({ requirements })
          .eq("id", body.presentationId).eq("owner_id", context.user.id);
        // Worth a line, never a failed deck: the requirements steer the copy,
        // and a deck made without them is still the deck that was paid for.
        if (stored.error) console.error(JSON.stringify({ event: "requirements_not_stored", presentation_id: body.presentationId, reason: stored.error.message }));
      }
      if (design) {
        // Separately, so a style the column does not list yet costs only this
        // record — never the requirements written above.
        const stored = await context.serviceClient.from("presentations")
          .update({ design_request: design })
          .eq("id", body.presentationId).eq("owner_id", context.user.id);
        if (stored.error) console.error(JSON.stringify({ event: "design_request_not_stored", presentation_id: body.presentationId, style: design.style, reason: stored.error.message }));
      }
      console.log(JSON.stringify({ event: "design_request", presentation_id: body.presentationId, style: design?.style ?? "auto", palette: design?.palette ?? null }));

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
        // Tariff months that ran out unrenewed burn here for everyone, as well
        // as for each person when they next touch their wallet.
        const { data: expired, error: expireError } = await context.serviceClient.rpc("expire_coin_lots", { p_user_id: null });
        if (expireError && expireError.code !== "PGRST202") console.error("tariff expiry failed", expireError.message);
        else if (expired) console.log(JSON.stringify({ event: "tariff_months_expired", count: expired }));
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
