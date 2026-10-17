import { supabase } from "./supabase";

/**
 * The devices an account is signed in on, from the website's side — the same
 * functions and the same two-hour rule as the app (see the `device_*`
 * functions in the database).
 */

export type DeviceRow = {
  session_id: string;
  platform: "ios" | "android" | "web" | null;
  name: string | null;
  user_agent: string | null;
  signed_in_at: string;
  confirmed: boolean;
  is_current: boolean;
  can_revoke: boolean;
  revoke_from: string | null;
};

export type DeviceAlert = { session_id: string; platform: string; name: string | null; signed_in_at: string; can_revoke: boolean };

/** "Chrome · macOS" from this browser's user agent. */
export function browserName(agent: string): string {
  const browser = /Edg\//.test(agent) ? "Edge" : /OPR\/|Opera/.test(agent) ? "Opera" : /YaBrowser/.test(agent) ? "Yandex"
    : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Brauzer";
  const system = /Windows/.test(agent) ? "Windows" : /Android/.test(agent) ? "Android" : /iPhone|iPad|iPod/.test(agent) ? "iOS"
    : /Mac OS X|Macintosh/.test(agent) ? "macOS" : /CrOS/.test(agent) ? "ChromeOS" : /Linux/.test(agent) ? "Linux" : null;
  return system ? `${browser} · ${system}` : browser;
}

/** What to call a device in the list. */
export function deviceLabel(row: { name: string | null; platform: string | null; user_agent?: string | null }): string {
  if (row.name) return row.name;
  const agent = row.user_agent ?? "";
  if (/CFNetwork|Darwin/.test(agent)) return "iPhone";
  if (/okhttp/.test(agent)) return "Android";
  if (/Mozilla/.test(agent)) return browserName(agent);
  return row.platform === "web" ? "Brauzer" : row.platform === "ios" ? "iPhone" : row.platform === "android" ? "Android" : "—";
}

/** Names this browser for its session. False when another device took it out. */
export async function registerBrowser(): Promise<boolean> {
  const { data, error } = await supabase.rpc("device_register", { p_platform: "web", p_name: browserName(navigator.userAgent) });
  if (error) return true;
  return (data as { active?: boolean } | null)?.active !== false;
}

export async function listDevices(): Promise<DeviceRow[]> {
  const { data, error } = await supabase.rpc("device_list");
  if (error) throw error;
  return (data ?? []) as DeviceRow[];
}

export async function deviceAlerts(): Promise<DeviceAlert[]> {
  const { data } = await supabase.rpc("device_alerts");
  return (data ?? []) as DeviceAlert[];
}

/** The server's own sentence when it refuses, for showing as it is. */
function refusal(error: { message?: string } | null): string {
  return error?.message ?? "Bajarilmadi. Qayta urinib ko‘ring.";
}

export async function revokeDevice(sessionId: string): Promise<string | null> {
  const { error } = await supabase.rpc("device_revoke", { p_session_id: sessionId });
  return error ? refusal(error) : null;
}

export async function revokeOthers(): Promise<{ revoked: number; kept: number; revoke_from: string | null } | string> {
  const { data, error } = await supabase.rpc("device_revoke_others");
  return error ? refusal(error) : (data as { revoked: number; kept: number; revoke_from: string | null });
}

export async function confirmDevice(sessionId: string): Promise<void> {
  await supabase.rpc("device_confirm", { p_session_id: sessionId });
}

export const when = (iso: string) => new Date(iso).toLocaleString("uz-UZ", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
