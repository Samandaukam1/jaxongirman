import { QR_VIDEO_BUCKET, type QrVideoSurface } from "@jaxongirman/qr-video";

import { supabase } from "@/lib/supabase";

export { drawQr, glowFilter, placeQr, QR_VIDEO_BUCKET, type QrDrawing, type QrVideoSurface } from "@jaxongirman/qr-video";

/**
 * The QR Video Experience: what the admin configured, and how to draw the code.
 *
 * The QR is generated here, on the projector, from the token the session just
 * handed out. It is never part of the footage — a code baked into a video would
 * be the same code on every screen in the country, and scanning it would pair a
 * phone to somebody else's talk.
 */

export type QrExperience = {
  surface: QrVideoSurface;
  isEnabled: boolean;
  introUrl: string | null;
  loopUrl: string | null;
  appearMs: number;
  /** Percentages of the video's own frame, not of the browser window. */
  x: number;
  y: number;
  size: number;
  gradientFrom: string;
  gradientVia: string;
  gradientTo: string;
  background: string;
  glow: number;
};

type Row = {
  surface: QrVideoSurface;
  is_enabled: boolean;
  intro_path: string | null;
  loop_path: string | null;
  qr_appear_ms: number;
  qr_x: number | string;
  qr_y: number | string;
  qr_size: number | string;
  gradient_from: string;
  gradient_via: string;
  gradient_to: string;
  qr_background: string;
  glow: number | string;
};

/** `numeric` arrives as a string over PostgREST, which would poison every sum. */
function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number.parseFloat(value);
}

export function publicVideoUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(QR_VIDEO_BUCKET).getPublicUrl(path).data.publicUrl;
}

export function toExperience(row: Row): QrExperience {
  return {
    surface: row.surface,
    isEnabled: row.is_enabled,
    introUrl: publicVideoUrl(row.intro_path),
    loopUrl: publicVideoUrl(row.loop_path),
    appearMs: row.qr_appear_ms,
    x: toNumber(row.qr_x),
    y: toNumber(row.qr_y),
    size: toNumber(row.qr_size),
    gradientFrom: row.gradient_from,
    gradientVia: row.gradient_via,
    gradientTo: row.gradient_to,
    background: row.qr_background,
    glow: toNumber(row.glow),
  };
}

/**
 * The experience for a surface, or nothing.
 *
 * "Nothing" is the answer for a disabled surface, a surface with no footage,
 * and a database that could not be reached — because all three mean the same
 * thing to the caller: show the pairing screen that has always worked. A
 * projector in a hall must never end up staring at an error because a
 * decorative feature could not load.
 */
export async function loadQrExperience(surface: QrVideoSurface): Promise<QrExperience | null> {
  const { data, error } = await supabase
    .from("qr_video_experiences")
    // One literal, not a concatenation: PostgREST's typings read the column
    // list at compile time and a joined string is opaque to them.
    .select("surface, is_enabled, intro_path, loop_path, qr_appear_ms, qr_x, qr_y, qr_size, gradient_from, gradient_via, gradient_to, qr_background, glow")
    .eq("surface", surface)
    .maybeSingle();

  if (error || !data) return null;
  const experience = toExperience(data as Row);
  if (!experience.isEnabled || !experience.introUrl || !experience.loopUrl) return null;
  return experience;
}
