import { normalizePromo, type Promo, type PromoAction, type PromoBannerStyle, type PromoBlock, type PromoFont, type PromoKind, type PromoMediaKind, type PromoStatus, type PromoTheme } from "@jaxongirman/types";

import { supabase } from "@/lib/supabase";

/**
 * "Tavsiya va reklama": the banners on the app's Bosh sahifa and the articles
 * behind them. See `supabase/migrations/202610200001_promos.sql` for the table
 * and `packages/types/src/promo.ts` for the article format both sides share.
 */

export const PROMO_BUCKET = "promo-media";

/** What the bucket takes, per kind of file. The bucket itself refuses anything else. */
export const MEDIA_ACCEPT = {
  image: "image/jpeg,image/png,image/webp,image/gif",
  video: "video/mp4,video/quicktime,video/webm",
  audio: "audio/mpeg,audio/mp4,audio/aac,audio/x-m4a,audio/wav,audio/ogg",
} as const;

export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;

export type PromoDraft = {
  id: string | null;
  kind: PromoKind;
  status: PromoStatus;
  title: string;
  subtitle: string;
  sponsor: string;
  /** The banner label: the kind's default, none, or the console's own words. */
  badge_mode: "auto" | "hidden" | "custom";
  badge_text: string;
  banner_url: string | null;
  banner_kind: PromoMediaKind;
  banner_style: PromoBannerStyle;
  hero_url: string | null;
  hero_kind: PromoMediaKind;
  action: PromoAction;
  link_url: string;
  body: PromoBlock[];
  theme: PromoTheme;
  position: number;
  /** `datetime-local` values; empty for "no limit". */
  starts_at: string;
  ends_at: string;
};

export function emptyDraft(position = 0): PromoDraft {
  return {
    id: null, kind: "recommendation", status: "draft", title: "", subtitle: "", sponsor: "", badge_mode: "auto", badge_text: "",
    banner_url: null, banner_kind: "image", banner_style: "overlay", hero_url: null, hero_kind: "image",
    action: "article", link_url: "", body: [], theme: { font: "editorial", accent: "#6C34C9" },
    position, starts_at: "", ends_at: "",
  };
}

/** An ISO time as the value a `datetime-local` input shows, in the browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function draftOf(promo: Promo): PromoDraft {
  return {
    id: promo.id, kind: promo.kind, status: promo.status, title: promo.title, subtitle: promo.subtitle, sponsor: promo.sponsor,
    badge_mode: promo.badge === null ? "auto" : promo.badge === "" ? "hidden" : "custom", badge_text: promo.badge ?? "",
    banner_url: promo.banner_url, banner_kind: promo.banner_kind, banner_style: promo.banner_style, hero_url: promo.hero_url, hero_kind: promo.hero_kind,
    action: promo.action, link_url: promo.link_url ?? "", body: promo.body, theme: promo.theme, position: promo.position,
    starts_at: toLocalInput(promo.starts_at), ends_at: toLocalInput(promo.ends_at),
  };
}

export async function listPromos(): Promise<Promo[]> {
  const { data, error } = await supabase
    .from("promos")
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => normalizePromo(row as Record<string, unknown>));
}

/** Why a draft cannot be saved yet, in the words the form shows; null when it can. */
export function draftProblem(draft: PromoDraft): string | null {
  if (!draft.title.trim()) return "Sarlavhani yozing.";
  if (draft.kind === "ad" && !draft.sponsor.trim()) return "Reklama beruvchining nomini yozing — ilovada «Reklama» yonida ko‘rinadi.";
  if (draft.badge_mode === "custom" && !draft.badge_text.trim()) return "Belgi matnini yozing yoki «Yashirish»ni tanlang.";
  if (draft.action === "link" && !/^https?:\/\/\S+\.\S+/i.test(draft.link_url.trim())) return "Tashqi havola https:// bilan boshlanishi kerak.";
  if (draft.starts_at && draft.ends_at && new Date(draft.starts_at) >= new Date(draft.ends_at)) return "Tugash vaqti boshlanishdan keyin bo‘lishi kerak.";
  if (draft.status === "published" && !draft.banner_url) return "E’lon qilishdan oldin bosh sahifa bannerini yuklang.";
  const badButton = draft.body.find((block) => block.type === "button" && !/^(https?:\/\/\S+|\/\S*)$/i.test(block.button.url.trim()));
  if (badButton) return "Har bir tugmaga havola kiriting: https://… yoki ilova ichidagi sahifa (/…).";
  return null;
}

