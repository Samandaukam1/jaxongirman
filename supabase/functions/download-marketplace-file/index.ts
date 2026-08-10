/**
 * Hands out a marketplace file, once, to someone who is allowed to have it.
 *
 * `marketplace-files` has no SELECT policy for any client role, so there is no
 * path to a sellable file that does not come through here. This function asks
 * the database who the caller is allowed to be — buyer with an entitlement,
 * the seller who uploaded it, or an admin — and only then mints a signed URL
 * that expires in minutes.
 *
 * Knowing a storage path is worth nothing: the path is never returned, and the
 * bucket refuses unsigned reads.
 */
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";

type Body = { productId?: string; kind?: "main" | "study_guide" };

/** Long enough to start a download, short enough to be useless if it leaks. */
const SIGNED_URL_SECONDS = 300;

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;

  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed", "method_not_allowed");
    const { user, serviceClient } = await requestContext(request);
    const body = await bodyJson<Body>(request);

    const productId = body.productId?.trim();
    if (!productId) throw new HttpError(400, "productId is required", "invalid_request");
    const kind = body.kind === "study_guide" ? "study_guide" : "main";

    const { data: product, error: productError } = await serviceClient
      .from("marketplace_products")
      .select("id, seller_id, title, material_type, status")
      .eq("id", productId)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) throw new HttpError(404, "Mahsulot topilmadi", "not_found");

    // Three ways to be allowed, checked in the database rather than here: the
    // entitlement function is the same one the reviews policy trusts.
    const isSeller = product.seller_id === user.id;
    let allowed = isSeller;

    if (!allowed) {
      const { data: entitled, error: entitlementError } = await serviceClient.rpc("marketplace_has_entitlement", {
        p_product_id: productId,
        p_user_id: user.id,
      });
      if (entitlementError) throw entitlementError;
      allowed = entitled === true;
    }

    if (!allowed) {
      const { data: isAdmin } = await serviceClient.rpc("is_admin", { p_user_id: user.id });
      allowed = isAdmin === true;
    }

    if (!allowed) {
      throw new HttpError(403, "Bu faylni yuklab olish uchun avval mahsulotni sotib oling.", "forbidden");
    }

    const { data: file, error: fileError } = await serviceClient
      .from("marketplace_product_files")
      .select("storage_path, mime_type, original_name, size_bytes")
      .eq("product_id", productId)
      .eq("kind", kind)
      .maybeSingle();
    if (fileError) throw fileError;
    if (!file) {
      throw new HttpError(404, kind === "study_guide" ? "Qo‘shimcha material biriktirilmagan" : "Fayl topilmadi", "not_found");
    }

    const { data: signed, error: signError } = await serviceClient.storage
      .from("marketplace-files")
      .createSignedUrl(file.storage_path, SIGNED_URL_SECONDS, {
        // The browser and the share sheet both want a real filename rather than
        // the opaque uuid the object is stored under.
        download: file.original_name || `${product.title}`,
      });
    if (signError) throw signError;

    return json({
      url: signed.signedUrl,
      filename: file.original_name || product.title,
      mimeType: file.mime_type,
      sizeBytes: file.size_bytes,
      kind,
      // Whether the buyer may open this in the Jaxongirman editor, which is a
      // property of the material type rather than of the file.
      expiresInSeconds: SIGNED_URL_SECONDS,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
