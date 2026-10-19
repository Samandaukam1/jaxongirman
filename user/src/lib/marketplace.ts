import type {
  MarketplaceListItem, MarketplaceMaterialType, MarketplaceQuote, MarketplaceSearchResult, MarketplaceSort,
} from "@jaxongirman/types";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useState } from "react";
import { Image, Platform } from "react-native";

import { i18n } from "../i18n";

import { saveInBrowser } from "./browserFile";
import { localized } from "./content";
import { asErrorMessage } from "./format";
import { supabase } from "./supabase";

/**
 * How long a signed cover URL stays valid, and how long this client reuses it.
 *
 * The reuse is the point. A signed URL carries its token in the query string,
 * so every fresh signature is a URL the image cache has never seen — and the
 * covers were signed again on every visit to the shop, which made every visit
 * download every picture again. Reusing one URL for hours lets the platform's
 * image cache answer instead; it is refreshed well before it expires.
 */
const PREVIEW_URL_SECONDS = 12 * 3600;
const PREVIEW_REUSE_MS = 6 * 3600 * 1000;

/** Signed URLs by `bucket/path`, kept for the life of the process. */
const signedUrls = new Map<string, { url: string; signedAt: number }>();

export type SearchFilters = {
  query: string;
  materialType: string | null;
  categoryId: string | null;
  sellerId: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  sort: MarketplaceSort;
};

export const EMPTY_FILTERS: SearchFilters = {
  query: "", materialType: null, categoryId: null, sellerId: null,
  minPrice: null, maxPrice: null, sort: "newest",
};

export const PAGE_SIZE = 20;

/**
 * Signs a batch of private object paths in one round trip.
 *
 * Both marketplace buckets are private — the catalogue is an in-app service —
 * so every cover on screen needs a signed URL. Signing them per card would be
 * one request per tile; this is one request per page.
 */
export async function signPaths(bucket: string, paths: readonly string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return {};
  const now = Date.now();
  const found: Record<string, string> = {};
  const missing: string[] = [];
  for (const path of unique) {
    const cached = signedUrls.get(`${bucket}/${path}`);
    if (cached && now - cached.signedAt < PREVIEW_REUSE_MS) found[path] = cached.url;
    else missing.push(path);
  }
  if (missing.length > 0) {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(missing, PREVIEW_URL_SECONDS);
    for (const item of data ?? []) {
      if (!item.path || !item.signedUrl) continue;
      signedUrls.set(`${bucket}/${item.path}`, { url: item.signedUrl, signedAt: now });
      found[item.path] = item.signedUrl;
      // Started now rather than when the card mounts: by the time the grid
      // draws, the bytes are already on their way or in the cache.
      if (Platform.OS !== "web") void Image.prefetch(item.signedUrl).catch(() => false);
    }
  }
  return found;
}

/**
 * The first page of the shop with nothing filtered, kept between visits.
 *
 * Bosh sahifa shows the newest few products and the Do‘kon tab opens on the
 * same page, so both read this and both refresh it. A screen that has it draws
 * the shelf at once and updates it in place, instead of a skeleton every time
 * the tab is reopened.
 */
export type Shelf = { items: MarketplaceListItem[]; total: number; covers: Record<string, string>; loadedAt: number };
let shelf: Shelf | null = null;
let shelfRequest: Promise<Shelf> | null = null;

export function peekShelf(): Shelf | null {
  return shelf;
}

/** Refreshes the unfiltered first page; concurrent callers share one request. */
export function refreshShelf(): Promise<Shelf> {
  if (shelfRequest) return shelfRequest;
  shelfRequest = (async () => {
    const result = await searchProducts(EMPTY_FILTERS, 0);
    const covers = await signPaths(
      "marketplace-previews",
      result.items.map((item) => item.cover_path).filter((path): path is string => Boolean(path)),
    );
    shelf = { items: result.items, total: result.total, covers, loadedAt: Date.now() };
    return shelf;
  })().finally(() => { shelfRequest = null; });
  return shelfRequest;
}

/** Keeps the cached shelf in step with a favourite toggled on either screen. */
export function patchShelfItem(id: string, patch: Partial<MarketplaceListItem>): void {
  if (!shelf) return;
  shelf = { ...shelf, items: shelf.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) };
}

export function isDefaultFilters(filters: SearchFilters): boolean {
  return filters.query.trim() === "" && filters.materialType === null && filters.categoryId === null
    && filters.sellerId === null && filters.minPrice === null && filters.maxPrice === null && filters.sort === "newest";
}

/** The catalogue, one page at a time. Filtering and sorting happen server-side. */
export async function searchProducts(filters: SearchFilters, offset: number): Promise<MarketplaceSearchResult> {
  const { data, error } = await supabase.rpc("marketplace_search", {
    p_query: filters.query.trim() || undefined,
    p_material_type: filters.materialType ?? undefined,
    p_category_id: filters.categoryId ?? undefined,
    p_seller_id: filters.sellerId ?? undefined,
    p_min_price: filters.minPrice ?? undefined,
    p_max_price: filters.maxPrice ?? undefined,
    p_sort: filters.sort,
    p_limit: PAGE_SIZE,
    p_offset: offset,
  });
  if (error) throw error;
  return data as unknown as MarketplaceSearchResult;
}

/**
 * The material types a seller may publish, straight from the database.
 *
 * Read rather than hard-coded: adding "Diplom ishi" is an admin insert, and this
 * screen has to pick it up without a release.
 */
