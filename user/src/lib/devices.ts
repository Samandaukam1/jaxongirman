import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";

import { supabase } from "./supabase";

/**
 * The devices this account is signed in on.
 *
 * Each phone names itself once per session (`device_register`) and again when
 * it comes back to the foreground, which is also how it learns it was taken
 * out from another device: the server answers `active: false` and the phone
 * signs itself out. The rules — a new device cannot remove an older one for two
 * hours, an older one removes a new one at once — live in the database; the
 * screens only show what it allows.
 */

export type DeviceRow = {
  session_id: string;
  platform: "ios" | "android" | "web" | null;
  name: string | null;
  user_agent: string | null;
  app_version: string | null;
  signed_in_at: string;
  last_seen_at: string;
  confirmed: boolean;
  is_current: boolean;
  can_revoke: boolean;
  revoke_from: string | null;
};

export type DeviceAlert = { session_id: string; platform: string; name: string | null; signed_in_at: string; can_revoke: boolean };

/** "iPhone 15 Pro", "Pixel 8" — or the system's own word when the model is unknown. */
function thisDeviceName(): string {
  return Device.modelName?.trim() || (Platform.OS === "ios" ? "iPhone" : "Android");
}

/** Names this device for this session. False when the session was taken out. */
export async function registerDevice(): Promise<boolean> {
  const { data, error } = await supabase.rpc("device_register", {
    p_platform: Platform.OS === "ios" ? "ios" : "android",
    p_name: thisDeviceName(),
    p_app_version: Constants.expoConfig?.version ?? undefined,
  });
  if (error) return true; // A failed check is not a sign-out.
  return (data as { active?: boolean } | null)?.active !== false;
}

export async function listDevices(): Promise<DeviceRow[]> {
  const { data, error } = await supabase.rpc("device_list");
  if (error) throw error;
  return (data ?? []) as DeviceRow[];
}

export async function revokeDevice(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc("device_revoke", { p_session_id: sessionId });
  if (error) throw error;
}

export async function revokeOtherDevices(): Promise<{ revoked: number; kept: number; revoke_from: string | null }> {
  const { data, error } = await supabase.rpc("device_revoke_others");
  if (error) throw error;
  return data as { revoked: number; kept: number; revoke_from: string | null };
}

export async function confirmDevice(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc("device_confirm", { p_session_id: sessionId });
  if (error) throw error;
}

export async function deviceAlerts(): Promise<DeviceAlert[]> {
  const { data, error } = await supabase.rpc("device_alerts");
  if (error) return [];
  return (data ?? []) as DeviceAlert[];
}

/**
 * What to call a device: its own name when it gave one, otherwise read from
 * the user agent of a build that did not name itself.
 */
export function deviceLabel(row: { name: string | null; platform: string | null; user_agent?: string | null }): string {
  if (row.name) return row.name;
  const agent = row.user_agent ?? "";
  if (/CFNetwork|Darwin/.test(agent)) return "iPhone";
  if (/okhttp|Android/.test(agent)) return "Android";
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : null;
  if (browser) return browser;
  return row.platform === "web" ? "Brauzer" : row.platform === "ios" ? "iPhone" : row.platform === "android" ? "Android" : "—";
}
