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
import { exportByCloning } from "../_shared/pptx-clone-export.ts";
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

/**
 * A template export that could not run, with the reason worth showing.
 *
 * Ordinary export failures are told to the person as one sentence, because the
 * causes are transient and the detail is ours. A template refusal is the
 * opposite: it names something somebody has to fix — a design imported in an
 * old format, a package that is no longer in storage — and hiding that behind
 * "try again" produces a person trying again forever.
 */
class TemplateExportError extends Error {}

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

    /**
     * A deck made from a PowerPoint template is not drawn — it is that
     * template with the chosen pages kept and their words replaced.
     *
     * Only for `.pptx`: a PDF has to be drawn whatever the design came from,
     * because nothing here can print an OOXML package. That is the split the
     * rule allows — preview and PDF do their best, and the PowerPoint file the
     * customer opens is the original one.
     */
    const cloned = format === "pptx" ? await cloneIfTemplate(service, presentationId) : null;
    if (cloned && !cloned.ok) {
      // Refused rather than redrawn. An approximation that looks like the
      // design was recreated is the one outcome this mode exists to prevent.
      //
      // Marked so the failure handler shows this sentence rather than the
      // generic one: "the template's pages are not linked, re-import it" is
      // something an admin can act on, and "try again" is not.
      throw new TemplateExportError(cloned.reason);
    }

    const bytes = cloned?.ok
      ? cloned.bytes
      : format === "pdf"
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
        error_message: error instanceof TemplateExportError ? error.message : clientFailure(format),
        completed_at: new Date().toISOString(),
      });
    } catch (updateError) {
      console.error("export failure status could not be saved", updateError);
    }
  }
}

/**
 * The clone path, when this deck was laid out on a PowerPoint template.
 *
 * Returns null only where the question does not apply — a deck of a written
 * design — and the ordinary exporter runs untouched. Everything else is a
 * refusal with a reason.
 *
 * Which deck this is comes from the slides rather than from the design row.
 * The slides record the engine that must produce them at the moment they were
 * generated, and they are the thing being exported; the design can be archived,
 * republished or deleted afterwards, and none of that changes what these slides
 * are. Reading the design first is how a deck whose template was deleted would
 * quietly come back as a drawing of it.
 */
async function cloneIfTemplate(service: SupabaseClient, presentationId: string) {
  const slides = await service
    .from("slides").select("id, position, quality_report").eq("presentation_id", presentationId);
  if (slides.error) {
    return { ok: false as const, reason: "Taqdimot sahifalari o‘qilmadi. Qayta urinib ko‘ring." };
  }

  const cloned = (slides.data ?? []).some((slide) =>
    (slide.quality_report as { engine?: unknown } | null)?.engine === "pptx_clone");
  if (!cloned) return null;

  const presentation = await service
    .from("presentations")
    .select("design_id, design_version")
    .eq("id", presentationId)
    .maybeSingle();
  if (presentation.error) {
    return { ok: false as const, reason: "Taqdimot ma’lumoti o‘qilmadi. Qayta urinib ko‘ring." };
  }
  if (!presentation.data?.design_id) {
    return {
      ok: false as const,
      reason: "Bu taqdimot yaratilgan PowerPoint shabloni o‘chirilgan, shuning uchun .pptx fayl tayyorlab bo‘lmaydi. PDF sifatida yuklab olishingiz mumkin.",
    };
  }

  const design = await service
    .from("presentation_designs")
    .select("design_source, source_asset_path, published_version")
    .eq("id", presentation.data.design_id)
    .maybeSingle();
  if (design.error || !design.data) {
    // Which kind of design this is decides which engine runs, so not knowing
    // is not a reason to pick one.
    return { ok: false as const, reason: "Dizayn ma’lumoti o‘qilmadi. Qayta urinib ko‘ring." };
  }

  const path = design.data.source_asset_path;
  if (!path) {
    return { ok: false as const, reason: "Shablon fayli topilmadi — dizaynni qayta import qiling." };
  }

  const version = presentation.data.design_version ?? design.data.published_version ?? 1;
  const [profiles, file] = await Promise.all([
    service.from("design_slide_profiles")
      .select("archetype_id, source_slide_part, text_map")
      .eq("design_id", presentation.data.design_id)
      .eq("design_version", version),
    service.storage.from("design-source").download(path),
  ]);

  /**
   * Every failure from here is a refusal, never a fallback.
   *
   * Drawing this deck instead would ship a file that looks like somebody
   * recreated the design by hand, which is the one outcome this mode exists to
   * prevent. A database error, a missing package and an unlinked page all stop
   * the export with a sentence.
   */
  if (profiles.error) {
    return { ok: false as const, reason: "Dizayn sahifalari o‘qilmadi. Qayta urinib ko‘ring." };
  }
  if (file.error || !file.data) {
    return { ok: false as const, reason: "Shablon fayli o‘qilmadi." };
  }
  if ((profiles.data ?? []).length === 0) {
    return { ok: false as const, reason: "Dizayn sahifalari shablonga bog‘lanmagan — qayta import qiling." };
  }

  const elements = await service
    .from("slide_elements")
    .select("slide_id, type, content")
    .in("slide_id", (slides.data ?? []).map((slide) => slide.id));
  if (elements.error) {
    return { ok: false as const, reason: "Slayd elementlari o‘qilmadi. Qayta urinib ko‘ring." };
  }

  const ordered = [...(slides.data ?? [])].sort((first, second) => first.position - second.position);
  const cloned = await exportByCloning(
    new Uint8Array(await file.data.arrayBuffer()),
    ordered as never,
    (elements.data ?? []) as never,
    (profiles.data ?? []) as never,
  );

  /**
   * What the clone actually did, recorded on the slides it made.
   *
   * The generator writes what it intends — which source slide, how many boxes —
   * and only the export can say what happened: how many boxes were replaced,
   * whether any template copy survived, whether the page came through with its
   * shapes and its pictures. Both halves in one place is what makes the record
   * answerable later, when somebody asks why one deck looks wrong.
   *
   * A failure here is not a failure of the export. The file is already correct
   * or already refused; this is the note about it.
   */
  if (cloned.ok) {
    await Promise.all(cloned.report.slides.map((page, index) => {
      const slide = ordered[index];
      if (!slide) return Promise.resolve();
      return service.from("slides").update({
        quality_report: {
          ...(slide.quality_report as Record<string, unknown> ?? {}),
          engine: "pptx_clone",
          text_objects_found: page.textObjectsFound,
          text_objects_replaced: page.textObjectsReplaced,
          template_text_remaining: cloned.report.leftoverText.length,
          non_text_objects_preserved: page.nonTextObjectsPreserved,
          structural_fidelity_passed: page.structuralFidelityPassed,
        },
      }).eq("id", slide.id);
    })).catch((error) => console.error("clone report not saved", error));
  }

  return cloned;
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
