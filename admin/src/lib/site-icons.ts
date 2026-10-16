import { supabase } from "@/lib/supabase";

/**
 * The website's logo and icons, as files in a public bucket.
 *
 * The site (`web/lib/branding.ts`) lists `design-assets/site/` and uses the
 * newest file whose name starts with a slot, falling back to its own default
 * when there is none. So the bucket is the whole setting: uploading
 * `site/favicon.png` changes the favicon, deleting it restores the default.
 * The slot names here and there must match.
 */

export const SITE_BUCKET = "design-assets";
export const SITE_FOLDER = "site";
export const SITE_URL = "https://jaxongirman.app";

export type SiteIconSlot = "logo" | "favicon" | "apple" | "app" | "social";

export type SiteIconSpec = {
  slot: SiteIconSlot;
  title: string;
  where: string;
  size: string;
  /** Width ÷ height the slot is drawn at; a file far from it is warned about. */
  ratio: number;
  fallback: string;
};

export const SITE_ICONS: SiteIconSpec[] = [
  { slot: "logo", title: "Sayt logotipi", where: "Sarlavha, footer va “Taqdimot qilish” ekrani", size: "Kvadrat, kamida 256×256 px", ratio: 1, fallback: `${SITE_URL}/logo.png` },
  { slot: "favicon", title: "Favicon", where: "Brauzer tabi va xatcho‘plar", size: "Kvadrat PNG yoki SVG, 192×192 px", ratio: 1, fallback: `${SITE_URL}/brand/icon.png` },
  { slot: "apple", title: "iPhone ekran belgisi", where: "Safari’da “Bosh ekranga qo‘shish”", size: "Kvadrat PNG, 180×180 px", ratio: 1, fallback: `${SITE_URL}/brand/apple-icon.png` },
  { slot: "app", title: "Android / PWA belgisi", where: "Android’da o‘rnatilgan sayt belgisi", size: "Kvadrat PNG, 512×512 px", ratio: 1, fallback: `${SITE_URL}/brand/app-icon.png` },
  { slot: "social", title: "Ulashish rasmi", where: "Telegram, Facebook va boshqalarda havola rasmi", size: "1200×630 px, JPG yoki PNG", ratio: 1200 / 630, fallback: `${SITE_URL}/brand/og.jpg` },
];

export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
export const MAX_BYTES = 5 * 1024 * 1024;

export type UploadedIcon = { slot: SiteIconSlot; name: string; url: string; updatedAt: string | null };

function slotOf(name: string): SiteIconSlot | null {
  const slot = name.split(".")[0];
  return SITE_ICONS.some((spec) => spec.slot === slot) ? (slot as SiteIconSlot) : null;
}

/** The newest upload for each slot. */
export async function listSiteIcons(): Promise<Partial<Record<SiteIconSlot, UploadedIcon>>> {
  const { data, error } = await supabase.storage.from(SITE_BUCKET).list(SITE_FOLDER, {
    limit: 100,
    sortBy: { column: "updated_at", order: "desc" },
  });
  if (error) throw error;
  const found: Partial<Record<SiteIconSlot, UploadedIcon>> = {};
  for (const object of data ?? []) {
    if (!object.id) continue;
    const slot = slotOf(object.name);
    if (!slot || found[slot]) continue;
    const version = object.updated_at ? Date.parse(object.updated_at) || 0 : 0;
    const url = supabase.storage.from(SITE_BUCKET).getPublicUrl(`${SITE_FOLDER}/${object.name}`).data.publicUrl;
    found[slot] = { slot, name: object.name, url: `${url}?v=${version}`, updatedAt: object.updated_at ?? null };
  }
  return found;
}

async function filesFor(slot: SiteIconSlot): Promise<string[]> {
  const { data, error } = await supabase.storage.from(SITE_BUCKET).list(SITE_FOLDER, { limit: 100 });
  if (error) throw error;
  return (data ?? []).filter((object) => object.id && slotOf(object.name) === slot).map((object) => `${SITE_FOLDER}/${object.name}`);
}

const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };

/** Replaces a slot's picture. An older file in another format is removed, so the slot has one file. */
export async function uploadSiteIcon(slot: SiteIconSlot, file: File): Promise<void> {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new Error("Faqat PNG, JPG, WebP yoki SVG fayl yuklash mumkin.");
  if (file.size > MAX_BYTES) throw new Error("Fayl 5 MB dan katta bo‘lmasin.");
  const path = `${SITE_FOLDER}/${slot}.${EXTENSION[file.type]}`;
  const stale = (await filesFor(slot)).filter((existing) => existing !== path);
  const { error } = await supabase.storage.from(SITE_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type,
    cacheControl: "300",
  });
  if (error) throw error;
  if (stale.length) {
    const removed = await supabase.storage.from(SITE_BUCKET).remove(stale);
    if (removed.error) throw removed.error;
  }
}

/** Removes a slot's uploads; the site falls back to its default picture. */
export async function resetSiteIcon(slot: SiteIconSlot): Promise<void> {
  const paths = await filesFor(slot);
  if (!paths.length) return;
  const { error } = await supabase.storage.from(SITE_BUCKET).remove(paths);
  if (error) throw error;
}

/** The picture's own width ÷ height, read in the browser before it is sent. */
export function imageRatio(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve(image.naturalHeight ? image.naturalWidth / image.naturalHeight : null);
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}
