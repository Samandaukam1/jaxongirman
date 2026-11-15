import { supabase } from "@/lib/supabase";

/**
 * Ads shown with presented and downloaded decks (`presentation_ads`).
 *
 * * `slide` — a whole 16:9 page placed after every fifth page of a deck whose
 *   owner has no plan; at most three active at once, each shown once.
 * * `banner` — a 7:1 strip that comes down from the top of the screen now and
 *   then, for an owner with no plan and for the cheapest plan.
 *
 * The pictures live in the public `presentation-ads` bucket; the rows are
 * written only through `admin_save_presentation_ad` / `admin_delete_presentation_ad`,
 * which keep the three-page rule and write the audit log.
 */

export type AdKind = "slide" | "banner";

export type PresentationAd = {
  id: string;
  kind: AdKind;
  imagePath: string;
  url: string;
  link: string | null;
  position: number;
  active: boolean;
  updatedAt: string;
};

export type BannerTiming = { banner_first_seconds: number; banner_every_seconds: number; banner_show_seconds: number };

export const AD_BUCKET = "presentation-ads";
export const AD_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const AD_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_ACTIVE_SLIDES = 3;
export const AD_RATIO: Record<AdKind, number> = { slide: 16 / 9, banner: 7 };
export const DEFAULT_TIMING: BannerTiming = { banner_first_seconds: 30, banner_every_seconds: 240, banner_show_seconds: 15 };

const TIMING_KEY = "presentation.ads";

function publicUrl(path: string): string {
  return supabase.storage.from(AD_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function listPresentationAds(): Promise<PresentationAd[]> {
  const { data, error } = await supabase
    .from("presentation_ads")
    .select("id,kind,image_path,link_url,position,active,updated_at")
    .order("position")
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind === "banner" ? "banner" : "slide",
    imagePath: row.image_path,
    url: publicUrl(row.image_path),
    link: row.link_url,
    position: row.position,
    active: row.active,
    updatedAt: row.updated_at,
  }));
}

function extensionOf(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^(png|jpe?g|webp)$/.test(fromName)) return fromName;
  return file.type.split("/")[1] ?? "png";
}

/** Uploads a picture and adds it as a new ad, last in its list. */
export async function addPresentationAd(kind: AdKind, file: File, existing: PresentationAd[]): Promise<void> {
  if (!AD_TYPES.includes(file.type)) throw new Error("Faqat PNG, JPG yoki WEBP rasm yuklang.");
  if (file.size > AD_MAX_BYTES) throw new Error("Rasm 10 MB dan katta. Kichikroq rasm tanlang.");
  const path = `${kind}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${extensionOf(file)}`;
  const upload = await supabase.storage.from(AD_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (upload.error) throw upload.error;

  const same = existing.filter((ad) => ad.kind === kind);
  // A fourth ad page arrives switched off rather than refused: the admin
  // decides which three run.
  const active = kind === "banner" || same.filter((ad) => ad.active).length < MAX_ACTIVE_SLIDES;
  const { error } = await supabase.rpc("admin_save_presentation_ad", {
    p_id: null as unknown as string,
    p_kind: kind,
    p_image_path: path,
    p_position: Math.min(same.reduce((top, ad) => Math.max(top, ad.position + 1), 0), 99),
    p_active: active,
    p_reason: "Taqdimot reklamasi qo‘shildi",
  });
  if (error) {
    // The row was refused, so the picture would be an orphan.
    await supabase.storage.from(AD_BUCKET).remove([path]);
    throw error;
  }
}

export async function savePresentationAd(ad: PresentationAd): Promise<void> {
  const link = ad.link?.trim() || null;
  if (link && !/^https:\/\/\S{3,}$/.test(link)) throw new Error("Havola https:// bilan boshlanishi kerak.");
  const { error } = await supabase.rpc("admin_save_presentation_ad", {
    p_id: ad.id,
    p_kind: ad.kind,
    p_image_path: ad.imagePath,
    // Empty is stored as no link (`nullif` in the function).
    p_link_url: link ?? "",
    p_position: Math.max(0, Math.min(Math.round(ad.position), 99)),
    p_active: ad.active,
    p_reason: "Taqdimot reklamasi o‘zgartirildi",
  });
  if (error) throw error;
}

export async function deletePresentationAd(ad: PresentationAd): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_presentation_ad", {
    p_id: ad.id,
    p_reason: "Taqdimot reklamasi o‘chirildi",
  });
  if (error) throw error;
  // The row is gone; a picture left behind is only storage, so its removal is best effort.
  await supabase.storage.from(AD_BUCKET).remove([ad.imagePath]);
}

export async function loadBannerTiming(): Promise<BannerTiming> {
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", TIMING_KEY).maybeSingle();
  if (error) throw error;
  const value = (data?.value ?? {}) as Partial<Record<keyof BannerTiming, unknown>>;
  const read = (key: keyof BannerTiming) => {
    const number = Number(value[key]);
    return Number.isFinite(number) && number > 0 ? number : DEFAULT_TIMING[key];
  };
  return {
    banner_first_seconds: read("banner_first_seconds"),
    banner_every_seconds: read("banner_every_seconds"),
    banner_show_seconds: read("banner_show_seconds"),
  };
}

/** What is wrong with a timing, in words, or null. */
export function timingProblem(timing: BannerTiming): string | null {
  const { banner_first_seconds: first, banner_every_seconds: every, banner_show_seconds: show } = timing;
  if (![first, every, show].every((value) => Number.isInteger(value) && value > 0)) return "Barcha qiymatlar musbat butun son bo‘lsin.";
  if (show < 3 || show > 60) return "Banner 3 dan 60 soniyagacha tursin.";
  if (first > 3600) return "Birinchi chiqishi 1 soatdan kech bo‘lmasin.";
  if (every < show + 5) return "Takrorlanish oralig‘i banner turadigan vaqtdan kamida 5 soniya uzun bo‘lsin.";
  return null;
}

export async function saveBannerTiming(timing: BannerTiming): Promise<void> {
  const problem = timingProblem(timing);
  if (problem) throw new Error(problem);
  const { error } = await supabase.rpc("admin_update_app_setting", {
    p_key: TIMING_KEY,
    p_value: timing,
    p_reason: "Taqdimot banneri vaqtlari o‘zgartirildi",
  });
  if (error) throw error;
}
