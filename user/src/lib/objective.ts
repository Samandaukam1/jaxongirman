import { supabase } from "./supabase";

/**
 * The obyektivka a person fills in once and hands in many times.
 *
 * The field list lives here as well as on the server, and deliberately: the
 * form has to draw the labels in the right order and the renderer has to write
 * them in the right order, and they are the same order. Keeping one copy on
 * each side of the wire is two copies; keeping the wording identical is what
 * makes the preview honest.
 */

export type FieldId =
  | "issued_on" | "institution"
  | "birth_date" | "birth_place"
  | "nationality" | "party"
  | "education" | "graduated"
  | "speciality"
  | "academic_degree" | "academic_title"
  | "languages" | "awards" | "elected_office";

export type WorkRow = { period: string; detail: string };
export type RelativeRow = { relation: string; name: string; born: string; work: string; address: string };

export type ObjectiveDoc = {
  id: string;
  fullName: string;
  fields: Partial<Record<FieldId, string>>;
  work: WorkRow[];
  relatives: RelativeRow[];
  portraitId: string | null;
};

/** Labels and layout, matching `_shared/objective.ts` exactly. */
export const FIELDS: { id: FieldId; label: string; layout: "pair" | "full"; hint?: string }[] = [
  { id: "issued_on", label: "Sana", layout: "pair", hint: "2024-yil 9-sentabr" },
  { id: "institution", label: "Tashkilot / OTM", layout: "full" },
  { id: "birth_date", label: "Tug‘ilgan yili", layout: "pair", hint: "24.01.2001" },
  { id: "birth_place", label: "Tug‘ilgan joyi", layout: "pair" },
  { id: "nationality", label: "Millati", layout: "pair" },
  { id: "party", label: "Partiyaviyligi", layout: "pair" },
  { id: "education", label: "Ma’lumoti", layout: "pair", hint: "Oliy / O‘rta maxsus" },
  { id: "graduated", label: "Tamomlagan", layout: "pair" },
  { id: "speciality", label: "Mutaxassisligi", layout: "full" },
  { id: "academic_degree", label: "Ilmiy darajasi", layout: "pair", hint: "yo‘q" },
  { id: "academic_title", label: "Ilmiy unvoni", layout: "pair", hint: "yo‘q" },
  { id: "languages", label: "Chet tillari", layout: "full" },
  { id: "awards", label: "Davlat mukofoti", layout: "full", hint: "yo‘q" },
  { id: "elected_office", label: "Saylanadigan organ a’zosimi", layout: "full", hint: "yo‘q" },
];

export const RELATIVE_COLUMNS = ["Qarindoshligi", "F.I.Sh.", "Tug‘ilgan yili va joyi", "Ish joyi", "Turar joyi"] as const;

const shape = (row: Record<string, unknown>): ObjectiveDoc => ({
  id: String(row.id),
  fullName: String(row.full_name ?? ""),
  fields: (row.fields ?? {}) as ObjectiveDoc["fields"],
  work: (row.work ?? []) as WorkRow[],
  relatives: (row.relatives ?? []) as RelativeRow[],
  portraitId: (row.portrait_id as string | null) ?? null,
});

/** The person's document, made from their profile the first time. */
export async function openObjective(): Promise<ObjectiveDoc> {
  const existing = await supabase
    .from("objective_documents")
    .select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return shape(existing.data);

  const { data: user } = await supabase.auth.getUser();
  const owner = user.user?.id;
  if (!owner) throw new Error("Tizimga kiring");

  // Seeded from the profile, because the app already knows three of the
  // answers and asking again is asking somebody to repeat themselves.
  const profile = await supabase
    .from("profiles").select("first_name, last_name, organization").eq("id", owner).maybeSingle();
  const fullName = [profile.data?.last_name, profile.data?.first_name].filter(Boolean).join(" ");

  const created = await supabase.from("objective_documents").insert({
    owner_id: owner,
    full_name: fullName,
    fields: profile.data?.organization ? { institution: profile.data.organization } : {},
  }).select("*").single();
  if (created.error) throw created.error;
  return shape(created.data);
}

export async function saveObjective(doc: ObjectiveDoc): Promise<void> {
  const { error } = await supabase.from("objective_documents").update({
    full_name: doc.fullName,
    fields: doc.fields,
    work: doc.work,
    relatives: doc.relatives,
    portrait_id: doc.portraitId,
  }).eq("id", doc.id);
  if (error) throw error;
}

export async function objectiveFile(id: string, format: "docx" | "pdf"): Promise<string> {
  const { data, error } = await supabase.functions.invoke("objective-document", { body: { id, format } });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context && typeof (context as Response).json === "function") {
      const body = await (context as Response).json().catch(() => null) as { error?: string } | null;
      if (body?.error) throw new Error(body.error);
    }
    throw error;
  }
  const { storagePath } = data as { storagePath: string };
  const signed = await supabase.storage.from("exports").createSignedUrl(storagePath, 300);
  if (signed.error || !signed.data) throw signed.error ?? new Error("Havola olinmadi");
  return signed.data.signedUrl;
}
