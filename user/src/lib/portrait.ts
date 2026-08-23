import * as Crypto from "expo-crypto";

import { avatarContentType, type AvatarType } from "./avatar";
import { supabase } from "./supabase";

/**
 * Turning a picture into nine printable identity photographs.
 *
 * The picture itself is made elsewhere — the app hands over an instruction and
 * the person takes it to whichever image model they already use. That is a
 * deliberate boundary: it keeps the expensive, unpredictable part of the job
 * off this bill and out of these failure modes, and it means the person can see
 * the result before spending anything here.
 */

/** The instruction, from settings, so it can be corrected without a release. */
export async function portraitPrompt(): Promise<string> {
  const { data, error } = await supabase
    .from("app_settings").select("value").eq("key", "portrait.prompt").maybeSingle();
  if (error) throw error;
  return typeof data?.value === "string" ? data.value : "";
}

export type PortraitSheet = {
  id: string;
  sheetPath: string;
  warnings: string[];
};

/** Uploads the picture the person chose, into their own folder. */
export async function uploadPortrait(asset: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
}, userId: string): Promise<string> {
  const response = await fetch(asset.uri);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("Rasm o‘qilmadi. Boshqa rasm tanlang.");
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("Rasm 20 MB dan katta.");

  // Bytes rather than a Blob, for the reason set out in `avatar.ts`: a Blob
  // body makes `contentType` advisory and the bucket refuses what arrives.
  const contentType: AvatarType = avatarContentType(asset);
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/portrait/${Crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from("user-uploads")
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;
  return path;
}

/** Lays the picture out as an A6 sheet and stores it. */
export async function buildPortraitSheet(sourcePath: string): Promise<PortraitSheet> {
  const { data, error } = await supabase.functions.invoke("portrait-sheet", { body: { sourcePath } });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context && typeof (context as Response).json === "function") {
      const body = await (context as Response).json().catch(() => null) as { error?: string } | null;
      if (body?.error) throw new Error(body.error);
    }
    throw error;
  }
  const answer = data as { id: string; sheetPath: string; warnings?: string[] };
  return { id: answer.id, sheetPath: answer.sheetPath, warnings: answer.warnings ?? [] };
}

/** A URL the phone may fetch, valid for long enough to save the file. */
export async function sheetUrl(sheetPath: string): Promise<string> {
  const { data, error } = await supabase.storage.from("exports").createSignedUrl(sheetPath, 300);
  if (error || !data) throw error ?? new Error("Havola olinmadi");
  return data.signedUrl;
}

/** The sheets this person has already made — what the obyektivka picker reads. */
export async function myPortraits(limit = 12) {
  const { data, error } = await supabase
    .from("portrait_sheets")
    .select("id, source_path, sheet_path, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
