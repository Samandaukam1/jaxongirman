import { supabase } from "./supabase";

/**
 * Signing in on the website with this phone.
 *
 * The site shows a QR code carrying `jaxongirman://web-login/<token>`; the app
 * reads it from Profil → "Web ulash" (or the phone's own camera opens the
 * same link), asks the server which browser is asking, and lets it in. The
 * browser is then signed in to this account — nothing the browser could use is
 * ever on this phone, and nothing of the phone's is ever in the browser.
 */

export type WebRequest = { browser: string | null; expiresAt: string };
export type WebSignIn = { approved_at: string; used_at: string | null; user_agent: string | null };

/** The token in a scanned code, or null when the code is not the site's. */
export function webLoginToken(raw: string): string | null {
  const text = raw.trim();
  const match = text.match(/(?:web-login|kirish)\/([0-9a-f]{36})(?:[?#].*)?$/i);
  if (match?.[1]) return match[1].toLowerCase();
  return /^[0-9a-f]{36}$/i.test(text) ? text.toLowerCase() : null;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("web-sign-in", { body });
  if (error) throw error;
  return data as T;
}

/** Which browser is asking, and until when its code is good. */
export async function inspectWebLogin(token: string): Promise<WebRequest> {
  return await call<WebRequest>({ action: "inspect", token });
}

/** Lets that browser in. */
export async function approveWebLogin(token: string): Promise<{ browser: string | null }> {
  return await call<{ browser: string | null }>({ action: "approve", token });
}

/** The browsers this account let in, newest first. */
export async function webLoginHistory(): Promise<WebSignIn[]> {
  const { data, error } = await supabase.rpc("web_sign_in_history");
  if (error) throw error;
  return (data ?? []) as WebSignIn[];
}

/** "Chrome · macOS" from a stored user agent, the way the server names it. */
export function browserOf(agent: string | null): string | null {
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
  return [browser, system].filter(Boolean).join(" · ") || null;
}
