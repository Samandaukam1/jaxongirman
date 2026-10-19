import { normalizePromo, type Promo } from "@jaxongirman/types";
import type { useRouter } from "expo-router";
import { Image, Linking, Platform, UIManager } from "react-native";

import { supabase } from "./supabase";

/**
 * "Jaxongirman tavsiya qiladi": the live recommendations and advertisements.
 *
 * Read straight from `public.promos`; row-level security returns only what is
 * published and inside its dates, so the client never filters by status.
 */

/** The banner columns: the article body is not needed to draw the carousel. */
const LIST_COLUMNS = "id,kind,status,title,subtitle,sponsor,badge,banner_url,banner_kind,banner_style,hero_url,hero_kind,action,link_url,theme,position,starts_at,ends_at,view_count,click_count,created_at,updated_at";

let listCache: Promo[] | null = null;

/** What the carousel showed last, so returning to Bosh sahifa draws it at once. */
export function peekPromos(): Promo[] | null {
  return listCache;
}

export async function fetchPromos(): Promise<Promo[]> {
  const { data, error } = await supabase
    .from("promos")
    .select(LIST_COLUMNS)
    .eq("status", "published")
    .order("position", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw error;
  const promos = (data ?? []).map((row) => normalizePromo({ ...row, body: [] } as Record<string, unknown>));
  listCache = promos;
  // The first banners are fetched as soon as their addresses are known.
  if (Platform.OS !== "web") {
    for (const promo of promos.slice(0, 3)) {
      if (promo.banner_url && promo.banner_kind === "image") void Image.prefetch(promo.banner_url).catch(() => false);
    }
  }
  return promos;
}

export async function fetchPromo(id: string): Promise<Promo | null> {
  const { data, error } = await supabase.from("promos").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? normalizePromo(data as Record<string, unknown>) : null;
}

/** A banner seen or tapped. Counting is best-effort and never surfaces an error. */
export function trackPromo(id: string, event: "view" | "click"): void {
  void supabase.rpc("promo_track", { p_promo_id: id, p_event: event }).then(() => undefined, () => undefined);
}

/**
 * Follows an address written in the console.
 *
 * `/…` is a screen of this app (a button that says "Taqdimot yaratish" goes to
 * `/(app)/create`); anything else is opened by the system, outside the app.
 */
export function openPromoUrl(url: string, router: ReturnType<typeof useRouter>): void {
  const target = url.trim();
  if (!target) return;
  if (target.startsWith("/")) {
    router.push(target as never);
    return;
  }
  if (/^https?:\/\//i.test(target)) void Linking.openURL(target).catch(() => undefined);
}

/**
 * Whether a native module is in this binary.
 *
 * Video and audio are native. A phone running a build from before they were
 * added would draw React Native's red "unimplemented" box in their place — so
 * the article asks first and, without them, offers to open the file instead.
 */
function linked(moduleName: string, viewName?: string): boolean {
  if (Platform.OS === "web") return true;
  const registry = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  if (registry) return moduleName in registry;
  return viewName ? UIManager.hasViewManagerConfig?.(viewName) ?? false : false;
}

export const VIDEO_LINKED = linked("ExpoVideo", "ExpoVideoView");
export const AUDIO_LINKED = linked("ExpoAudio");
