/**
 * The obyektivka, rendered.
 *
 * One description of the document — `objectiveBlocks` — and two renderers, so a
 * change to the form lands in both formats or in neither. The answers live in
 * the database; the files are made when somebody asks for one and are not kept,
 * because a stored file goes stale the moment a field changes and nothing can
 * then tell which of three downloads is the current one.
 */
import { requestContext } from "../_shared/auth.ts";
import { renderBlocksPdf } from "../_shared/blocks-pdf.ts";
import { preflight } from "../_shared/cors.ts";
import { buildDocx, type DocxImage } from "../_shared/docx.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { objectiveBlocks, type Objective } from "../_shared/objective.ts";

type Body = { id?: string; format?: "docx" | "pdf" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A4 less its margins — what both renderers lay the document into. */
const TEXT_WIDTH_CM = 21 - 3 - 1.5;

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  try {
    const context = await requestContext(request);
    const body = await bodyJson<Body>(request, 8_000);
    const id = (body.id ?? "").trim();
    const format = body.format === "pdf" ? "pdf" : "docx";
    if (!UUID.test(id)) throw new HttpError(400, "Hujjat tanlanmadi.", "invalid_id");

    const service = context.serviceClient;
    const stored = await service
      .from("objective_documents")
      .select("full_name, fields, work, relatives, portrait_id")
      .eq("id", id)
      .eq("owner_id", context.user.id)
      .maybeSingle();
    if (stored.error) throw stored.error;
    if (!stored.data) throw new HttpError(404, "Hujjat topilmadi.", "not_found");

    /**
     * The photograph, fetched only if one was chosen and only from this
     * person's own sheet. The path comes from a row they own rather than from
     * the request, so there is nothing to craft.
     */
    const images: DocxImage[] = [];
    let photoIndex: number | undefined;
    if (stored.data.portrait_id) {
      const portrait = await service
        .from("portrait_sheets").select("source_path")
        .eq("id", stored.data.portrait_id).eq("owner_id", context.user.id).maybeSingle();
      const path = portrait.data?.source_path;
      if (path) {
        const file = await service.storage.from("user-uploads").download(path);
        if (!file.error && file.data) {
          const bytes = new Uint8Array(await file.data.arrayBuffer());
          const extension = bytes[0] === 0x89 && bytes[1] === 0x50 ? "png" : "jpeg";
          images.push({ bytes, extension });
          photoIndex = 0;
        }
      }
    }

    const objective: Objective = {
      fullName: String(stored.data.full_name ?? ""),
      fields: (stored.data.fields ?? {}) as Objective["fields"],
      work: (stored.data.work ?? []) as Objective["work"],
      relatives: (stored.data.relatives ?? []) as Objective["relatives"],
      ...(photoIndex === undefined ? {} : { photoIndex }),
    };

    const blocks = objectiveBlocks(objective, { textWidthCm: TEXT_WIDTH_CM });
    const bytes = format === "pdf"
      ? await renderBlocksPdf({ blocks, images })
      : await buildDocx({ blocks, images });

    const path = `${context.user.id}/obyektivka/${id}.${format}`;
    const upload = await service.storage.from("exports").upload(path, bytes, {
      contentType: format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
    if (upload.error) throw upload.error;

    return json({ ok: true, storagePath: path, format, sizeBytes: bytes.byteLength });
  } catch (error) {
    return errorResponse(error);
  }
});
