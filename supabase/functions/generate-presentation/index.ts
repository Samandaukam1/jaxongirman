import { requestContext, privacySafeIdentifier } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
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
  templateCode?: string;
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
      if (!Number.isInteger(body.slideCount) || (body.slideCount ?? 0) < 1 || (body.slideCount ?? 0) > 30) throw new HttpError(400, "Slide count must be 1–30", "invalid_slide_count");
      const sources = Array.isArray(body.sources) ? body.sources.map((source) => String(source).trim()).filter(Boolean).slice(0, 30) : [];
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
        p_template_code: designCode(body.templateCode),
        p_palette_code: designCode(body.paletteCode),
        // An unknown or unpublished slug resolves to nothing and the deck
        // takes the built-in path, exactly as an unknown template code does.
        p_design_slug: designSlug(body.designSlug),
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

    if (!job?.job_id) throw new Error("Generation job was not created");
    const safetyIdentifier = await privacySafeIdentifier(context.user.id);
    const pipeline = runGenerationPipeline({ jobId: job.job_id, presentationId: body.presentationId, ownerId: context.user.id, service: context.serviceClient, safetyIdentifier });
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(pipeline);
    else await pipeline;

    return json({ presentationId: body.presentationId, jobId: job.job_id, estimatedCredits: job.estimated_credits, status: "queued" }, 202);
  } catch (error) {
    return errorResponse(error);
  }
});
