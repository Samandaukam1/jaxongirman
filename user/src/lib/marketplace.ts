import type {
  MarketplaceMaterialType, MarketplaceQuote, MarketplaceSearchResult, MarketplaceSort,
} from "@jaxongirman/types";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useState } from "react";

import { asErrorMessage } from "./format";
import { supabase } from "./supabase";

/** How long a batch of cover URLs stays valid. Long enough to scroll a list. */
const PREVIEW_URL_SECONDS = 3600;

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
  const { data } = await supabase.storage.from(bucket).createSignedUrls(unique, PREVIEW_URL_SECONDS);
  const usable = (data ?? []).filter((item): item is typeof item & { path: string; signedUrl: string } =>
    Boolean(item.path) && Boolean(item.signedUrl));
  return Object.fromEntries(usable.map((item) => [item.path, item.signedUrl]));
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
export function useMaterialTypes() {
  const [types, setTypes] = useState<MarketplaceMaterialType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error: requestError } = await supabase
      .from("marketplace_material_types")
      .select("code,label,description,allowed_mime_types,max_file_bytes,supports_study_guide,supports_editor_import,is_active")
      .eq("is_active", true)
      .order("sort_order");
    if (requestError) setError(asErrorMessage(requestError));
    else { setTypes((data ?? []) as MarketplaceMaterialType[]); setError(null); }
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
  if (!payload.url) throw new Error("Yuklab olish havolasi olinmadi");

  const safeName = (payload.filename ?? "material").replace(/[^A-Za-z0-9._-]+/g, "-");
  const target = `${FileSystem.cacheDirectory}${safeName}`;
  const result = await FileSystem.downloadAsync(payload.url, target);
  return { uri: result.uri, filename: safeName, mimeType: payload.mimeType ?? "application/octet-stream" };
}

/** Opens the platform share sheet for a file already on disk. */
export async function shareFile(uri: string, mimeType: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: "Materialni ochish" });
  return true;
}