let materialTypesCache: MarketplaceMaterialType[] | null = null;

export function useMaterialTypes() {
  // The list changes when an operator edits it, not between two tabs: a cached
  // copy draws the chips at once and the read below corrects it if it moved.
  const [types, setTypes] = useState<MarketplaceMaterialType[]>(() => materialTypesCache ?? []);
  const [loading, setLoading] = useState(materialTypesCache === null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (materialTypesCache === null) setLoading(true);
    const { data, error: requestError } = await supabase
      .from("marketplace_material_types")
      .select("*")
      .eq("is_active", true)
      .order("sort_order");
    if (requestError) setError(asErrorMessage(requestError));
    else {
      // Names and descriptions in the app's language, where an operator has written them.
      const next = ((data ?? []) as (MarketplaceMaterialType & { label_i18n?: unknown; description_i18n?: unknown })[])
        .map((type) => ({ ...type, label: localized(type.label, type.label_i18n), description: localized(type.description, type.description_i18n) }));
      materialTypesCache = next;
      setTypes(next);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { types, loading, error, reload };
}

/**
 * What a given price costs each side, from the server.
 *
 * The seller's calculator never does this arithmetic itself: the rates live in
 * the database and an admin can change them at any moment.
 */
export function useQuote(basePrice: number) {
  const [quote, setQuote] = useState<MarketplaceQuote | null>(null);

  useEffect(() => {
    let active = true;
    if (!Number.isFinite(basePrice) || basePrice < 0) { setQuote(null); return; }
    // Debounced: the price field fires this on every keystroke otherwise.
    const handle = setTimeout(() => {
      void supabase.rpc("marketplace_quote", { p_base_price: Math.round(basePrice) }).then(({ data, error }) => {
        if (active && !error) setQuote(data as unknown as MarketplaceQuote);
      });
    }, 250);
    return () => { active = false; clearTimeout(handle); };
  }, [basePrice]);

  return quote;
}

/** Favourite / unfavourite, written straight to the join table under RLS. */
export async function toggleFavorite(productId: string, userId: string, next: boolean): Promise<void> {
  if (next) {
    const { error } = await supabase.from("marketplace_favorites").insert({ product_id: productId, user_id: userId });
    if (error && error.code !== "23505") throw error;
    return;
  }
  const { error } = await supabase.from("marketplace_favorites").delete()
    .eq("product_id", productId).eq("user_id", userId);
  if (error) throw error;
}

/**
 * Downloads a purchased file and hands it to the share sheet.
 *
 * The URL is minted server-side after an entitlement check and lives for a few
 * minutes, so it is fetched and consumed immediately rather than stored.
 */
export async function downloadPurchasedFile(
  productId: string,
  kind: "main" | "study_guide",
): Promise<{ uri: string; filename: string; mimeType: string }> {
  const { data, error } = await supabase.functions.invoke("download-marketplace-file", {
    body: { productId, kind },
  });
  if (error) throw error;
  const payload = data as { url?: string; filename?: string; mimeType?: string };
  if (!payload.url) throw new Error(i18n.t("market:library.noLink"));

  const safeName = (payload.filename ?? "material").replace(/[^A-Za-z0-9._-]+/g, "-");
  if (Platform.OS === "web") {
    // Straight into the browser's downloads; there is no file on disk to share.
    await saveInBrowser(payload.url, safeName);
    return { uri: "", filename: safeName, mimeType: payload.mimeType ?? "application/octet-stream" };
  }
  const target = `${FileSystem.cacheDirectory}${safeName}`;
  const result = await FileSystem.downloadAsync(payload.url, target);
  return { uri: result.uri, filename: safeName, mimeType: payload.mimeType ?? "application/octet-stream" };
}

/** Opens the platform share sheet for a file already on disk. */
export async function shareFile(uri: string, mimeType: string): Promise<boolean> {
  if (Platform.OS === "web") return true; // saved by downloadPurchasedFile already
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: i18n.t("market:library.openDialog") });
  return true;
}

/* ------------------------------------------------------- refund policy */

export type RefundPolicy = {
  enabled: boolean;
  title: string;
  body: string;
  checkboxLabel: string;
};

/**
 * The rule a buyer has to agree to, as an admin worded it.
 *
 * Read rather than hardcoded: the wording is legal text, it ages, and an edit
 * to it should not need a store release. Nothing here decides anything — the
 * server refuses an order that arrives without the agreement, so this only
 * supplies the sentence somebody is agreeing to.
 */
export async function refundPolicy(): Promise<RefundPolicy | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "marketplace.refund_policy")
    .maybeSingle();
  if (error) throw error;

  const value = (data?.value ?? null) as Record<string, unknown> | null;
  if (!value || value.enabled !== true) return null;
  // The policy in the reader's language when the operator has written one; the
  // server records the agreement in that same language.
  const own = ((value.i18n ?? {}) as Record<string, Record<string, unknown> | undefined>)[i18n.language] ?? {};
  const pick = (key: string, fallback: string) => {
    const text = own[key];
    return typeof text === "string" && text.trim() ? text : String(value[key] ?? fallback);
  };
  return {
    enabled: true,
    title: pick("title", "Qaytarish siyosati"),
    body: pick("body", ""),
    checkboxLabel: pick("checkbox_label", "Shartlarga roziman."),
  };
}
