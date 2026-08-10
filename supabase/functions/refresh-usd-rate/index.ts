import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { errorResponse, HttpError, json } from "../_shared/http.ts";

/**
 * Pulls the official USD rate from the Central Bank of Uzbekistan and stores it
 * for the admin console. It runs here rather than in the browser because the
 * bank's API sets no CORS headers, and because writing app_settings needs a
 * privileged path the client must never hold.
 */
const CBU_USD_URL = "https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/";

type CbuRate = { Ccy?: string; Rate?: string; Date?: string };

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const context = await requestContext(request);
    const { data: isAdmin, error: roleError } = await context.userClient.rpc("is_admin");
    if (roleError) throw roleError;
    if (isAdmin !== true) throw new HttpError(403, "Admin role required", "forbidden");

    const response = await fetch(CBU_USD_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new HttpError(502, `Markaziy bank javob bermadi (${response.status})`, "upstream_error");

    const payload = await response.json() as CbuRate[];
    const usd = payload.find((item) => item.Ccy === "USD") ?? payload[0];
    const rate = Number(usd?.Rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new HttpError(502, "Markaziy bank noto‘g‘ri kurs qaytardi", "upstream_error");

    // Written through the service client so the rate lands even though
    // app_settings is closed to everyone but the RPC layer.
    const { data, error } = await context.serviceClient.rpc("admin_set_usd_rate", {
      p_rate: rate,
      p_source: `cbu.uz ${usd?.Date ?? ""}`.trim(),
    });
    if (error) throw error;

    return json({ rate, source: "cbu.uz", date: usd?.Date ?? null, stored: data });
  } catch (error) {
    return errorResponse(error);
  }
});
