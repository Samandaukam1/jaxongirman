import type { Tables } from "@jaxongirman/types";

import { supabase } from "./supabase";

/**
 * The spoken script that goes with a deck.
 *
 * Written by the server the moment a deck is finished, so most of the time this
 * is a read. The two calls that are not reads exist for the two cases the
 * automatic write does not cover: a deck made before this feature existed, and
 * a deck edited since its script was written.
 */

export type DefenseSection = {
  slide_number: number;
  slide_title: string;
  speaker_text: string;
  key_point: string;
  transition_to_next: string;
};

export type Defense = {
  status: "generating" | "ready" | "failed";
  introduction: string;
  conclusion: string;
  sections: DefenseSection[];
  /** True when the deck has been edited since the script was written. */
  stale: boolean;
  failureReason: string | null;
};

type Row = Tables<"presentation_defenses">;

export async function loadDefense(presentationId: string): Promise<Defense | null> {
  const [stored, deck] = await Promise.all([
    supabase.from("presentation_defenses").select("*").eq("presentation_id", presentationId).maybeSingle(),
    supabase.from("presentations").select("updated_at").eq("id", presentationId).maybeSingle(),
  ]);
  if (stored.error) throw stored.error;
  if (!stored.data) return null;

  const row = stored.data as Row;
  const writtenFor = row.written_for ? new Date(row.written_for).getTime() : 0;
  const changedAt = deck.data?.updated_at ? new Date(deck.data.updated_at).getTime() : 0;

  return {
    status: row.status as Defense["status"],
    introduction: row.introduction,
    conclusion: row.conclusion,
    sections: (row.sections ?? []) as DefenseSection[],
    // A minute of slack: the deck's own `updated_at` moves when the generator
    // finishes, which is moments before the script is written.
    stale: row.status === "ready" && changedAt > writtenFor + 60_000,
    failureReason: row.failure_reason,
  };
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("generate-defense", { body });
  if (error) {
    // The function wraps its refusals in a JSON body worth surfacing verbatim,
    // but `context` is only sometimes a Response.
    const context = (error as { context?: unknown }).context;
    if (context && typeof (context as Response).json === "function") {
      const payload = await (context as Response).json().catch(() => null) as { error?: string } | null;
      if (payload?.error) throw new Error(payload.error);
    }
    throw error;
  }
  return data as T;
}

/** Writes, or rewrites, the script for a deck. Runs to completion. */
export const writeDefense = (presentationId: string) =>
  invoke<{ ok: true }>({ presentationId, action: "write" });

/** Renders what is stored and answers with the object path to download. */
export const defensePdf = (presentationId: string) =>
  invoke<{ ok: true; storagePath: string }>({ presentationId, action: "pdf" });

/** A URL the phone may fetch, valid for long enough to save the file. */
export async function defensePdfUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from("exports").createSignedUrl(storagePath, 300);
  if (error || !data) throw error ?? new Error("Havola olinmadi");
  return data.signedUrl;
}
