/**
 * Puts a deck made here up for sale in one call.
 *
 * The app has already opened the draft listing (`marketplace_fast_draft`) and
 * uploaded the cover and previews it drew of the deck's first slides. This
 * makes the file the buyer gets — the deck's PowerPoint, drawn here from the
 * slides, so no file passes through the seller's hands — and hands over to
 * `marketplace_fast_publish_finish`, which re-checks the deck and decides,
 * by rules alone, whether the listing goes live or to a moderator.
 */
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { ExportAssetLoader } from "../_shared/export-assets.ts";
import { loadExportDeck } from "../_shared/export-deck.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { renderPptx } from "../_shared/pptx-export.ts";

type Body = {
  productId?: string;
  title?: string;
  price?: number;
  description?: string;
  rightsConfirmed?: boolean;
  coverPath?: string | null;
  previewPaths?: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MAX_BYTES = 200 * 1024 * 1024;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const context = await requestContext(request);
    const body = await bodyJson<Body>(request, 8_000);
    const productId = (body.productId ?? "").trim();
    if (!UUID.test(productId)) throw new HttpError(400, "E’lon tanlanmadi.", "invalid_product");
    if (body.rightsConfirmed !== true) {
      throw new HttpError(400, "Sotish huquqingizni tasdiqlang.", "rights_not_confirmed");
    }
    const price = Number(body.price);
    if (!Number.isInteger(price)) throw new HttpError(400, "Narx butun son bo‘lsin.", "invalid_price");

    const service = context.serviceClient;
    const owner = context.user.id;
    const { data: product, error: productError } = await service
      .from("marketplace_products")
      .select("id, seller_id, source_presentation_id, status")
      .eq("id", productId)
      .maybeSingle();
    if (productError) throw productError;
    if (!product || product.seller_id !== owner || !product.source_presentation_id) {
      throw new HttpError(404, "E’lon topilmadi.", "not_found");
    }
    if (!["draft", "rejected", "hidden"].includes(product.status)) {
      throw new HttpError(409, "Bu e’lon allaqachon sotuvda yoki tekshiruvda.", "already_listed");
    }

    // Asked before the file is drawn, so a deck that cannot be sold costs nothing.
    const { data: check, error: checkError } = await service.rpc("marketplace_fast_publish_check", {
      p_presentation_id: product.source_presentation_id,
      p_user_id: owner,
    });
    if (checkError) throw checkError;
    const answer = check as { can_publish?: boolean; blocking?: { message?: string }[] } | null;
    if (!answer?.can_publish) {
      throw new HttpError(409, answer?.blocking?.[0]?.message ?? "Bu taqdimotni sotuvga chiqarib bo‘lmaydi.", "not_publishable");
    }

    const deck = await loadExportDeck(service, product.source_presentation_id, owner);
    const bytes = await renderPptx(deck, new ExportAssetLoader(service, owner, product.source_presentation_id));
    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new Error("the deck's file came out the wrong size");

    const mainPath = `${owner}/${productId}/deck.pptx`;
    const upload = await service.storage.from("marketplace-files").upload(mainPath, bytes, { contentType: PPTX, upsert: true });
    if (upload.error) throw upload.error;

    const previews = Array.isArray(body.previewPaths) ? body.previewPaths.map(String).slice(0, 6) : [];
    const { data: result, error: finishError } = await service.rpc("marketplace_fast_publish_finish", {
      p_user_id: owner,
      p_product_id: productId,
      p_title: String(body.title ?? "").slice(0, 160),
      p_price: price,
      p_description: String(body.description ?? "").slice(0, 4000),
      p_cover_path: body.coverPath ? String(body.coverPath) : null,
      p_preview_paths: previews,
      p_main_path: mainPath,
      p_main_size: bytes.byteLength,
    });
    if (finishError) {
      throw new HttpError(finishError.code === "22023" || finishError.code === "P0001" ? 400 : 500, finishError.message, finishError.code ?? "publish_failed");
    }
    console.log(JSON.stringify({ event: "marketplace_fast_publish", productId, result }));
    return json(result as Record<string, unknown>);
  } catch (error) {
    return errorResponse(error);
  }
});
