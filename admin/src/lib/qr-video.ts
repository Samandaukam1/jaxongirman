import type { Database } from "@jaxongirman/types";

import { supabase } from "@/lib/supabase";

/**
 * The QR Video Experience's data layer.
 *
 * Two surfaces, one row each. Everything an admin can change about the screen
 * in the hall lives in that row; the videos themselves live in a public bucket
 * because a signed-out projector has to be able to play them.
 */

export const QR_VIDEO_BUCKET = "qr-video";

export type QrVideoSurface = Database["public"]["Enums"]["qr_video_surface"];
export type QrVideoRow = Database["public"]["Tables"]["qr_video_experiences"]["Row"];

export const SURFACE_LABELS: Record<QrVideoSurface, string> = {
  taqdimot: "Taqdimot qilish",
  oyingoh: "O‘yingohni ochish",
};

/** What the reference design specifies, and what a reset goes back to. */
export const REFERENCE = {
  appearMs: 5060,
  x: 46.8,
  y: 66,
  size: 18.3,
  gradientFrom: "#A855F7",
  gradientVia: "#7C3AED",
  gradientTo: "#4F46E5",
  background: "#FFFFFF",
  glow: 0.35,
} as const;

export async function listQrVideoExperiences(): Promise<QrVideoRow[]> {
  const { data, error } = await supabase
    .from("qr_video_experiences")
    .select("*")
    .order("surface");
  if (error) throw error;
  return data ?? [];
}

export type SaveQrVideoInput = {
  surface: QrVideoSurface;
  isEnabled: boolean;
  introPath: string | null;
  loopPath: string | null;
  appearMs: number;
  x: number;
  y: number;
  size: number;
  gradientFrom: string;
  gradientVia: string;
  gradientTo: string;
  background: string;
  glow: number;
};

export async function saveQrVideoExperience(input: SaveQrVideoInput): Promise<QrVideoRow> {
  const { data, error } = await supabase.rpc("admin_save_qr_video_experience", {
    p_surface: input.surface,
    p_is_enabled: input.isEnabled,
    // PostgREST omits an absent key rather than sending null, and the RPC's
    // own default for an omitted path is null — so clearing a slot still clears
    // the column.
    p_intro_path: input.introPath ?? undefined,
    p_loop_path: input.loopPath ?? undefined,
    p_qr_appear_ms: input.appearMs,
    p_qr_x: input.x,
    p_qr_y: input.y,
    p_qr_size: input.size,
    p_gradient_from: input.gradientFrom,
    p_gradient_via: input.gradientVia,
    p_gradient_to: input.gradientTo,
    p_qr_background: input.background,
    p_glow: input.glow,
  });
  if (error) throw error;
  return data as unknown as QrVideoRow;
}

export function publicVideoUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(QR_VIDEO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Uploads a clip, reporting how far it has got.
 *
 * `supabase.storage.upload()` would be one line, but it resolves only when the
 * whole file has landed and says nothing on the way. These are videos: a minute
 * of silence on a slow connection is indistinguishable from a hang, and an
 * admin who gives up and reloads has to start again. So the request goes out
 * through XHR — the same storage endpoint, the same session token, with
 * `upload.onprogress` attached.
 */
export async function uploadQrVideo(params: {
  surface: QrVideoSurface;
  role: "intro" | "loop";
  file: File;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const extension = params.file.name.toLowerCase().split(".").pop()?.replace(/[^a-z0-9]/g, "") || "mp4";
  // A fixed key per slot, so replacing a clip replaces it rather than filling
  // the bucket with every take an admin ever tried.
  const key = `${params.surface}/${params.role}.${extension}`;

  const { data: auth } = await supabase.auth.getSession();
  const accessToken = auth.session?.access_token;
  if (!accessToken) throw new Error("Sessiya topilmadi — qaytadan kiring.");

  const sample = supabase.storage.from(QR_VIDEO_BUCKET).getPublicUrl("probe").data.publicUrl;
  const base = sample.replace(/\/object\/public\/.*$/, "");
  if (base === sample) throw new Error("Storage manzili aniqlanmadi.");
  const endpoint = `${base}/object/${QR_VIDEO_BUCKET}/${key}`;

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", endpoint, true);
    request.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    request.setRequestHeader("Content-Type", params.file.type || "video/mp4");
    // Replacing a clip in place is the whole point of the fixed key.
    request.setRequestHeader("x-upsert", "true");

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) params.onProgress?.(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) { resolve(); return; }
      let message = `Yuklab bo‘lmadi (${request.status}).`;
      try {
        const body = JSON.parse(request.responseText) as { message?: string; error?: string };
        if (body.message || body.error) message = body.message ?? body.error ?? message;
      } catch {
        // A non-JSON body means the status code is all there is to report.
      }
      reject(new Error(message));
    };
    request.onerror = () => reject(new Error("Tarmoq uzildi — qayta urinib ko‘ring."));
    request.onabort = () => reject(new Error("Yuklash bekor qilindi."));
    params.signal?.addEventListener("abort", () => request.abort());
    request.send(params.file);
  });

  return key;
}
