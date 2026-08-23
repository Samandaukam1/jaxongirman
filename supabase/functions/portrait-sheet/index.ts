/**
 * A picture becomes nine printable identity photographs.
 *
 * The person supplies the portrait — made wherever they already have an image
 * model open, with the instruction this app hands them — and this turns it into
 * an A6 sheet: three by three, 30 × 40 mm each, laid out to be cut apart.
 *
 * No model runs here and no picture is generated. What happens is measurement,
 * a crop, and nine `drawImage` calls, which is why it costs nothing and cannot
 * fail in an interesting way.
 */
import fontkit from "@pdf-lib/fontkit";
import { clip, endPath, popGraphicsState, pushGraphicsState, rectangle, PDFDocument, rgb } from "pdf-lib";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js";

import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { SHEET, checkSource, coverCrop, mm, slots } from "../_shared/portrait-sheet.ts";

type Body = { sourcePath?: string };

/** Hairlines a blade can follow, drawn outside the picture rather than over it. */
const CUT = rgb(0.82, 0.82, 0.86);

async function render(source: Uint8Array, kind: "jpg" | "png"): Promise<{
  bytes: Uint8Array;
  width: number;
  height: number;
  warnings: string[];
}> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  /**
   * pdf-lib embeds PNG and JPEG and nothing else.
   *
   * A WebP or a HEIC reaches here looking like a picture and throws something
   * about markers, which the person reads as "Server operation failed". Named
   * before it is opened instead.
   */
  let image;
  try {
    image = kind === "png" ? await pdf.embedPng(source) : await pdf.embedJpg(source);
  } catch {
    throw new HttpError(
      422,
      "Rasm turi qo‘llab-quvvatlanmaydi. PNG yoki JPG formatdagi rasm yuklang.",
      "unsupported_image",
    );
  }
  const { problems, warnings } = checkSource(image.width, image.height);
  if (problems.length > 0) throw new HttpError(422, problems[0]!.message, problems[0]!.code);

  const page = pdf.addPage([mm(SHEET.widthMm), mm(SHEET.heightMm)]);
  // White, explicitly: a sheet that inherits the viewer's page colour prints
  // grey on half the printers in the country.
  page.drawRectangle({ x: 0, y: 0, width: mm(SHEET.widthMm), height: mm(SHEET.heightMm), color: rgb(1, 1, 1) });

  /**
   * The crop, done by drawing the picture larger than the slot and clipping.
   *
   * pdf-lib has no crop, so the whole image is scaled so that the part being
   * kept exactly covers the slot, and the rest is pushed outside a clipping
   * rectangle. Same result as cropping the pixels, without re-encoding them —
   * which matters, because re-encoding is where an identity photograph loses
   * the sharpness it was checked for.
   */
  const crop = coverCrop(image.width, image.height);

  for (const slot of slots()) {
    const scale = slot.width / crop.width;

    /**
     * The crop is a clipping rectangle, not a re-encode.
     *
     * The whole image is scaled so the kept part exactly covers the slot, and
     * everything outside is clipped away — same result as cutting the pixels,
     * without re-encoding them, which is where an identity photograph loses the
     * sharpness it was just checked for.
     *
     * `pushGraphicsState` … `popGraphicsState` is the only way to undo a clip
     * in PDF: it is a state, not a shape. The first version of this called a
     * `page.popOperators()` that pdf-lib does not have, so every sheet failed
     * with "Server operation failed" — and, had it not, nine unclipped copies
     * would have been drawn across the whole page.
     */
    page.pushOperators(
      pushGraphicsState(),
      rectangle(slot.x, slot.y, slot.width, slot.height),
      clip(),
      endPath(),
    );
    page.drawImage(image, {
      x: slot.x - crop.x * scale,
      // PDF's origin is bottom-left and the crop is measured from the top.
      y: slot.y - (image.height - crop.y - crop.height) * scale,
      width: image.width * scale,
      height: image.height * scale,
    });
    page.pushOperators(popGraphicsState());

    // Drawn after the clip is released, so a cut line is never clipped by the
    // slot it belongs to.
    page.drawRectangle({
      x: slot.x, y: slot.y, width: slot.width, height: slot.height,
      borderColor: CUT, borderWidth: 0.4,
    });
  }

  return { bytes: await pdf.save(), width: image.width, height: image.height, warnings };
}

function service(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase server environment is incomplete");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  try {
    const context = await requestContext(request);
    const body = await bodyJson<Body>(request, 4_000);
    const sourcePath = (body.sourcePath ?? "").trim();

    /**
     * The path must be inside this person's own folder.
     *
     * `user-uploads` is partitioned by owner and its policy enforces that for
     * the client — but this runs as the service role, for which the policy does
     * not apply. Checking here is what stops a crafted path reading somebody
     * else's picture.
     */
    if (!sourcePath || sourcePath.includes("..") || !sourcePath.startsWith(`${context.user.id}/`)) {
      throw new HttpError(400, "Rasm manzili noto‘g‘ri.", "bad_path");
    }

    const admin = service();
    const download = await admin.storage.from("user-uploads").download(sourcePath);
    if (download.error || !download.data) throw new HttpError(404, "Rasm topilmadi.", "source_missing");

    const source = new Uint8Array(await download.data.arrayBuffer());
    const kind = source[0] === 0x89 && source[1] === 0x50 ? "png" : "jpg";
    const sheet = await render(source, kind);

    const sheetPath = `${context.user.id}/portrait/${crypto.randomUUID()}.pdf`;
    const upload = await admin.storage.from("exports")
      .upload(sheetPath, sheet.bytes, { contentType: "application/pdf", upsert: false });
    if (upload.error) throw upload.error;

    const stored = await admin.from("portrait_sheets").insert({
      owner_id: context.user.id,
      source_path: sourcePath,
      sheet_path: sheetPath,
      source_width: sheet.width,
      source_height: sheet.height,
      warnings: sheet.warnings,
    }).select("id").single();
    if (stored.error) throw stored.error;

    return json({
      ok: true,
      id: stored.data.id,
      sheetPath,
      warnings: sheet.warnings,
      sizeBytes: sheet.bytes.byteLength,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
