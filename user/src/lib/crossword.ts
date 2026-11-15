import { readCrossword, type Crossword, type CrosswordLanguage } from "@jaxongirman/types";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";

/**
 * Crosswords are O‘yingoh games of kind "crossword" holding one question of
 * type "crossword" whose config is the grid (see packages/types/src/crossword.ts).
 */

export const CROSSWORD_WORD_PRESETS = [10, 15, 20] as const;
export const CROSSWORD_MINUTE_PRESETS = [5, 10, 15, 20] as const;

export function crosswordLanguage(value: unknown): CrosswordLanguage {
  return value === "en" || value === "ru" || value === "tr" ? value : "uz";
}

/** The owner's crossword with its answers, and how long a match gives to solve it. */
export async function loadCrossword(gameId: string): Promise<{ crossword: Crossword; seconds: number } | null> {
  const { data, error } = await supabase
    .from("game_questions")
    .select("config, time_limit_seconds")
    .eq("game_id", gameId)
    .eq("type", "crossword")
    .order("position")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const crossword = readCrossword(data?.config);
  return crossword && data ? { crossword, seconds: data.time_limit_seconds } : null;
}

async function functionError(error: unknown): Promise<never> {
  const context = (error as { context?: unknown }).context;
  if (context && typeof (context as Response).json === "function") {
    const body = await (context as Response).json().catch(() => null) as { error?: string } | null;
    if (body?.error) throw new Error(body.error);
  }
  throw error;
}

/** Makes the printable PDF and opens it: a new tab on the web, the share sheet on a phone. */
export async function openCrosswordPdf(gameId: string, title: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("crossword-pdf", { body: { gameId } });
  if (error) await functionError(error);
  const { storagePath } = data as { storagePath: string };
  const signed = await supabase.storage.from("exports").createSignedUrl(storagePath, 300);
  if (signed.error || !signed.data) throw signed.error ?? new Error("PDF");
  const url = signed.data.signedUrl;
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const name = (title || "krossvord").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "krossvord";
  const { uri } = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}${name}.pdf`);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: title });
  }
}
