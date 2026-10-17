/**
 * Letting a browser in, from the phone.
 *
 * The website opens a request (`web_sign_in_open`) and shows its token as a
 * QR code. The app scans it and asks here — with the person's own session —
 * first what is asking (`inspect`: which browser, on what system, how long
 * the code has left), then to let it in (`approve`). Approval mints a one-time
 * magic-link hash for this account with the admin API (no e-mail is sent) and
 * leaves it on the request, where only the browser holding the request's
 * secret can collect it, once (`web_sign_in_collect`), and exchange it for a
 * session.
 *
 * The phone never sees the hash and the browser never sees anything of the
 * phone's. A token already used, expired or unknown is refused with a sentence
 * the app shows as it is.
 */
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";

type Body = { action?: "inspect" | "approve"; token?: string };

const TOKEN = /^[0-9a-f]{36}$/;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** "Chrome · macOS" from a user agent, or null when it says nothing recognisable. */
export function browserLabel(agent: string | null): string | null {
  if (!agent) return null;
  const browser = /Edg\//.test(agent) ? "Edge"
    : /OPR\/|Opera/.test(agent) ? "Opera"
    : /YaBrowser/.test(agent) ? "Yandex"
    : /Firefox\//.test(agent) ? "Firefox"
    : /Chrome\//.test(agent) ? "Chrome"
    : /Safari\//.test(agent) ? "Safari"
    : null;
  const system = /Windows/.test(agent) ? "Windows"
    : /Android/.test(agent) ? "Android"
    : /iPhone|iPad|iPod/.test(agent) ? "iOS"
    : /Mac OS X|Macintosh/.test(agent) ? "macOS"
    : /CrOS/.test(agent) ? "ChromeOS"
    : /Linux/.test(agent) ? "Linux"
    : null;
  const label = [browser, system].filter(Boolean).join(" · ");
  return label || null;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const context = await requestContext(request);
    const body = await bodyJson<Body>(request);
    const token = (body.token ?? "").trim().toLowerCase();
    if (!TOKEN.test(token)) throw new HttpError(400, "QR kod Jaxongirman saytiniki emas.", "web_token_invalid");

    const { data: row, error } = await context.serviceClient
      .from("web_sign_in_sessions")
      .select("id, status, user_agent, expires_at, created_at")
      .eq("token_hash", await sha256(token))
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new HttpError(404, "Bu QR kod topilmadi. Saytdagi yangi kodni skaner qiling.", "web_token_missing");
    if (row.status !== "pending") throw new HttpError(409, "Bu QR kod allaqachon ishlatilgan. Saytdagi yangi kodni skaner qiling.", "web_token_used");
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new HttpError(410, "QR kod eskirgan. Saytdagi yangi kodni skaner qiling.", "web_token_expired");
    }

    const browser = browserLabel(row.user_agent);
    if (body.action !== "approve") {
      return json({ ok: true, browser, expiresAt: row.expires_at, createdAt: row.created_at });
    }

    const email = context.user.email;
    if (!email) throw new HttpError(422, "Hisobingizda e-pochta yo‘q, saytga shu usulda kirib bo‘lmaydi.", "web_no_email");

    const link = await context.serviceClient.auth.admin.generateLink({ type: "magiclink", email });
    const hash = link.data?.properties?.hashed_token;
    if (link.error || !hash) throw new HttpError(502, "Kirish tayyorlanmadi. Qayta urinib ko‘ring.", "web_link_failed");

    // Conditional on still pending: two phones scanning the same code cannot
    // both let it in.
    const { data: approved, error: approveError } = await context.serviceClient
      .from("web_sign_in_sessions")
      .update({ status: "approved", user_id: context.user.id, otp_hash: hash, approved_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (approveError) throw approveError;
    if (!approved) throw new HttpError(409, "Bu QR kod allaqachon ishlatilgan. Saytdagi yangi kodni skaner qiling.", "web_token_used");

    return json({ ok: true, browser });
  } catch (error) {
    return errorResponse(error);
  }
});
