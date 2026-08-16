/**
 * Turning an uploaded .pptx into an editable deck.
 *
 * The client uploads the file to its own folder in `user-uploads` and sends the
 * path; this function reads it, converts it, and writes the same rows the
 * generator writes. The upload is a separate step on purpose — a 50 MB body
 * through a function is a bad trade when storage already accepts one directly
 * and enforces per-user folders while doing it.
 *
 * The presentation row is opened by the *caller's* client, so ownership comes
 * from their JWT. Everything after that runs as the service role, which is why
 * the path is checked against the same user id before a byte is read.
 */
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { readPptx, PptxError, type ImportedElement } from "../_shared/pptx.ts";
import { unzip, ZipError } from "../_shared/unzip.ts";

type Body = { storagePath?: string; sourceName?: string; step?: "quote" | "import" };

const UPLOAD_BUCKET = "user-uploads";
const ASSET_BUCKET = "presentation-assets";
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg",
};

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  let context: Awaited<ReturnType<typeof requestContext>> | null = null;
  let presentationId: string | null = null;
  let chargeKey: string | null = null;

  try {
    context = await requestContext(request);
    const body = await bodyJson<Body>(request);

    /**
     * What it will cost, before anything is spent.
     *
     * Presenting a deck made outside Jaxongirman is an operational cost rather
     * than part of any plan, so a member pays it too. Nobody should discover the
     * price by being charged it, and the price is read from the same list the
     * charge will read — asking twice must not be able to give two answers.
     */
    if (body.step === "quote") {
      const [price, wallet] = await Promise.all([
        context.serviceClient.from("app_settings").select("value").eq("key", "credits.operation_costs").single(),
        context.serviceClient.from("credit_wallets").select("balance").eq("user_id", context.user.id).maybeSingle(),
      ]);
      const cost = Number(
        (price.data?.value as Record<string, { base_credits?: number }> | null)
          ?.external_pptx_present?.base_credits ?? 0,
      );
      const balance = Number(wallet.data?.balance ?? 0);
      return json({ operation: "external_pptx_present", cost, balance, affordable: balance >= cost });
    }

    const storagePath = body.storagePath?.trim();
    if (!storagePath) throw new HttpError(400, "storagePath is required", "invalid_request");

    // The bucket's own policy already confines a user to their folder, but this
    // function reads with the service role, which is not bound by it.
    if (!storagePath.startsWith(`${context.user.id}/`) || storagePath.includes("..")) {
      throw new HttpError(403, "Bu fayl sizga tegishli emas.", "forbidden");
    }

    const download = await context.serviceClient.storage.from(UPLOAD_BUCKET).download(storagePath);
    if (download.error || !download.data) throw new HttpError(404, "Yuklangan fayl topilmadi.", "upload_missing");
    const bytes = new Uint8Array(await download.data.arrayBuffer());

    const entries = await unzip(bytes);
    const deck = readPptx(entries);

    const sourceName = body.sourceName?.trim() || storagePath.split("/").pop() || "taqdimot.pptx";
    const started = await context.userClient.rpc("pptx_import_start", {
      p_title: deck.title ?? sourceName.replace(/\.pptx$/i, ""),
      p_source_name: sourceName,
    });
    if (started.error) throw started.error;
    presentationId = started.data as unknown as string;

    // Keyed on the presentation, so a retry of the same import settles the
    // reservation it already made instead of taking a second one.
    chargeKey = `pptx-present:${presentationId}`;
    const reserved = await context.serviceClient.rpc("jcoin_reserve", {
      p_operation: "external_pptx_present",
      p_idempotency_key: chargeKey,
      p_reference_id: presentationId,
      p_user_id: context.user.id,
    });
    if (reserved.error) throw reserved.error;
    const charge = reserved.data as { ok?: boolean; amount?: number; balance?: number } | null;
    if (charge?.ok !== true) {
      throw new HttpError(
        402,
        `Tashqi PPTX'ni namoyish qilish uchun ${charge?.amount ?? 0} J kerak.`,
        "insufficient_jcoin",
      );
    }

    const slideRows: Record<string, unknown>[] = [];
    const elementRows: Record<string, unknown>[] = [];

    for (const [index, slide] of deck.slides.entries()) {
      const slideId = crypto.randomUUID();
      slideRows.push({
        id: slideId,
        presentation_id: presentationId,
        owner_id: context.user.id,
        position: index,
        title: slide.title,
        layout: "title_body",
        background: slide.background,
        speaker_notes: slide.speakerNotes,
      });

      for (const element of slide.elements) {
        const content = { ...element.content };
        if (element.media) {
          const extension = EXTENSION_BY_MIME[element.media.mime] ?? "png";
          const assetPath = `${context.user.id}/${presentationId}/${crypto.randomUUID()}.${extension}`;
          const upload = await context.serviceClient.storage.from(ASSET_BUCKET)
            .upload(assetPath, element.media.bytes, { contentType: element.media.mime, upsert: false });
          // A picture that will not store is dropped rather than left as an
          // element pointing at nothing the editor can draw.
          if (upload.error) continue;
          content.storageBucket = ASSET_BUCKET;
          content.storagePath = assetPath;
        }
        elementRows.push(elementRow(element, slideId, presentationId, context.user.id, content));
      }
    }

    const slideInsert = await context.serviceClient.from("slides").insert(slideRows);
    if (slideInsert.error) throw slideInsert.error;
    if (elementRows.length > 0) {
      const elementInsert = await context.serviceClient.from("slide_elements").insert(elementRows);
      if (elementInsert.error) throw elementInsert.error;
    }

    const finished = await context.serviceClient.rpc("pptx_import_finish", {
      p_presentation_id: presentationId,
      p_slide_count: slideRows.length,
    });
    if (finished.error) throw finished.error;

    // The deck exists and is readable, so what was held aside is now spent.
    await context.serviceClient.rpc("jcoin_settle", {
      p_idempotency_key: chargeKey,
      p_user_id: context.user.id,
    });

    return json({
      presentationId,
      slideCount: slideRows.length,
      elementCount: elementRows.length,
      warnings: deck.warnings,
    });
  } catch (error) {
    // A half-written import is worse than none: the row exists, so it has to be
    // told why it is empty rather than left saying "generating" forever.
    // A file we could not read is not something to charge for. The refund is a
    // no-op if nothing was reserved or it was already settled, so it is safe on
    // every path through here.
    if (context && chargeKey) {
      try {
        await context.serviceClient.rpc("jcoin_refund", {
          p_idempotency_key: chargeKey,
          p_reason: "import amalga oshmadi",
          p_user_id: context.user.id,
        });
      } catch {
        // Reconciliation still has the reservation row to work from.
      }
    }
    if (context && presentationId) {
      try {
        await context.serviceClient.rpc("pptx_import_fail", {
          p_presentation_id: presentationId,
          p_message: error instanceof Error ? error.message : "Import amalga oshmadi.",
        });
      } catch {
        // The response below still tells the caller what went wrong.
      }
    }
    if (error instanceof ZipError || error instanceof PptxError) {
      return json({ error: error.message, code: "unreadable_pptx" }, 400);
    }
    return errorResponse(error);
  }
});

function elementRow(
  element: ImportedElement,
  slideId: string,
  presentationId: string,
  ownerId: string,
  content: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    slide_id: slideId,
    presentation_id: presentationId,
    owner_id: ownerId,
    type: element.type,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    z_index: element.zIndex,
    opacity: element.opacity,
    locked: false,
    style: element.style,
    content,
  };
}
