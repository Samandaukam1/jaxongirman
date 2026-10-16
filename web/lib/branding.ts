import { unstable_cache } from "next/cache";

/**
 * The site's own pictures — its logo and every icon a browser or a phone asks
 * for — and where each one is read from today.
 *
 * Each has a default shipped under `public/brand/`, and each can be replaced
 * from the admin console ("Sayt ikonkalari"), which uploads to the public
 * `design-assets` bucket under `site/<slot>.<ext>`. Nothing else records the
 * choice: the bucket listing is the setting, so there is no row to keep in step
 * with a file. The newest upload for a slot wins, and its timestamp rides on the
 * URL so a replaced icon is fetched again rather than served from a cache.
 *
 * Read at most every two minutes; a change in the console reaches the site
 * within that.
 */

export const BRAND_BUCKET = "design-assets";
export const BRAND_FOLDER = "site";

export const BRAND_SLOTS = ["logo", "favicon", "apple", "social", "app"] as const;
export type BrandSlot = (typeof BRAND_SLOTS)[number];
export type Branding = Record<BrandSlot, string>;

export const DEFAULT_BRANDING: Branding = {
  logo: "/logo.png",
  favicon: "/brand/icon.png",
  apple: "/brand/apple-icon.png",
  social: "/brand/og.jpg",
  app: "/brand/app-icon.png",
};

type ListedObject = { name: string; id: string | null; updated_at?: string | null };

async function uploaded(): Promise<Partial<Branding>> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return {};
  try {
    const response = await fetch(`${base}/storage/v1/object/list/${BRAND_BUCKET}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: BRAND_FOLDER, limit: 100, offset: 0, sortBy: { column: "updated_at", order: "desc" } }),
      cache: "no-store",
    });
    if (!response.ok) return {};
    const rows = (await response.json()) as ListedObject[];
    const found: Partial<Branding> = {};
    for (const row of rows) {
      // A row without an id is a folder, not a file.
      if (!row.id) continue;
      const slot = row.name.split(".")[0] as BrandSlot;
      if (!BRAND_SLOTS.includes(slot) || found[slot]) continue;
      const version = row.updated_at ? Date.parse(row.updated_at) || 0 : 0;
      found[slot] = `${base}/storage/v1/object/public/${BRAND_BUCKET}/${BRAND_FOLDER}/${encodeURIComponent(row.name)}?v=${version}`;
    }
    return found;
  } catch {
    // An unreachable bucket costs the custom icons, never the page.
    return {};
  }
}

export const loadBranding = unstable_cache(
  async (): Promise<Branding> => ({ ...DEFAULT_BRANDING, ...(await uploaded()) }),
  ["site-branding"],
  { revalidate: 120 },
);
