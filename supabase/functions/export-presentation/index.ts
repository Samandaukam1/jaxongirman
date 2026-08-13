import type { SupabaseClient } from "npm:@supabase/supabase-js";

import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { ExportAssetLoader } from "../_shared/export-assets.ts";
import {
  safeFileName,
  type ExportDeck,
  type ExportElement,
  type ExportFormat,
  type ExportPresentation,
  type ExportSlide,
} from "../_shared/export-model.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { renderPdf } from "../_shared/pdf-export.ts";
import { renderPptx } from "../_shared/pptx-export.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

type Body = { presentationId?: string; format?: ExportFormat | "png" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EXPORT_BYTES = 100 * 1024 * 1024;
const RESULT_LIFETIME_MS = 24 * 60 * 60 * 1000;

async function updateJob(
  service: SupabaseClient,
  jobId: string,
  ownerId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const result = await service.from("export_jobs").update(patch).eq("id", jobId).eq("owner_id", ownerId);
  if (result.error) throw result.error;
}

async function loadDeck(service: SupabaseClient, presentationId: string, ownerId: string): Promise<ExportDeck> {
  const [presentationResult, slidesResult, elementsResult] = await Promise.all([
    service.from("presentations").select("id,title,owner_id").eq("id", presentationId).eq("owner_id", ownerId).eq("status", "ready").single(),
    service.from("slides").select("id,presentation_id,position,title,background").eq("presentation_id", presentationId).eq("owner_id", ownerId).order("position"),
    service.from("slide_elements").select("id,slide_id,presentation_id,type,x,y,width,height,rotation,z_index,opacity,style,content").eq("presentation_id", presentationId).eq("owner_id", ownerId).order("z_index"),
  ]);
  if (presentationResult.error) throw presentationResult.error;
  if (slidesResult.error) throw slidesResult.error;
  if (elementsResult.error) throw elementsResult.error;
  if (!slidesResult.data.length) throw new Error("Presentation has no slides");
  return {
    presentation: presentationResult.data as ExportPresentation,
    slides: slidesResult.data as ExportSlide[],
    elements: elementsResult.data as ExportElement[],
  };
}

function clientFailure(format: ExportFormat): string {
  return format === "pdf"
    ? "PDF yaratilmadi. Qayta urinib ko‘ring."
    : "PowerPoint fayli yaratilmadi. Qayta urinib ko‘ring.";
}

async function generateExport(
  service: SupabaseClient,
  jobId: string,
  presentationId: string,
  ownerId: string,
  format: ExportFormat,
): Promise<void> {
  try {
    await updateJob(service, jobId, ownerId, {
      status: "running",
      progress: 5,
      started_at: new Date().toISOString(),
      error_message: null,
    });

    const deck = await loadDeck(service, presentationId, ownerId);
    await updateJob(service, jobId, ownerId, { progress: 20 });

    const assets = new ExportAssetLoader(service, ownerId, presentationId);
    const bytes = format === "pdf"
      ? await renderPdf(deck, assets)
      : await renderPptx(deck, assets);
    if (!bytes.byteLength || bytes.byteLength > MAX_EXPORT_BYTES) throw new Error("Generated export has an invalid size");
    await updateJob(service, jobId, ownerId, { progress: 85 });

    const fileName = safeFileName(deck.presentation.title, format);
    const storagePath = `${ownerId}/${presentationId}/${jobId}.${format}`;
    const contentType = format === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const upload = await service.storage.from("exports").upload(storagePath, bytes, {
      contentType,
      upsert: false,
      cacheControl: "0",
    });
    if (upload.error) throw upload.error;

    await updateJob(service, jobId, ownerId, {
      status: "succeeded",
      progress: 100,
      storage_path: storagePath,
      size_bytes: bytes.byteLength,
      file_name: fileName,
      completed_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + RESULT_LIFETIME_MS).toISOString(),
    });
  } catch (error) {
    console.error("presentation export failed", {
      jobId,
      presentationId,
      format,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await updateJob(service, jobId, ownerId, {
        status: "failed",
        error_message: clientFailure(format),
        completed_at: new Date().toISOString(),
      });
    } catch (updateError) {
      console.error("export failure status could not be saved", updateError);
    }
  }
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  try {
    const context = await requestContext(request);
    const body = await bodyJson<Body>(request, 16_000);
    const presentationId = body.presentationId?.trim();
    if (!presentationId || !UUID.test(presentationId)) throw new HttpError(400, "Valid presentationId is required", "invalid_presentation_id");
    if (body.format !== "pdf" && body.format !== "pptx") throw new HttpError(400, "Format must be pdf or pptx", "unsupported_format");

    const requested = await context.userClient.rpc("request_export", {
      p_presentation_id: presentationId,
      p_format: body.format,
      p_options: { source: "client" },
    });
    if (requested.error || !requested.data) {
      const status = requested.error?.code === "P0001" ? 429 : 400;
      throw new HttpError(status, requested.error?.message ?? "Export could not be queued", requested.error?.code ?? "export_request_failed");
    }

    const jobId = requested.data as string;
    const pipeline = generateExport(
      context.serviceClient,
      jobId,
      presentationId,
      context.user.id,
      body.format,
    );
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(pipeline);
    else await pipeline;

    return json({ jobId, presentationId, format: body.format, status: "queued" }, 202);
  } catch (error) {
    return errorResponse(error);
  }
});