export async function savePromo(draft: PromoDraft): Promise<Promo> {
  const row = {
    kind: draft.kind,
    status: draft.status,
    title: draft.title.trim(),
    subtitle: draft.subtitle.trim(),
    sponsor: draft.kind === "ad" ? draft.sponsor.trim() : "",
    badge: draft.badge_mode === "auto" ? null : draft.badge_mode === "hidden" ? "" : draft.badge_text.trim().slice(0, 24),
    banner_url: draft.banner_url,
    banner_kind: draft.banner_kind,
    banner_style: draft.banner_style,
    hero_url: draft.hero_url,
    hero_kind: draft.hero_kind,
    action: draft.action,
    link_url: draft.action === "link" ? draft.link_url.trim() : null,
    body: draft.body as unknown as never,
    theme: draft.theme as unknown as never,
    position: Number.isFinite(draft.position) ? Math.round(draft.position) : 0,
    starts_at: fromLocalInput(draft.starts_at),
    ends_at: fromLocalInput(draft.ends_at),
    updated_at: new Date().toISOString(),
  };
  const request = draft.id
    ? supabase.from("promos").update(row).eq("id", draft.id).select("*").single()
    : supabase.from("promos").insert(row).select("*").single();
  const { data, error } = await request;
  if (error) throw error;
  return normalizePromo(data as Record<string, unknown>);
}

export async function setPromoStatus(id: string, status: PromoStatus): Promise<void> {
  const { error } = await supabase.from("promos").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function setPromoPositions(order: { id: string; position: number }[]): Promise<void> {
  const results = await Promise.all(order.map(({ id, position }) => supabase.from("promos").update({ position }).eq("id", id)));
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

export async function deletePromo(id: string): Promise<void> {
  const { error } = await supabase.from("promos").delete().eq("id", id);
  if (error) throw error;
}

export type MediaInfo = { width: number; height: number; duration: number | null };

/** A picture's or a video's size, read in the browser before it is uploaded. */
export function measureMedia(file: File): Promise<MediaInfo | null> {
  const url = URL.createObjectURL(file);
  const done = <T,>(value: T) => { URL.revokeObjectURL(url); return value; };
  return new Promise((resolve) => {
    if (file.type.startsWith("image/")) {
      const image = new Image();
      image.onload = () => resolve(done({ width: image.naturalWidth, height: image.naturalHeight, duration: null }));
      image.onerror = () => resolve(done(null));
      image.src = url;
    } else if (file.type.startsWith("video/")) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve(done({ width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : null }));
      video.onerror = () => resolve(done(null));
      video.src = url;
    } else if (file.type.startsWith("audio/")) {
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      audio.onloadedmetadata = () => resolve(done({ width: 0, height: 0, duration: Number.isFinite(audio.duration) ? audio.duration : null }));
      audio.onerror = () => resolve(done(null));
      audio.src = url;
    } else {
      resolve(done(null));
    }
  });
}

function extensionOf(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return file.type.split("/")[1]?.replace("quicktime", "mov").replace("mpeg", "mp3") ?? "bin";
}

/** Uploads one file and answers its public address. */
export async function uploadPromoMedia(file: File): Promise<string> {
  if (file.size > MEDIA_MAX_BYTES) throw new Error("Fayl 50 MB dan katta. Kichikroq fayl tanlang.");
  const path = `promos/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${extensionOf(file)}`;
  const { error } = await supabase.storage.from(PROMO_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from(PROMO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Screens of the app a button can open, for the picker beside the address field. */
export const APP_ROUTES: { label: string; path: string }[] = [
  { label: "Taqdimot yaratish", path: "/(app)/create" },
  { label: "Do‘kon", path: "/(app)/(tabs)/marketplace" },
  { label: "Do‘konda sotish", path: "/(app)/marketplace/sell" },
  { label: "O‘yingoh", path: "/(app)/(tabs)/games" },
  { label: "Tariflar", path: "/(app)/tarif" },
  { label: "J Tanga sotib olish", path: "/(app)/coins/buy" },
  { label: "Ma’lumotlarni yig‘ish", path: "/(app)/survey" },
  { label: "Loyihalarim", path: "/(app)/(tabs)/projects" },
  { label: "Profil", path: "/(app)/(tabs)/profile" },
];

/** The article typefaces, as the console previews them (the app bundles the same families). */
export const FONT_FACES: Record<PromoFont, { label: string; detail: string; display: string; body: string; quote: string }> = {
  editorial: { label: "Editorial", detail: "Playfair Display + Lora", display: "'Playfair Display', serif", body: "'Lora', serif", quote: "'Playfair Display', serif" },
  modern: { label: "Zamonaviy", detail: "Manrope", display: "'Manrope', sans-serif", body: "'Manrope', sans-serif", quote: "'Manrope', sans-serif" },
  classic: { label: "Klassik", detail: "Cormorant Garamond + Lora", display: "'Cormorant Garamond', serif", body: "'Lora', serif", quote: "'Cormorant Garamond', serif" },
};
