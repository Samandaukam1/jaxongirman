import { supabase } from "./supabase";

/**
 * An academic work, written a section at a time.
 *
 * The client drives the loop rather than the server: it asks for one section,
 * shows what came back, then asks for the next. That is what lets the screen
 * show real progress, lets a person stop and come back, and lets running out of
 * coins be a pause with a button rather than a failure with an apology.
 */

export type WorkKind = "article" | "independent" | "referat" | "coursework";

export const KINDS: { kind: WorkKind; label: string; detail: string }[] = [
  { kind: "article", label: "Ilmiy maqola", detail: "Jurnal uchun, 8–12 bet" },
  { kind: "independent", label: "Mustaqil ish", detail: "Boblar bilan, 12–20 bet" },
  { kind: "referat", label: "Referat", detail: "Reja va asosiy qism, 10–15 bet" },
  { kind: "coursework", label: "Kurs ishi", detail: "To‘liq tuzilma, 25–35 bet" },
];

export type Work = {
  id: string;
  kind: WorkKind;
  topic: string;
  field: string;
  requirements: string;
  status: "draft" | "planning" | "writing" | "paused" | "ready" | "failed";
  empirical: boolean;
  sources: { title: string; author: string; publisher: string; year: string; url: string; page: string }[];
  estimatedCredits: number;
  spentCredits: number;
  pausedReason: string | null;
  failureReason: string | null;
};

export type Section = {
  id: string;
  position: number;
  key: string;
  heading: string;
  status: "pending" | "writing" | "ready" | "failed";
  body: string;
  words: number;
};

const shape = (row: Record<string, unknown>): Work => ({
  id: String(row.id),
  kind: row.kind as WorkKind,
  topic: String(row.topic ?? ""),
  field: String(row.field ?? ""),
  requirements: String(row.requirements ?? ""),
  status: row.status as Work["status"],
  empirical: Boolean(row.empirical),
  sources: (row.sources ?? []) as Work["sources"],
  estimatedCredits: Number(row.estimated_credits ?? 0),
  spentCredits: Number(row.spent_credits ?? 0),
  pausedReason: (row.paused_reason as string | null) ?? null,
  failureReason: (row.failure_reason as string | null) ?? null,
});

export async function myWorks(): Promise<Work[]> {
  const { data, error } = await supabase
    .from("academic_works").select("*").order("updated_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []).map(shape);
}

export async function createWork(input: {
  kind: WorkKind; topic: string; field: string; requirements: string;
}): Promise<Work> {
  const { data: user } = await supabase.auth.getUser();
  const owner = user.user?.id;
  if (!owner) throw new Error("Tizimga kiring");
  const { data, error } = await supabase.from("academic_works").insert({
    owner_id: owner,
    kind: input.kind,
    topic: input.topic.trim(),
    field: input.field.trim(),
    requirements: input.requirements.trim(),
  }).select("*").single();
  if (error) throw error;
  return shape(data);
}

export async function loadWork(id: string): Promise<{ work: Work; sections: Section[] }> {
  const [work, sections] = await Promise.all([
    supabase.from("academic_works").select("*").eq("id", id).single(),
    supabase.from("academic_sections").select("id, position, key, heading, status, body, words")
      .eq("work_id", id).order("position"),
  ]);
  if (work.error) throw work.error;
  if (sections.error) throw sections.error;
  return { work: shape(work.data), sections: (sections.data ?? []) as Section[] };
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("generate-academic", { body });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context && typeof (context as Response).json === "function") {
      const payload = await (context as Response).json().catch(() => null) as { error?: string } | null;
      if (payload?.error) throw new Error(payload.error);
    }
    throw error;
  }
  return data as T;
}

export const planWork = (workId: string) =>
  invoke<{ sections: unknown[]; sources: unknown[]; empirical: boolean }>({ workId, action: "plan" });

/** Writes exactly one section — the next one that is not finished. */
export const writeNextSection = (workId: string) =>
  invoke<{ done: boolean; remaining: number; heading?: string }>({ workId, action: "section" });

export async function workFile(workId: string, format: "docx" | "pdf"): Promise<string> {
  const { storagePath } = await invoke<{ storagePath: string }>({ workId, action: "document", format });
  const signed = await supabase.storage.from("exports").createSignedUrl(storagePath, 300);
  if (signed.error || !signed.data) throw signed.error ?? new Error("Havola olinmadi");
  return signed.data.signedUrl;
}
